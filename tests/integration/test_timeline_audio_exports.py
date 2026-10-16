"""Real V3 source ownership, exact PCM and four-format worker acceptance."""

import json
import os
import shutil
import struct
import time
import wave
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.jobs import IndependentAudioSegment, Job, VideoEditRecipe
from backend.app.main import _parse_manifest, create_app
from backend.app.media import MediaPipeline, ProcessingError
from backend.app.storage import Storage
from tests.backend.advanced_fixtures import v3_manifest
from tests.integration.advanced_fixtures import energy, make_video, pixel, probe, samples

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_FFMPEG_TESTS") != "1", reason="Real media opt-in required"
)


@pytest.fixture
def project(tmp_path):
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    assert ffmpeg and ffprobe
    settings = Settings(working_root=tmp_path / "work", ffmpeg_path=ffmpeg, ffprobe_path=ffprobe)
    pipeline = MediaPipeline(settings)
    job = Job.create(Storage(settings), "abababab-abab-4bab-8bab-abababababab")
    base, take = job.upload_dir / "base.mp4", job.upload_dir / "take.mp4"
    make_video(ffmpeg, base, "red", frames=30, fps=25, tone=440)
    make_video(ffmpeg, take, "blue", frames=10, fps=25, tone=880)
    m = v3_manifest()
    m["clips"][0].update(end_frame=29, duration_frames=30, output_out_frame=30)
    m["video2"][0].update(end_frame=9, timeline_start_frame=10, content_out_frame=10)
    job.v3_plan = _parse_manifest(json.dumps(m), 2, 10)
    job.video_source_paths = {"base": base, "take": take}
    job.output_fps = 25
    return ffmpeg, ffprobe, settings, pipeline, job, m


def pcm(path):
    with wave.open(str(path), "rb") as f:
        assert (f.getframerate(), f.getnchannels(), f.getsampwidth()) == (48000, 2, 2)
        return f.getnframes(), f.readframes(f.getnframes())


def test_detach_preserves_canonical_pcm_and_lift_silence(project):
    from backend.app.advanced_media import render_audio_master

    ffmpeg, _, _, pipeline, job, _ = project
    pipeline.validate_job(job)
    before = pcm(render_audio_master(pipeline, job, job.resolved_plan))
    take = job.v3_plan.video2[0]
    recipe = VideoEditRecipe("take", 0, 9, 1, 25)
    job.v3_plan = replace(
        job.v3_plan,
        video2=(replace(take, original_audio="detached"),),
        independent_audio=(IndependentAudioSegment("detached", 10, 10, 0, recipe),),
    )
    pipeline.validate_job(job)
    assert pcm(render_audio_master(pipeline, job, job.resolved_plan)) == before
    job.v3_plan = replace(job.v3_plan, independent_audio=())
    pipeline.validate_job(job)
    path = render_audio_master(pipeline, job, job.resolved_plan)
    count, raw = pcm(path)
    assert count == 30 * 1920
    assert set(raw[10 * 1920 * 4 : 20 * 1920 * 4]) == {0}
    assert energy(samples(ffmpeg, path, 0.1, 0.2), 440) > 1e-5
    job.v3_plan = replace(
        job.v3_plan,
        video2=(),
        independent_audio=(IndependentAudioSegment("detached", 10, 10, 0, recipe),),
    )
    pipeline.validate_job(job)
    assert pcm(render_audio_master(pipeline, job, job.resolved_plan)) == before


def wait(client, job_id):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        status = client.get(f"/api/jobs/{job_id}").json()
        if status["status"] in ("completed", "failed"):
            assert status["status"] == "completed", status
            return status
        time.sleep(0.05)
    pytest.fail("Real V3 worker did not finish")


def submit(client, job, m, audio_paths=()):
    with (
        job.video_source_paths["base"].open("rb") as base,
        job.video_source_paths["take"].open("rb") as take,
    ):
        response = client.post(
            "/api/merge",
            data={"manifest": json.dumps(m)},
            files=[
                ("files", ("base.mp4", base, "video/mp4")),
                ("files", ("take.mp4", take, "video/mp4")),
                *[
                    ("audio_files", (path.name, path.read_bytes(), "audio/wav"))
                    for path in audio_paths
                ],
            ],
        )
    assert response.status_code == 202, response.text
    return response.json()["job_id"]


def packet_hashes(ffprobe, path):
    import subprocess

    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_packets",
            "-show_data_hash",
            "sha256",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    return [(p["stream_index"], p["data_hash"]) for p in json.loads(result.stdout)["packets"]]


