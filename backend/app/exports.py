"""Encode one composition, validate actual content, then atomically publish."""

from __future__ import annotations

import json
import math
import shutil
import wave
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from fractions import Fraction
from pathlib import Path
from typing import TYPE_CHECKING

from .advanced_media import command, media_input, video_output
from .jobs import Job
from .media import MediaPipeline, ProcessingError

if TYPE_CHECKING:
    from .jobs import ExportFormat
    from .render_plan import ResolvedRenderPlan


_FILENAMES = {"mp4": "merged.mp4", "mov": "merged.mov", "wav": "merged.wav", "mp3": "merged.mp3"}
_FORMATS = "mov,mp3,wav"


def _fixed_path(job: Job, format_: ExportFormat, *, staged: bool) -> Path:
    if format_ not in _FILENAMES:
        raise ProcessingError("Unsupported export format.")
    name = f".staged-{_FILENAMES[format_]}" if staged else _FILENAMES[format_]
    path = job.output_dir / name
    # The storage layer confines the job directory; refuse aliases inside it too.
    if (
        job.output_dir.is_symlink()
        or path.is_symlink()
        or job.output_dir.resolve() != job.output_dir.absolute()
    ):
        raise ProcessingError("Export storage is unavailable.")
    if path.resolve().parent != job.output_dir.resolve():
        raise ProcessingError("Export storage is unavailable.")
    return path


@contextmanager
def _staging(job: Job, format_: ExportFormat) -> Iterator[Path]:
    staged = _fixed_path(job, format_, staged=True)
    try:
        yield staged
    except Exception:
        with suppress(OSError):
            staged.unlink(missing_ok=True)
        raise


def render_primary_mp4(
    pipeline: MediaPipeline, job: Job, picture: Path, master: Path, plan: ResolvedRenderPlan
) -> Path:
    with _staging(job, "mp4") as staged:
        pipeline._run(
            command(pipeline)
            + media_input(picture)
            + media_input(master)
            + [
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "48000",
                "-ac",
                "2",
            ]
            + video_output(plan.output_fps, plan.total_frames, staged)
        )
        validate_artifact(pipeline, staged, "mp4", plan)
        return staged


def render_optional_export(
    pipeline: MediaPipeline,
    job: Job,
    format_: ExportFormat,
    primary: Path,
    master: Path,
    plan: ResolvedRenderPlan,
) -> Path:
    with _staging(job, format_) as staged:
        if format_ == "mov":
            pipeline._run(
                command(pipeline)
                + media_input(primary)
                + [
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0",
                    "-c",
                    "copy",
                    "-f",
                    "mov",
                    "-movflags",
                    "+faststart",
                    str(staged),
                ]
            )
        elif format_ == "wav":
            try:
                shutil.copyfile(master, staged)
            except OSError as exc:
                raise ProcessingError("WAV export could not be created.") from exc
        elif format_ == "mp3":
            pipeline._run(
                command(pipeline)
                + media_input(master)
                + [
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "320k",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    "-write_xing",
                    "1",
                    "-f",
                    "mp3",
                    str(staged),
                ]
            )
        else:
            raise ProcessingError("Unsupported optional export format.")
        validate_artifact(pipeline, staged, format_, plan)
        return staged


def _pcm_samples(path: Path) -> int:
    """Count readable PCM frames, rather than trusting a WAV header alone."""
    try:
        with wave.open(str(path), "rb") as source:
            if (
                source.getframerate(),
                source.getnchannels(),
                source.getsampwidth(),
                source.getcomptype(),
            ) != (48000, 2, 2, "NONE"):
                raise ProcessingError("Export audio profile is invalid.")
            size = 0
            while chunk := source.readframes(65536):
                size += len(chunk)
            if size % 4 or size // 4 != source.getnframes():
                raise ProcessingError("Export audio is incomplete.")
            return size // 4
    except (OSError, EOFError, wave.Error) as exc:
        raise ProcessingError("Export audio is unreadable.") from exc


def validate_artifact(
    pipeline: MediaPipeline, path: Path, format_: ExportFormat, plan: ResolvedRenderPlan
) -> None:
    if format_ not in _FILENAMES:
        raise ProcessingError("Unsupported export format.")
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        raise ProcessingError("Export artifact is missing or empty.")
    expected = plan.total_frames * (48000 // plan.output_fps)
    try:
        result = pipeline._run(
            [
                pipeline.settings.ffprobe_path,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                _FORMATS,
                "-count_frames",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ]
        )
        streams = json.loads(result.stdout)["streams"]
        video = [s for s in streams if s.get("codec_type") == "video"]
        audio = [s for s in streams if s.get("codec_type") == "audio"]
        if len(audio) != 1 or len(streams) != (2 if format_ in ("mp4", "mov") else 1):
            raise ProcessingError("Export streams are invalid.")
        a = audio[0]
        codec = {"mp4": "aac", "mov": "aac", "wav": "pcm_s16le", "mp3": "mp3"}[format_]
        if (
            a.get("codec_name") != codec
            or int(a["sample_rate"]) != 48000
            or int(a["channels"]) != 2
        ):
            raise ProcessingError("Export audio profile is invalid.")
        if format_ in ("mp4", "mov"):
            if len(video) != 1:
                raise ProcessingError("Export video stream is missing.")
            v = video[0]
            if (
                v.get("codec_name") != "h264"
                or v.get("pix_fmt") != "yuv420p"
                or int(v["nb_read_frames"]) != plan.total_frames
                or Fraction(v["avg_frame_rate"]) != plan.output_fps
                or not math.isclose(
                    float(v["duration"]),
                    plan.total_frames / plan.output_fps,
                    abs_tol=0.00001,
                    rel_tol=0,
                )
            ):
                raise ProcessingError("Export video profile or duration is invalid.")
        elif video:
            raise ProcessingError("Audio export contains video.")
        if format_ == "mp3":
            if int(a["bit_rate"]) != 320000:
                raise ProcessingError("MP3 bitrate is invalid.")
            with path.open("rb") as source:
                header = source.read(65536)
            if b"Xing" not in header and b"Info" not in header:
                raise ProcessingError("MP3 gapless metadata is missing.")
    except (KeyError, TypeError, ValueError, ZeroDivisionError, OSError) as exc:
        raise ProcessingError("Export metadata is unreadable.") from exc
    if format_ == "wav":
        count = _pcm_samples(path)
        allowance = 0
    else:
        decoded = path.with_name(f".{path.name}.decode.wav")
        if decoded.is_symlink():
            raise ProcessingError("Export storage is unavailable.")
        try:
            pipeline._run(
                command(pipeline)
                + media_input(path, _FORMATS)
                + [
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-c:a",
                    "pcm_s16le",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    str(decoded),
                ]
            )
            count = _pcm_samples(decoded)
        finally:
            decoded.unlink(missing_ok=True)
        allowance = 1152 if format_ == "mp3" else 1024
    if not expected <= count <= expected + allowance:
        raise ProcessingError("Export decoded audio duration is invalid.")


def publish_artifact(job: Job, staged: Path, format_: ExportFormat) -> Path:
    final = _fixed_path(job, format_, staged=False)
    try:
        if (
            staged.is_symlink()
            or staged.resolve().parent != job.output_dir.resolve()
            or not staged.is_file()
            or not staged.stat().st_size
        ):
            raise ProcessingError("Export artifact is missing or unsafe.")
        staged.replace(final)
    except OSError as exc:
        if staged.parent == job.output_dir:
            with suppress(OSError):
                staged.unlink(missing_ok=True)
        raise ProcessingError("Export could not be published.") from exc
    return final
