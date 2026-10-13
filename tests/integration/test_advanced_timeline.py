"""Actual FFmpeg acceptance for the advanced timeline."""

import json
import os
import shutil
import wave
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.jobs import (
    AudioMixSettings,
    ClipEdit,
    Job,
    MusicPlan,
    MusicSegment,
    OverlaySettings,
)
from backend.app.main import create_app
from backend.app.manifests import parse_advanced_manifest
from backend.app.media import MediaPipeline
from backend.app.storage import Storage
from tests.backend.advanced_fixtures import advanced_manifest
from tests.integration.advanced_fixtures import energy, make_song, make_video, pixel, probe, samples

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_FFMPEG_TESTS") != "1", reason="Real media opt-in required"
)


@pytest.fixture
def real_project(tmp_path):
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    assert ffmpeg and ffprobe
    settings = Settings(working_root=tmp_path / "work", ffmpeg_path=ffmpeg, ffprobe_path=ffprobe)
    pipeline = MediaPipeline(settings)
    job = Job.create(Storage(settings), "bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc")
    base = job.upload_dir / "base.mp4"
    take = job.upload_dir / "take.mp4"
    make_video(ffmpeg, base, "red")
    make_video(ffmpeg, take, "blue", 60, tone=880)
    job.advanced_plan = parse_advanced_manifest(advanced_manifest(), 2, 10)
    job.output_fps = 25
    job.video_source_paths = {"base": base, "take": take}
    pipeline.validate_job(job)
    return ffmpeg, ffprobe, pipeline, job


def test_real_replacement_picture_and_original_audio_priority(real_project):
    from backend.app.advanced_media import render_advanced_video

    ffmpeg, ffprobe, pipeline, job = real_project
    video, audio = render_advanced_video(pipeline, job, job.resolved_plan)
    assert [
        (pixel(ffmpeg, video, n)[0] > 200, pixel(ffmpeg, video, n)[2] > 200)
        for n in (39, 40, 99, 100)
    ] == [(True, False), (False, True), (False, True), (True, False)]
    with wave.open(str(audio), "rb") as pcm:
        assert pcm.getnframes() == 288000
    for start, expected, absent in [(0.5, 440, 880), (2.1, 880, 440), (4.5, 440, 880)]:
        values = samples(ffmpeg, audio, start, 0.3)
        assert energy(values, expected) > 10 * energy(values, absent)
    assert int(probe(ffprobe, video)["streams"][0]["nb_read_frames"]) == 150


def test_real_split_replacement_is_equivalent_to_unsplit(real_project):
    from backend.app.advanced_media import render_advanced_video

    ffmpeg, ffprobe, pipeline, job = real_project
    make_video(ffmpeg, job.video_source_paths["take"], "blue", 60, 30, 880)
    take = replace(
        job.advanced_plan.video2[0],
        edit=ClipEdit(0, 59, 0.5),
        content_in_frame=10,
        content_out_frame=60,
    )
    job.advanced_plan = replace(job.advanced_plan, video2=(take,))
    pipeline.validate_job(job)
    video, audio = render_advanced_video(pipeline, job, job.resolved_plan)
    with wave.open(str(audio), "rb") as pcm:
        before = pcm.readframes(pcm.getnframes())
    split = (
        replace(take, client_id="left", content_out_frame=30),
        replace(take, client_id="right", timeline_start_frame=60, content_in_frame=30),
    )
    job.advanced_plan = replace(job.advanced_plan, video2=split)
    pipeline.validate_job(job)
    video, audio = render_advanced_video(pipeline, job, job.resolved_plan)
    with wave.open(str(audio), "rb") as pcm:
        assert pcm.readframes(pcm.getnframes()) == before
    assert int(probe(ffprobe, video)["streams"][0]["nb_read_frames"]) == 150


def test_real_silent_replacement_and_pip_source_EOF(real_project):
    from backend.app.advanced_media import render_advanced_video

    ffmpeg, _, pipeline, job = real_project
    make_video(ffmpeg, job.video_source_paths["take"], "blue", 60, tone=None)
    pip = job.upload_dir / "pip.mp4"
    make_video(ffmpeg, pip, "lime", 10, tone=1200)
    job.video_overlay_path = pip
    job.video_overlay_settings = OverlaySettings(10, 49, "bottom-right", "small")
    pipeline.validate_job(job)
    video, audio = render_advanced_video(pipeline, job, job.resolved_plan)
    assert pixel(ffmpeg, video, 19, 1040, 600)[1] > 200
    assert pixel(ffmpeg, video, 20, 1040, 600)[0] > 200
    assert max(abs(v) for v in samples(ffmpeg, audio, 2.1, 0.3)) < 0.002


