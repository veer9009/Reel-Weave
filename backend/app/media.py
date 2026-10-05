from __future__ import annotations

import json
import logging
import math
import subprocess
from dataclasses import replace
from fractions import Fraction
from pathlib import Path
from typing import Any

from .composition import build_overlay_graph
from .config import Settings
from .jobs import ClipEdit, Job
from .timeline import project_frame_count, round_half_up

logger = logging.getLogger("reelweave.media")


def _failure_reason(stderr: str | bytes | None) -> str:
    if isinstance(stderr, bytes):
        text = stderr.decode("utf-8", errors="replace").lower()
    else:
        text = (stderr or "").lower()
    categories = (
        ("invalid data", "invalid_data"),
        ("format not on whitelist", "format_blocked"),
        ("matches no streams", "missing_stream"),
        ("permission denied", "permission_denied"),
        ("unknown decoder", "unsupported_codec"),
    )
    return next((reason for phrase, reason in categories if phrase in text), "unknown")


class ProcessingError(RuntimeError):
    pass


class InvalidMediaError(ProcessingError):
    pass


class MediaPipeline:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _run(self, args: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                args,
                cwd=str(cwd) if cwd else None,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                check=True,
                timeout=self.settings.subprocess_timeout_seconds,
            )
        except subprocess.CalledProcessError as exc:
            logger.warning(
                "media command failed tool=%s returncode=%s reason=%s",
                Path(args[0]).name,
                exc.returncode,
                _failure_reason(exc.stderr),
            )
            raise ProcessingError("Media command failed") from exc
        except subprocess.TimeoutExpired as exc:
            logger.warning("media command timed out tool=%s", Path(args[0]).name)
            raise ProcessingError("Media command timed out") from exc
        except OSError as exc:
            logger.warning("media command could not start tool=%s", Path(args[0]).name)
            raise ProcessingError("Media command failed") from exc

    def _probe(self, source: Path) -> dict[str, Any]:
        result = self._run(
            [
                self.settings.ffprobe_path,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,matroska,webm",
                "-count_frames",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(source),
            ]
        )
        try:
            data = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError) as exc:
            raise InvalidMediaError("Clip metadata is unreadable") from exc
        if not any(stream.get("codec_type") == "video" for stream in data.get("streams", [])):
            raise InvalidMediaError("Clip has no video stream")
        return data

    def _probe_audio(self, source: Path) -> bool:
        result = self._run(
            [
                self.settings.ffprobe_path,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,mp3,wav,aac",
                "-show_streams",
                "-of",
                "json",
                str(source),
            ]
        )
        try:
            data = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError) as exc:
            raise InvalidMediaError("Background audio metadata is unreadable") from exc
        return any(stream.get("codec_type") == "audio" for stream in data.get("streams", []))

    def _probe_image(self, source: Path) -> dict[str, Any]:
        result = self._run(
            [
                self.settings.ffprobe_path,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "image2,png_pipe,jpeg_pipe",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(source),
            ]
        )
        try:
            return json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError) as exc:
            raise InvalidMediaError("Image overlay metadata is unreadable") from exc

    @staticmethod
    def _video_duration(metadata: dict[str, Any]) -> float | None:
        candidates = [
            stream.get("duration")
            for stream in metadata.get("streams", [])
            if stream.get("codec_type") == "video"
        ]
        candidates.append(metadata.get("format", {}).get("duration"))
        for candidate in candidates:
            try:
                duration = float(candidate)
            except (TypeError, ValueError):
                continue
            if math.isfinite(duration) and duration > 0:
                return duration
        return None

    @staticmethod
    def _video_fps(metadata: dict[str, Any]) -> float | None:
        stream = next(
            (item for item in metadata.get("streams", []) if item.get("codec_type") == "video"),
            None,
        )
        if not stream:
            return None
        for key in ("avg_frame_rate", "r_frame_rate"):
            try:
                fps = float(Fraction(str(stream.get(key))))
            except (ValueError, ZeroDivisionError):
                continue
            if math.isfinite(fps) and fps > 0:
                return fps
        return None

    @classmethod
    def _total_frames(cls, metadata: dict[str, Any], fps: float | None) -> int | None:
        stream = next(
            (item for item in metadata.get("streams", []) if item.get("codec_type") == "video"),
            None,
        )
        if stream:
            try:
                frames = int(stream.get("nb_read_frames") or stream.get("nb_frames"))
            except (TypeError, ValueError):
                frames = 0
            if frames > 0:
                return frames
        duration = cls._video_duration(metadata)
        return max(1, round(duration * fps)) if duration and fps else None

    @staticmethod
    def _clamp_edit(edit: ClipEdit, total_frames: int, clip_number: int) -> ClipEdit:
        final_frame = total_frames - 1
        if not edit.trim_saved:
            return replace(edit, start_frame=0, end_frame=final_frame)
        clamped = replace(edit, end_frame=min(edit.end_frame, final_frame))
        if clamped.start_frame > clamped.end_frame:
            raise InvalidMediaError(
                f"Clip {clip_number} selected trim contains no decoded frames "
                "after clamping to the actual frame count"
            )
        return clamped

    @staticmethod
    def _validate_overlay_dimensions(metadata: dict[str, Any], label: str) -> dict[str, Any]:
        streams = [
            stream for stream in metadata.get("streams", []) if stream.get("codec_type") == "video"
        ]
        if not streams:
            raise InvalidMediaError(f"The {label} overlay has no video stream")
        stream = streams[0]
        try:
            width = int(stream.get("width"))
            height = int(stream.get("height"))
        except (TypeError, ValueError) as exc:
            raise InvalidMediaError(f"The {label} overlay dimensions are unavailable") from exc
        if (
            width <= 0
            or height <= 0
            or width > 8192
            or height > 8192
            or width * height > 40_000_000
        ):
            raise InvalidMediaError(f"The {label} overlay dimensions exceed the supported limit")
        return stream

    @staticmethod
    def _validate_overlay_range(job: Job, label: str) -> None:
        settings = job.image_overlay_settings if label == "image" else job.video_overlay_settings
        if settings is None:
            return
        if settings.end_frame >= job.total_project_frames:
            raise InvalidMediaError(
                f"The {label} overlay range is outside the decoded project frame range"
            )

    def validate_job(self, job: Job) -> None:
        if len(job.clip_edits) != len(job.input_paths):
            raise InvalidMediaError("Clip edit count does not match uploads")
        job.total_project_frames = 0
        for index, (source, edit) in enumerate(zip(job.input_paths, job.clip_edits, strict=True)):
            try:
                metadata = self._probe(source)
            except ProcessingError as exc:
                raise InvalidMediaError(f"Clip {index + 1} metadata is unreadable.") from exc
            except InvalidMediaError as exc:
                raise InvalidMediaError(f"Clip {index + 1}: {exc}") from exc
            fps = self._video_fps(metadata)
            total_frames = self._total_frames(metadata, fps)
            if fps is None or total_frames is None:
                raise InvalidMediaError(f"Clip {index + 1} frame metadata is unavailable")
            clamped = self._clamp_edit(edit, total_frames, index + 1)
            job.clip_edits[index] = clamped
            job.total_project_frames += project_frame_count(
                clamped.end_frame - clamped.start_frame + 1,
                fps,
                clamped.speed,
                job.output_fps,
            )
        if job.image_overlay_path is not None:
            try:
                image_metadata = self._probe_image(job.image_overlay_path)
            except ProcessingError as exc:
                raise InvalidMediaError("Image overlay metadata is unreadable.") from exc
            image_streams = [
                stream
                for stream in image_metadata.get("streams", [])
                if stream.get("codec_type") == "video"
            ]
            if len(image_streams) != 1 or image_streams[0].get("codec_name") not in {
                "png",
                "mjpeg",
            }:
                raise InvalidMediaError("Image overlay must decode as one PNG or JPEG still")
            self._validate_overlay_dimensions(image_metadata, "image")
            self._validate_overlay_range(job, "image")
        if job.video_overlay_path is not None:
            try:
                video_metadata = self._probe(job.video_overlay_path)
            except ProcessingError as exc:
                raise InvalidMediaError("Video overlay metadata is unreadable.") from exc
            self._validate_overlay_dimensions(video_metadata, "video")
            video_fps = self._video_fps(video_metadata)
            duration = self._video_duration(video_metadata)
            if (
                video_fps is None
                or duration is None
                or self._total_frames(video_metadata, video_fps) is None
            ):
                raise InvalidMediaError("Video overlay duration or frame metadata is unavailable")
            self._validate_overlay_range(job, "video")
        if job.background_audio_path is not None:
            try:
                has_background_audio = self._probe_audio(job.background_audio_path)
            except ProcessingError as exc:
                raise InvalidMediaError("Background audio metadata is unreadable.") from exc
            if not has_background_audio:
                raise InvalidMediaError("The background audio file has no audio stream")

    def merge(self, job: Job) -> None:
        normalized: list[Path] = []
        base_video_filter = (
            "scale=w='trunc(ih*dar/2)*2':h='trunc(ih/2)*2',setsar=1,"
            "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,"
            "pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,"
            f"fps={job.output_fps},format=yuv420p,setsar=1"
        )
        output_durations: list[float] = []
        for index, source in enumerate(job.input_paths):
            metadata = self._probe(source)
            duration = self._video_duration(metadata)
            fps = self._video_fps(metadata)
            edit = job.clip_edits[index] if index < len(job.clip_edits) else None
            if edit is not None:
                if fps is None:
                    raise InvalidMediaError("Clip frame rate is unavailable")
                total_frames = self._total_frames(metadata, fps)
                if total_frames is not None:
                    edit = self._clamp_edit(edit, total_frames, index + 1)
                    job.clip_edits[index] = edit
                source_start = edit.start_frame / fps
                source_end = (edit.end_frame + 1) / fps
                output_frames = project_frame_count(
                    edit.end_frame - edit.start_frame + 1,
                    fps,
                    edit.speed,
                    job.output_fps,
                )
                processed_duration = output_frames / job.output_fps
                video_filter = (
                    f"trim=start_frame={edit.start_frame}:end_frame={edit.end_frame + 1},"
                    f"setpts=PTS-STARTPTS,setpts=(PTS-STARTPTS)/{edit.speed:g},{base_video_filter}"
                )
            else:
                source_start = 0.0
                source_end = duration
                processed_duration = duration
                video_filter = base_video_filter
                output_frames = None
            has_audio = any(
                stream.get("codec_type") == "audio" for stream in metadata.get("streams", [])
            )
            destination = job.intermediate_dir / f"{index:03d}.mp4"
            args = [
                self.settings.ffmpeg_path,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,matroska,webm",
                "-i",
                str(source),
            ]
            if not has_audio:
                args.extend(
                    ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
                )
            args.extend(["-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0"])
            args.extend(["-vf", video_filter])
            if has_audio:
                audio_filter = []
                if edit is not None and source_end is not None:
                    audio_filter.extend(
                        [
                            f"atrim=start={source_start:.6f}:end={source_end:.6f}",
                            "asetpts=PTS-STARTPTS",
                            f"atempo={edit.speed:g}",
                        ]
                    )
                audio_filter.extend(["aresample=48000", "aformat=channel_layouts=stereo"])
                if job.background_audio_path is None:
                    original_volume = (
                        0.0 if job.audio_mix.original_muted else job.audio_mix.original_volume
                    )
                    audio_filter.append(f"volume={original_volume:g}")
                audio_filter.append("apad")
                args.extend(["-af", ",".join(audio_filter)])
            args.extend(
                [
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "23",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    "-shortest",
                ]
            )
            if processed_duration is not None:
                args.extend(["-t", f"{processed_duration:.6f}"])
            if output_frames is not None:
                args.extend(["-frames:v", str(output_frames)])
            args.extend(["-movflags", "+faststart", str(destination)])
            self._run(args)
            normalized.append(destination)
            if processed_duration is not None:
                output_durations.append(processed_duration)

        concat_file = job.intermediate_dir / "concat.txt"
        concat_file.write_text(
            "".join(f"file '{path.name}'\n" for path in normalized), encoding="utf-8"
        )
        has_overlays = job.image_overlay_path is not None or job.video_overlay_path is not None
        concatenated = (
            job.intermediate_dir / "merged-original.mp4"
            if job.background_audio_path is not None or has_overlays
            else job.result_path
        )
        final_duration = (
            job.total_project_frames / job.output_fps
            if job.total_project_frames > 0
            else sum(output_durations)
        )
        if job.total_project_frames <= 0 and output_durations:
            job.total_project_frames = sum(
                max(1, round_half_up(duration * job.output_fps)) for duration in output_durations
            )
            final_duration = job.total_project_frames / job.output_fps
        concat_args = [
            self.settings.ffmpeg_path,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "concat,mov",
            "-f",
            "concat",
            "-safe",
            "1",
            "-i",
            concat_file.name,
            "-vf",
            f"fps={job.output_fps},format=yuv420p,setsar=1",
            "-r",
            str(job.output_fps),
            "-fps_mode",
            "cfr",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
        ]
        if job.total_project_frames > 0:
            concat_args.extend(["-frames:v", str(job.total_project_frames)])
        if final_duration > 0:
            concat_args.extend(["-t", f"{final_duration:.6f}"])
        concat_args.append(str(concatenated))
        self._run(concat_args, cwd=job.intermediate_dir)

        composed = concatenated
        if has_overlays:
            composed = (
                job.intermediate_dir / "merged-composited.mp4"
                if job.background_audio_path is not None
                else job.result_path
            )
            self._compose_overlays(job, concatenated, composed)

        if job.background_audio_path is None:
            return
        if len(output_durations) != len(job.input_paths):
            raise InvalidMediaError("Final video duration is unavailable")
        original_volume = 0.0 if job.audio_mix.original_muted else job.audio_mix.original_volume
        music_volume = 0.0 if job.audio_mix.music_muted else job.audio_mix.music_volume
        filters = (
            f"[0:a:0]volume={original_volume:g}[original];"
            f"[1:a:0]atrim=duration={final_duration:.6f},asetpts=PTS-STARTPTS,"
            f"volume={music_volume:g}[music];"
            "[original][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]"
        )
        self._run(
            [
                self.settings.ffmpeg_path,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,mp3,wav,aac",
                "-i",
                str(composed),
                "-stream_loop",
                "-1",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,mp3,wav,aac",
                "-i",
                str(job.background_audio_path),
                "-filter_complex",
                filters,
                "-map",
                "0:v:0",
                "-map",
                "[mixed]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-t",
                f"{final_duration:.6f}",
                "-movflags",
                "+faststart",
                str(job.result_path),
            ]
        )

    def _compose_overlays(self, job: Job, base_path: Path, destination: Path) -> None:
        args = [
            self.settings.ffmpeg_path,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mov,matroska,webm",
            "-i",
            str(base_path),
        ]
        next_index = 1
        video_input = None
        image_input = None
        if job.video_overlay_path is not None and job.video_overlay_settings is not None:
            args.extend(
                [
                    "-protocol_whitelist",
                    "file,pipe",
                    "-format_whitelist",
                    "mov,matroska,webm",
                    "-i",
                    str(job.video_overlay_path),
                ]
            )
            video_input = (next_index, job.video_overlay_settings)
            next_index += 1
        if job.image_overlay_path is not None and job.image_overlay_settings is not None:
            args.extend(
                [
                    "-loop",
                    "1",
                    "-framerate",
                    str(job.output_fps),
                    "-protocol_whitelist",
                    "file,pipe",
                    "-format_whitelist",
                    "image2,png_pipe,jpeg_pipe",
                    "-i",
                    str(job.image_overlay_path),
                ]
            )
            image_input = (next_index, job.image_overlay_settings)
        graph = build_overlay_graph(
            job.output_fps,
            job.total_project_frames,
            video_input,
            image_input,
        )
        duration = job.total_project_frames / job.output_fps
        args.extend(
            [
                "-filter_complex",
                graph.filter_complex,
                "-map",
                graph.output_label,
                "-map",
                "0:a:0",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "copy",
                "-r",
                str(job.output_fps),
                "-fps_mode",
                "cfr",
                "-frames:v",
                str(job.total_project_frames),
                "-t",
                f"{duration:.6f}",
                "-movflags",
                "+faststart",
                str(destination),
            ]
        )
        self._run(args)