def assert_final_sound(reference, decoded, edge_padding):
    """Lossy delivery keeps interior ownership, energy, silence and impulse timing."""
    assert abs(len(decoded) - len(reference)) <= edge_padding
    for start, end, tone, excluded in [
        (0.1, 0.3, 440, 880),
        (0.44, 0.6, 880, 440),
        (0.9, 1.1, 440, 880),
    ]:
        a, b = round(start * 48000), round(end * 48000)
        expected, actual = energy(reference[a:b], tone), energy(decoded[a:b], tone)
        assert expected > 1e-5
        assert 0.7 * expected <= actual <= 1.3 * expected
        assert actual > 20 * energy(decoded[a:b], excluded)
    # Marker owns frames16..20, so silence must not expose linked picture audio.
    quiet = decoded[round(0.66 * 48000) : round(0.69 * 48000)]
    assert quiet and sum(v * v for v in quiet) / len(quiet) < 1e-7

    def impulse_centre(values):
        start, end = round(0.70 * 48000), round(0.75 * 48000)
        power = [v * v for v in values[start:end]]
        total = sum(power)
        assert total > 0.5, "The final-format impulse is missing."
        return (start + sum(i * v for i, v in enumerate(power)) / total) / 48000

    assert abs(impulse_centre(decoded) - impulse_centre(reference)) <= 0.01


def test_final_sound_oracle_rejects_silent_or_shifted_delivery():
    import math

    reference = [0.0] * 57600
    for a, b, tone in [(0, 19200, 440), (19200, 30720, 880), (38400, 57600, 440)]:
        for n in range(a, b):
            reference[n] = 0.08 * math.sin(2 * math.pi * tone * n / 48000)
    reference[34560:34624] = [0.5] * 64
    assert_final_sound(reference, reference, 0)
    with pytest.raises(AssertionError):
        assert_final_sound(reference, [0.0] * len(reference), 1152)
    with pytest.raises(AssertionError):
        assert_final_sound(reference, [0.0] * 2400 + reference[:-2400], 1152)


def test_real_v3_multipart_four_exports_and_retained_downloads(project, tmp_path):
    ffmpeg, ffprobe, settings, _, job, m = project
    m["exports"] = ["mp4", "mov", "wav", "mp3"]
    marker = tmp_path / "impulse.wav"
    values = [0] * (4 * 1920)
    values[3840:3904] = [18000] * 64
    with wave.open(str(marker), "wb") as output:
        output.setparams((2, 2, 48000, len(values), "NONE", "not compressed"))
        output.writeframes(
            struct.pack(f"<{len(values) * 2}h", *(v for sample in values for v in (sample, sample)))
        )
    m["audio_sources"] = [{"source_id": "marker"}]
    m["independent_audio"] = [
        {
            "id": "impulse",
            "timeline_start_frame": 16,
            "duration_frames": 4,
            "source_start_sample": 0,
            "source": {"kind": "audio-file", "source_id": "marker"},
        }
    ]
    with TestClient(create_app(settings)) as client:
        job_id = submit(client, job, m, [marker])
        status = wait(client, job_id)
        for fmt in m["exports"]:
            assert status["exports"][fmt]["status"] == "ready", status
            response = client.get(status["exports"][fmt]["download_url"])
            assert response.status_code == 200
            (tmp_path / f"result.{fmt}").write_bytes(response.content)
        assert pcm(tmp_path / "result.wav")[0] == 30 * 1920
        reference = samples(ffmpeg, tmp_path / "result.wav", 0, 2)
        for fmt, padding in [("mp4", 1024), ("mov", 1024), ("mp3", 1152)]:
            assert_final_sound(
                reference, samples(ffmpeg, tmp_path / f"result.{fmt}", 0, 2), padding
            )
        for fmt in ("mp4", "mov"):
            streams = probe(ffprobe, tmp_path / f"result.{fmt}")["streams"]
            assert (
                int(next(s for s in streams if s["codec_type"] == "video")["nb_read_frames"]) == 30
            )
            assert pixel(ffmpeg, tmp_path / f"result.{fmt}", 9)[0] > 200
            assert pixel(ffmpeg, tmp_path / f"result.{fmt}", 10)[2] > 200
        assert packet_hashes(ffprobe, tmp_path / "result.mp4") == packet_hashes(
            ffprobe, tmp_path / "result.mov"
        )
        mp3 = probe(ffprobe, tmp_path / "result.mp3")["streams"][0]
        assert (
            mp3["codec_name"] == "mp3"
            and mp3["sample_rate"] == "48000"
            and mp3["bit_rate"] == "320000"
        )
        assert client.get(f"/api/jobs/{job_id}/download").status_code == 200


def test_real_optional_encoder_failure_preserves_primary(project, monkeypatch):
    from backend.app import exports

    _, _, settings, _, job, m = project
    original = exports.render_optional_export

    def failing(pipeline, job, format, primary, master, plan):
        if format == "mp3":
            raise ProcessingError("controlled failure")
        return original(pipeline, job, format, primary, master, plan)

    monkeypatch.setattr(exports, "render_optional_export", failing)
    m["exports"] = ["mp4", "mp3", "wav"]
    with TestClient(create_app(settings)) as client:
        job_id = submit(client, job, m)
        status = wait(client, job_id)
        assert status["exports"]["mp3"]["status"] == "failed"
        assert status["exports"]["wav"]["status"] == "ready"
        assert client.get(f"/api/jobs/{job_id}/exports/mp4").status_code == 200
        failure = client.get(f"/api/jobs/{job_id}/exports/mp3")
        assert failure.status_code == 409 and failure.json()["error"]["code"] == "export_failed"


