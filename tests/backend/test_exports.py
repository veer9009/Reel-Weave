import json
import os
import shutil
import subprocess
import wave
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.app.jobs import Job
from backend.app.media import ProcessingError
from backend.app.storage import Storage


@pytest.fixture
def job(settings):
    return Job.create(Storage(settings), "a" * 32)


@pytest.fixture
def plan():
    return SimpleNamespace(output_fps=25, total_frames=150)


def pcm(path, samples=288000):
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(48000)
        out.writeframes(b"\0" * samples * 4)


class FakePipeline:
    def __init__(self, settings, metadata=None, samples=288000):
        self.settings = settings
        self.calls = []
        self.samples = samples
        self.metadata = metadata or {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "pix_fmt": "yuv420p",
                    "nb_read_frames": "150",
                    "avg_frame_rate": "25/1",
                    "duration": "6.000000",
                },
                {"codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2},
            ]
        }

    def _run(self, args):
        self.calls.append(args)
        if args[0] == self.settings.ffprobe_path:
            return subprocess.CompletedProcess(args, 0, json.dumps(self.metadata), "")
        dest = Path(args[-1])
        if dest.suffix == ".wav":
            pcm(dest, self.samples)
        else:
            dest.write_bytes(b"encoded media Info")
        return subprocess.CompletedProcess(args, 0, "", "")


def test_primary_maps_picture_and_master_with_required_profile(settings, job, plan):
    from backend.app.exports import render_primary_mp4

    pipeline = FakePipeline(settings)
    result = render_primary_mp4(pipeline, job, Path("picture.mp4"), Path("master.wav"), plan)
    args = pipeline.calls[0]
    assert args[args.index("-c:a") + 1] == "aac"
    assert args[args.index("-b:a") + 1] == "192k"
    assert args[args.index("-map") : args.index("-map") + 4] == ["-map", "0:v:0", "-map", "1:a:0"]
    assert args[args.index("-c:v") + 1] == "libx264"
    assert args[args.index("-crf") + 1] == "23"
    assert result.parent == job.output_dir
    assert not job.result_path.exists()


def test_mov_remuxes_primary_and_mp3_encodes_master(settings, job, plan):
    from backend.app.exports import render_optional_export

    pipeline = FakePipeline(settings)
    render_optional_export(pipeline, job, "mov", Path("primary.mp4"), Path("master.wav"), plan)
    args = pipeline.calls[0]
    assert args[args.index("-map") : args.index("-map") + 6] == [
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c",
        "copy",
    ]
    assert args[args.index("-f") + 1] == "mov"
    pipeline = FakePipeline(
        settings,
        {
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "mp3",
                    "sample_rate": "48000",
                    "channels": 2,
                    "bit_rate": "320000",
                }
            ]
        },
    )
    render_optional_export(pipeline, job, "mp3", Path("primary.mp4"), Path("master.wav"), plan)
    args = pipeline.calls[0]
    assert "primary.mp4" not in args
    assert args[args.index("-c:a") + 1] == "libmp3lame"
    assert args[args.index("-b:a") + 1] == "320k"
    assert args[args.index("-write_xing") + 1] == "1"
    assert "-vn" in args


def test_wav_is_exact_master_copy_and_publication_is_separate(settings, job, plan):
    from backend.app.exports import publish_artifact, render_optional_export

    master = job.intermediate_dir / "master.wav"
    pcm(master)
    pipeline = FakePipeline(
        settings,
        {
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "pcm_s16le",
                    "sample_rate": "48000",
                    "channels": 2,
                    "bits_per_sample": 16,
                }
            ]
        },
    )
    staged = render_optional_export(pipeline, job, "wav", Path("primary.mp4"), master, plan)
    assert staged.read_bytes() == master.read_bytes()
    final = publish_artifact(job, staged, "wav")
    assert final == job.output_dir / "merged.wav"
    assert master.exists() and final.exists() and not staged.exists()


@pytest.mark.parametrize(
    "field,value",
    [
        ("nb_read_frames", "149"),
        ("codec_name", "prores"),
        ("avg_frame_rate", "30/1"),
        ("duration", "6.1"),
        ("pix_fmt", "yuv444p"),
    ],
)
def test_primary_probe_rejects_wrong_video_profile(settings, job, plan, field, value):
    from backend.app.exports import validate_artifact

    pipeline = FakePipeline(settings)
    pipeline.metadata["streams"][0][field] = value
    staged = job.output_dir / "candidate.mp4"
    staged.write_bytes(b"partial")
    with pytest.raises(ProcessingError):
        validate_artifact(pipeline, staged, "mp4", plan)
    assert not job.result_path.exists()