def test_real_music_deleted_middle_is_absent_and_later_moves(real_project):
    ffmpeg, ffprobe, pipeline, job = real_project
    song = job.upload_dir / "song.wav"
    make_song(song)
    job.background_audio_path = song
    music = MusicPlan(
        "song",
        (MusicSegment("left", "song", 25, 0, 50), MusicSegment("right", "song", 75, 144000, 125)),
    )
    job.advanced_plan = replace(job.advanced_plan, music=music)
    job.audio_mix = AudioMixSettings(0, True, 1, False)
    pipeline.validate_job(job)
    pipeline.merge(job)
    for start, tone in [(1.5, 330), (3.5, 990), (5.5, 990)]:
        values = samples(ffmpeg, job.result_path, start, 0.3)
        assert energy(values, tone) > 10 * energy(values, 660)
    assert max(abs(v) for v in samples(ffmpeg, job.result_path, 0.3, 0.3)) < 0.002
    info = probe(ffprobe, job.result_path)
    assert [v["codec_name"] for v in info["streams"]] == ["h264", "aac"]
    assert int(info["streams"][0]["nb_read_frames"]) == 150


def test_real_music_short_tail_is_silent(real_project):
    ffmpeg, _, pipeline, job = real_project
    song = job.upload_dir / "short.wav"
    make_song(song, 0.41)
    job.background_audio_path = song
    job.advanced_plan = replace(
        job.advanced_plan, music=MusicPlan("song", (MusicSegment("music", "song", 0, 0, 11),))
    )
    job.audio_mix = AudioMixSettings(0, True, 1, False)
    pipeline.validate_job(job)
    pipeline.merge(job)
    assert energy(samples(ffmpeg, job.result_path, 0.05, 0.25), 330) > 0.0001
    assert max(abs(v) for v in samples(ffmpeg, job.result_path, 1, 0.3)) < 0.002


def test_real_one_source_frame_at_higher_fps_remains_one_output_frame(real_project):
    from backend.app.advanced_media import render_advanced_video

    ffmpeg, ffprobe, pipeline, job = real_project
    make_video(ffmpeg, job.video_source_paths["take"], "blue", 60, fps=60)
    take = replace(
        job.advanced_plan.video2[0], edit=ClipEdit(0, 0, 1), content_in_frame=0, content_out_frame=1
    )
    job.advanced_plan = replace(job.advanced_plan, video2=(take,), output_fps=24)
    job.output_fps = 24
    pipeline.validate_job(job)
    video, audio = render_advanced_video(pipeline, job, job.resolved_plan)
    assert int(probe(ffprobe, video)["streams"][0]["nb_read_frames"]) == 144
    assert pixel(ffmpeg, video, 39)[0] > 200
    assert pixel(ffmpeg, video, 40)[2] > 200
    assert pixel(ffmpeg, video, 41)[0] > 200
    with wave.open(str(audio), "rb") as pcm:
        assert pcm.getnframes() == 288000


@pytest.mark.parametrize("invalid", ["source-range", "corrupt", "missing-song"])
def test_real_rejected_advanced_plan_never_queues_or_leaks(real_project, tmp_path, invalid):
    ffmpeg, ffprobe, _, job = real_project
    settings = Settings(
        working_root=tmp_path / "api-work", ffmpeg_path=ffmpeg, ffprobe_path=ffprobe
    )
    manifest = advanced_manifest()
    take_bytes = job.video_source_paths["take"].read_bytes()
    if invalid == "source-range":
        manifest["video2"][0]["content_out_frame"] = 100
    elif invalid == "corrupt":
        take_bytes = b"not a video"
    else:
        manifest["music"] = {
            "source_id": "song",
            "segments": [
                {
                    "client_id": "song-part",
                    "source_id": "song",
                    "timeline_start_frame": 0,
                    "source_start_sample": 0,
                    "duration_frames": 1,
                }
            ],
        }
    with TestClient(create_app(settings=settings)) as client:
        response = client.post(
            "/api/merge",
            data={"manifest": json.dumps(manifest)},
            files=[
                ("files", ("base.mp4", job.video_source_paths["base"].read_bytes(), "video/mp4")),
                ("files", ("take.mp4", take_bytes, "video/mp4")),
            ],
        )
        assert response.status_code == 422, response.text
        assert not list(settings.upload_root.iterdir())
        assert not list(settings.intermediate_root.iterdir())
        assert not list(settings.output_root.iterdir())