def test_overwrite_preserves_every_outside_normalized_frame(project):
    from backend.app.advanced_media import render_v3_picture
    from tests.integration.advanced_fixtures import frame_markers, make_marked_video

    ffmpeg, _, _, pipeline, job, m = project
    sources = {}
    for sid, frames, fps, phase in [
        ("a", 12, 24, 0),
        ("b", 10, 30, 35),
        ("c", 8, 25, 70),
        ("x", 19, 25, 105),
    ]:
        path = job.upload_dir / f"{sid}.mkv"
        make_marked_video(ffmpeg, path, frames, fps, phase)
        sources[sid] = path

    def clip(id, sid, end, speed, start, a, b):
        return {
            "client_id": id,
            "source_id": sid,
            "start_frame": 0,
            "end_frame": end,
            "speed": speed,
            "trim_saved": True,
            "original_audio": "linked",
            "timeline_start_frame": start,
            "duration_frames": b - a,
            "output_in_frame": a,
            "output_out_frame": b,
        }

    m["video_sources"] = [{"source_id": s} for s in sources]
    m["clips"] = [
        clip("a-left", "a", 11, 0.75, 0, 0, 5),
        clip("overwrite", "x", 18, 1, 5, 0, 19),
        clip("b-right", "b", 9, 0.5, 24, 7, 17),
        clip("c-unchanged", "c", 7, 1, 34, 0, 8),
    ]
    m["order"] = [v["client_id"] for v in m["clips"]]
    m["video2"] = [
        {
            "client_id": "replacement",
            "source_id": "x",
            "start_frame": 0,
            "end_frame": 18,
            "speed": 1,
            "trim_saved": True,
            "original_audio": "linked",
            "timeline_start_frame": 31,
            "content_in_frame": 2,
            "content_out_frame": 7,
            "content_full_source": False,
        }
    ]
    job.video_source_paths = sources
    job.v3_plan = _parse_manifest(json.dumps(m), 4, 10)
    pipeline.validate_job(job)
    actual = frame_markers(ffmpeg, render_v3_picture(pipeline, job, job.resolved_plan))
    assert len(actual) == 42
    normalized = {
        name: frame_markers(ffmpeg, job.intermediate_dir / f"advanced-normal-{i:03d}.mp4")
        for i, name in enumerate(["a-left", "overwrite", "b-right", "c-unchanged"])
    }
    normalized["replacement"] = normalized["overwrite"]
    for s in job.resolved_plan.slices:
        expected = normalized[s.occurrence_id][
            s.content_start_frame : s.content_start_frame + s.end_frame_exclusive - s.start_frame
        ]
        assert len(expected) == s.end_frame_exclusive - s.start_frame
        for observed, wanted in zip(
            actual[s.start_frame : s.end_frame_exclusive], expected, strict=True
        ):
            assert max(abs(a - b) for a, b in zip(observed, wanted, strict=True)) <= 4


def test_real_primary_probe_failure_exposes_no_partial(project, monkeypatch):
    from backend.app import exports

    _, _, settings, _, job, m = project
    original = exports.validate_artifact
    validated = []

    def fail_after_real_probe(pipeline, path, format, plan):
        original(pipeline, path, format, plan)
        validated.append(format)
        if format == "mp4":
            raise ProcessingError("controlled primary validation failure")

    monkeypatch.setattr(exports, "validate_artifact", fail_after_real_probe)
    m["exports"] = ["mp4", "wav"]
    with TestClient(create_app(settings)) as client:
        job_id = submit(client, job, m)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            status = client.get(f"/api/jobs/{job_id}").json()
            if status["status"] == "failed":
                break
            time.sleep(0.05)
        assert status["status"] == "failed", status
        assert validated == ["mp4"]
        assert all(
            s["status"] == "failed" and "download_url" not in s for s in status["exports"].values()
        )
        assert client.get(f"/api/jobs/{job_id}/exports/mp4").status_code == 409
        assert list(client.app.state.registry.get(job_id).output_dir.iterdir()) == []


def test_real_invalid_window_rejected_before_queue_and_cleaned(project):
    _, _, settings, _, job, m = project
    m["clips"][0].update(duration_frames=31, output_out_frame=31)
    with TestClient(create_app(settings)) as client:
        with (
            job.video_source_paths["base"].open("rb") as base,
            job.video_source_paths["take"].open("rb") as take,
        ):
            response = client.post(
                "/api/merge",
                data={"manifest": json.dumps(m)},
                files=[
                    ("files", ("base.mp4", base, "video/mp4")),
                    ("files", ("take.mp4", take, "video/mp4")),
                ],
            )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "invalid_range"
        assert response.json()["error"]["segment_id"] == "main"
        assert client.app.state.registry.known_ids() == set()
        assert client.app.state.job_manager.queue.empty()
        for root in client.app.state.storage.roots:
            assert [p.name for p in root.iterdir()] == [job.id]