@pytest.mark.parametrize(
    "samples,valid", [(288000, True), (289024, True), (289025, False), (287999, False)]
)
def test_lossy_validation_decodes_and_bounds_padding(settings, job, plan, samples, valid):
    from backend.app.exports import validate_artifact

    pipeline = FakePipeline(settings, samples=samples)
    staged = job.output_dir / "candidate.mp4"
    staged.write_bytes(b"media")
    if valid:
        validate_artifact(pipeline, staged, "mp4", plan)
    else:
        with pytest.raises(ProcessingError):
            validate_artifact(pipeline, staged, "mp4", plan)
    assert "-count_frames" in pipeline.calls[0]
    assert not list(job.output_dir.glob("*decode*.wav"))


def test_empty_missing_outside_and_symlink_artifacts_are_not_published(job, tmp_path):
    from backend.app.exports import publish_artifact

    empty = job.output_dir / "empty.mp4"
    empty.touch()
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"outside")
    for staged in (empty, outside, job.output_dir / "missing.mp4"):
        with pytest.raises(ProcessingError):
            publish_artifact(job, staged, "mp4")
    assert not job.result_path.exists()


def test_rename_failure_does_not_publish(job, monkeypatch):
    from backend.app.exports import publish_artifact

    staged = job.output_dir / "staged.mp4"
    staged.write_bytes(b"media")
    monkeypatch.setattr(Path, "replace", lambda *args: (_ for _ in ()).throw(OSError()))
    with pytest.raises(ProcessingError):
        publish_artifact(job, staged, "mp4")
    assert not job.result_path.exists()
    assert not staged.exists()


@pytest.mark.parametrize("samples", [287999, 288001])
def test_wav_requires_exact_samples(settings, job, plan, samples):
    from backend.app.exports import validate_artifact

    artifact = job.output_dir / "master.wav"
    pcm(artifact, samples)
    pipeline = FakePipeline(
        settings,
        {
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "pcm_s16le",
                    "sample_rate": "48000",
                    "channels": 2,
                    "bits_per_sample": 16,
                }
            ]
        },
    )
    with pytest.raises(ProcessingError, match="duration"):
        validate_artifact(pipeline, artifact, "wav", plan)


def test_wav_rejects_truncated_data_even_with_correct_header(settings, job, plan):
    from backend.app.exports import validate_artifact

    artifact = job.output_dir / "master.wav"
    pcm(artifact)
    artifact.write_bytes(artifact.read_bytes()[:-4])
    pipeline = FakePipeline(
        settings,
        {
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "pcm_s16le",
                    "sample_rate": "48000",
                    "channels": 2,
                }
            ]
        },
    )
    with pytest.raises(ProcessingError, match="incomplete"):
        validate_artifact(pipeline, artifact, "wav", plan)


@pytest.mark.parametrize("samples,valid", [(289152, True), (289153, False)])
def test_mp3_requires_gapless_metadata_and_bounds_decoded_padding(
    settings, job, plan, samples, valid
):
    from backend.app.exports import validate_artifact

    artifact = job.output_dir / "master.mp3"
    artifact.write_bytes(b"mp3 Info")
    pipeline = FakePipeline(
        settings,
        {
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "mp3",
                    "sample_rate": "48000",
                    "channels": 2,
                    "bit_rate": "320000",
                }
            ]
        },
        samples=samples,
    )
    if valid:
        validate_artifact(pipeline, artifact, "mp3", plan)
    else:
        with pytest.raises(ProcessingError, match="duration"):
            validate_artifact(pipeline, artifact, "mp3", plan)
    artifact.write_bytes(b"no gapless metadata")
    with pytest.raises(ProcessingError, match="gapless"):
        validate_artifact(pipeline, artifact, "mp3", plan)


def test_decoder_failure_removes_private_decode_file(settings, job, plan):
    from backend.app.exports import validate_artifact

    artifact = job.output_dir / "candidate.mp4"
    artifact.write_bytes(b"media")
    pipeline = FakePipeline(settings)
    original = pipeline._run

    def fail_decode(args):
        if args[0] == settings.ffmpeg_path:
            Path(args[-1]).write_bytes(b"partial pcm")
            raise ProcessingError("decoder failed")
        return original(args)

    pipeline._run = fail_decode
    with pytest.raises(ProcessingError, match="decoder failed"):
        validate_artifact(pipeline, artifact, "mp4", plan)
    assert not list(job.output_dir.glob("*decode*.wav"))
    assert not job.result_path.exists()


def test_encoder_failure_never_publishes(settings, job, plan):
    from backend.app.exports import render_primary_mp4

    pipeline = FakePipeline(settings)

    def fail_encode(args):
        Path(args[-1]).write_bytes(b"partial encode")
        raise ProcessingError("encoder failed")

    pipeline._run = fail_encode
    with pytest.raises(ProcessingError, match="encoder failed"):
        render_primary_mp4(pipeline, job, Path("picture.mp4"), Path("master.wav"), plan)
    assert not job.result_path.exists()
    assert not list(job.output_dir.glob(".staged-*"))


def test_optional_failure_cleans_stage_and_keeps_primary(settings, job, plan):
    from backend.app.exports import render_optional_export

    job.result_path.write_bytes(b"valid primary")
    pipeline = FakePipeline(settings)

    def fail_encode(args):
        Path(args[-1]).write_bytes(b"partial encode")
        raise ProcessingError("encoder failed")

    pipeline._run = fail_encode
    with pytest.raises(ProcessingError, match="encoder failed"):
        render_optional_export(pipeline, job, "mp3", job.result_path, Path("master.wav"), plan)
    assert job.result_path.read_bytes() == b"valid primary"
    assert not list(job.output_dir.glob(".staged-*"))


@pytest.mark.parametrize(
    "field,value",
    [
        ("codec_name", "mp3"),
        ("sample_rate", "44100"),
        ("channels", 1),
    ],
)
def test_primary_rejects_wrong_audio_profile(settings, job, plan, field, value):
    from backend.app.exports import validate_artifact

    artifact = job.output_dir / "candidate.mp4"
    artifact.write_bytes(b"media")
    pipeline = FakePipeline(settings)
    pipeline.metadata["streams"][1][field] = value
    with pytest.raises(ProcessingError, match="audio profile"):
        validate_artifact(pipeline, artifact, "mp4", plan)


def test_publication_refuses_symbolic_link(job, tmp_path):
    from backend.app.exports import publish_artifact

    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"media")
    staged = job.output_dir / "link.mp4"
    try:
        staged.symlink_to(outside)
    except OSError:
        pytest.skip("Symbolic link creation is unavailable on this Windows account.")
    with pytest.raises(ProcessingError, match="unsafe"):
        publish_artifact(job, staged, "mp4")
    assert not job.result_path.exists()


def test_publication_refuses_redirected_output_directory(job, tmp_path, monkeypatch):
    from backend.app.exports import publish_artifact

    staged = job.output_dir / "staged.mp4"
    staged.write_bytes(b"media")
    original = Path.resolve

    def redirected(path, *args, **kwargs):
        if path == job.output_dir or job.output_dir in path.parents:
            return tmp_path / "redirected" / path.relative_to(job.output_dir)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", redirected)
    with pytest.raises(ProcessingError, match="storage"):
        publish_artifact(job, staged, "mp4")
    assert not job.result_path.exists()


@pytest.mark.skipif(os.getenv("RUN_FFMPEG_TESTS") != "1", reason="Real FFmpeg tests are opt-in.")
@pytest.mark.parametrize("fps,frames", [(25, 150), (60, 1)])
def test_real_four_format_delivery_profiles(settings, tmp_path, fps, frames):
    from backend.app.capabilities import probe_export_capabilities
    from backend.app.exports import (
        publish_artifact,
        render_optional_export,
        render_primary_mp4,
    )
    from backend.app.media import MediaPipeline

    settings = replace(
        settings,
        ffmpeg_path=shutil.which("ffmpeg") or "C:/ffmpeg/bin/ffmpeg.exe",
        ffprobe_path=shutil.which("ffprobe") or "C:/ffmpeg/bin/ffprobe.exe",
        subprocess_timeout_seconds=60,
    )
    assert all(probe_export_capabilities(settings).values())
    pipeline = MediaPipeline(settings)
    job = Job.create(Storage(settings), "a" * 32)
    plan = SimpleNamespace(output_fps=fps, total_frames=frames)
    picture = job.intermediate_dir / "picture.mp4"
    master = job.intermediate_dir / "master.wav"
    pipeline._run(
        [
            settings.ffmpeg_path,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c=blue:s=128x72:r={fps}",
            "-frames:v",
            str(frames),
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(picture),
        ]
    )
    pcm(master, frames * (48000 // fps))
    primary = publish_artifact(job, render_primary_mp4(pipeline, job, picture, master, plan), "mp4")
    for format_ in ("mov", "wav", "mp3"):
        staged = render_optional_export(pipeline, job, format_, primary, master, plan)
        published = publish_artifact(job, staged, format_)
        assert published.stat().st_size > 0
    assert (job.output_dir / "merged.wav").read_bytes() == master.read_bytes()

    def packet_hashes(path):
        result = pipeline._run(
            [
                settings.ffprobe_path,
                "-v",
                "error",
                "-show_packets",
                "-show_data_hash",
                "sha256",
                "-show_entries",
                "packet=stream_index,data_hash",
                "-of",
                "json",
                str(path),
            ]
        )
        return [
            (item["stream_index"], item["data_hash"])
            for item in json.loads(result.stdout)["packets"]
        ]

    assert packet_hashes(primary) == packet_hashes(job.output_dir / "merged.mov")
