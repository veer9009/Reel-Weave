"""Real decoded-PCM oracles for V3 ownership, gains, EOF and frozen recipes."""

import math
import os
import struct
import wave
from dataclasses import replace

import pytest

from backend.app.advanced_media import render_audio_master, render_v3_picture
from backend.app.errors import ApiError
from backend.app.jobs import (
    AudioFileRecipe,
    AudioMixSettings,
    AudioSourceDescriptor,
    IndependentAudioSegment,
    MusicPlan,
    MusicSegment,
    OverlaySettings,
    VideoEditRecipe,
)
from tests.integration.advanced_fixtures import energy, make_video, pixel, probe, samples
from tests.integration.test_timeline_audio_exports import project as project

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_FFMPEG_TESTS") != "1", reason="Real FFmpeg tests are opt-in."
)

K = 1920


def write_pcm(path, count, *, amplitude=5000, tone=660):
    values = []
    for i in range(count):
        left = round(amplitude * math.sin(2 * math.pi * tone * i / 48000)) if tone else amplitude
        # Distinct channel content catches accidental mono output or channel swapping.
        values.extend((left, -left // 2))
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(48000)
        out.writeframes(struct.pack(f"<{len(values)}h", *values))


def pcm_values(path):
    with wave.open(str(path), "rb") as source:
        assert (source.getframerate(), source.getnchannels(), source.getsampwidth()) == (
            48000,
            2,
            2,
        )
        raw = source.readframes(source.getnframes())
        assert len(raw) == source.getnframes() * 4
    return struct.unpack(f"<{len(raw) // 2}h", raw)


def external(job, source_id, *, count=30 * K, amplitude=5000, tone=660):
    path = job.upload_dir / f"{source_id}.wav"
    write_pcm(path, count, amplitude=amplitude, tone=tone)
    job.audio_source_paths[source_id] = path
    job.v3_plan = replace(
        job.v3_plan,
        audio_sources=(*job.v3_plan.audio_sources, AudioSourceDescriptor(source_id)),
    )
    return path


def render_values(pipeline, job):
    pipeline.validate_job(job)
    return pcm_values(render_audio_master(pipeline, job, job.resolved_plan))


def expected_master(job):
    """Independent integer oracle from decoded pre-gain PCM and resolved ownership."""
    plan = job.resolved_plan
    k = 48000 // plan.output_fps
    original = [0] * (plan.total_frames * k * 2)
    for item in plan.audio_slices:
        if item.source is None:
            continue
        path = (
            job.decoded_audio_paths[item.source.source_id]
            if isinstance(item.source, AudioFileRecipe)
            else job.recipe_audio_paths[item.source]
        )
        decoded = pcm_values(path)
        length = (item.end_frame_exclusive - item.start_frame) * k * 2
        start = item.start_frame * k * 2
        values = decoded[item.source_start_sample * 2 : item.source_start_sample * 2 + length]
        original[start : start + len(values)] = values
    music = [0] * len(original)
    if plan.music:
        decoded = pcm_values(job.decoded_audio_paths[plan.music.source_id])
        for item in plan.music.segments:
            start = item.timeline_start_frame * k * 2
            length = max(0, min(item.duration_frames * k * 2, len(music) - start))
            values = decoded[item.source_start_sample * 2 : item.source_start_sample * 2 + length]
            music[start : start + len(values)] = values
    mix = job.audio_mix
    og = 0 if mix.original_muted else mix.original_volume
    mg = 0 if mix.music_muted else mix.music_volume
    return tuple(
        max(-32768, min(32767, round(a * og + b * mg)))
        for a, b in zip(original, music, strict=True)
    )


def assert_pcm_matches(actual, expected):
    assert len(actual) == len(expected)
    assert max(abs(a - b) for a, b in zip(actual, expected, strict=True)) <= 1


def test_two_gain_buses_and_mutes_apply_once_to_pre_gain_pcm(project):
    _, _, _, pipeline, job, _ = project
    external(job, "music")
    job.v3_plan = replace(
        job.v3_plan,
        music=MusicPlan("music", (MusicSegment("song", "music", 0, 0, 30),)),
    )
    for original_muted, music_muted in ((False, False), (True, False), (False, True), (True, True)):
        job.audio_mix = AudioMixSettings(0.5, original_muted, 0.25, music_muted)
        job.v3_plan = replace(job.v3_plan, audio_mix=job.audio_mix)
        actual = render_values(pipeline, job)
        assert_pcm_matches(actual, expected_master(job))
        if original_muted and music_muted:
            assert set(actual) == {0}
        else:
            assert max(actual) > 100


def test_pcm16_mix_saturates_without_normalization_or_limiter(project):
    _, _, _, pipeline, job, _ = project
    external(job, "voice", amplitude=24000, tone=0)
    external(job, "music", amplitude=24000, tone=0)
    job.v3_plan = replace(
        job.v3_plan,
        independent_audio=(IndependentAudioSegment("voice", 0, 30, 0, AudioFileRecipe("voice")),),
        music=MusicPlan("music", (MusicSegment("song", "music", 0, 0, 30),)),
    )
    job.audio_mix = AudioMixSettings(1, False, 1, False)
    actual = render_values(pipeline, job)
    assert_pcm_matches(actual, expected_master(job))
    assert set(actual[::2]) == {32767}
    assert set(actual[1::2]) == {-24000}


def test_silent_independent_audio_masks_linked_base_and_replacement(project):
    ffmpeg, _, _, pipeline, job, _ = project
    external(job, "silence", count=20 * K, amplitude=0)
    job.v3_plan = replace(
        job.v3_plan,
        independent_audio=(IndependentAudioSegment("quiet", 5, 20, 0, AudioFileRecipe("silence")),),
    )
    actual = render_values(pipeline, job)
    assert len(actual) == 30 * K * 2
    assert set(actual[5 * K * 2 : 25 * K * 2]) == {0}
    assert max(abs(v) for v in actual[: 5 * K * 2]) > 100
    assert max(abs(v) for v in actual[25 * K * 2 :]) > 100
    assert_pcm_matches(actual, expected_master(job))
    assert energy(samples(ffmpeg, job.audio_master_path, 0.02, 0.12), 440) > 1e-5


def test_sources_without_audio_generate_exact_silent_master(project):
    ffmpeg, _, _, pipeline, job, _ = project
    make_video(ffmpeg, job.video_source_paths["base"], "red", frames=30, fps=25, tone=None)
    make_video(ffmpeg, job.video_source_paths["take"], "blue", frames=10, fps=25, tone=None)
    actual = render_values(pipeline, job)
    assert len(actual) == 30 * K * 2
    assert set(actual) == {0}
    assert_pcm_matches(actual, expected_master(job))


@pytest.mark.parametrize("lane", ["independent", "music"])
@pytest.mark.parametrize("shortfall,accepted", [(K - 1, True), (K, False)])
def test_external_audio_eof_threshold_uses_decoded_samples(project, lane, shortfall, accepted):
    _, _, _, pipeline, job, _ = project
    external(job, "edge", count=10 * K - shortfall, amplitude=5000, tone=0)
    if lane == "independent":
        job.v3_plan = replace(
            job.v3_plan,
            independent_audio=(
                IndependentAudioSegment("edge", 10, 10, 0, AudioFileRecipe("edge")),
            ),
        )
    else:
        job.audio_mix = AudioMixSettings(0, True, 1, False)
        job.v3_plan = replace(
            job.v3_plan,
            music=MusicPlan("edge", (MusicSegment("edge", "edge", 10, 0, 10),)),
        )
    if not accepted:
        with pytest.raises(ApiError) as error:
            pipeline.validate_job(job)
        assert error.value.status_code == 422
        assert error.value.code == "invalid_range"
        assert job.resolved_plan is None
        return
    actual = render_values(pipeline, job)
    decoded = pcm_values(job.decoded_audio_paths["edge"])
    assert len(decoded) // 2 == 10 * K - shortfall
    assert actual[10 * K * 2 : (10 * K + len(decoded) // 2) * 2] == decoded
    assert set(actual[(20 * K - shortfall) * 2 : 20 * K * 2]) == {0}
    assert_pcm_matches(actual, expected_master(job))


def test_audio_tails_clip_at_video1_end_without_extension(project):
    _, _, _, pipeline, job, _ = project
    external(job, "voice", count=40 * K, amplitude=3000, tone=330)
    external(job, "music", count=40 * K, amplitude=5000, tone=660)
    job.v3_plan = replace(
        job.v3_plan,
        independent_audio=(IndependentAudioSegment("tail", 20, 20, 0, AudioFileRecipe("voice")),),
        music=MusicPlan("music", (MusicSegment("longsong", "music", 0, 0, 40),)),
    )
    actual = render_values(pipeline, job)
    assert len(actual) == 30 * K * 2
    assert_pcm_matches(actual, expected_master(job))
    assert len(pcm_values(job.decoded_audio_paths["voice"])) == 40 * K * 2


def test_music_removed_middle_preserves_existing_gap_and_later_position(project):
    _, _, _, pipeline, job, _ = project
    external(job, "music", count=20 * K, amplitude=5000, tone=0)
    job.audio_mix = AudioMixSettings(1, True, 1, False)
    job.v3_plan = replace(
        job.v3_plan,
        music=MusicPlan(
            "music",
            (
                MusicSegment("left", "music", 2, 0, 5),
                MusicSegment("right", "music", 20, 10 * K, 5),
            ),
        ),
    )
    actual = render_values(pipeline, job)
    for a, b in ((0, 2), (7, 20), (25, 30)):
        assert set(actual[a * K * 2 : b * K * 2]) == {0}
    for a, b in ((2, 7), (20, 25)):
        assert set(actual[a * K * 2 : b * K * 2 : 2]) == {5000}
    assert_pcm_matches(actual, expected_master(job))


def test_slow_frozen_recipe_retains_pitch_and_captured_normalization_fps(project):
    ffmpeg, _, _, pipeline, job, _ = project
    frozen = VideoEditRecipe("base", 0, 19, 0.5, 24)
    owner = replace(job.v3_plan.clips[0], edit=replace(job.v3_plan.clips[0].edit, speed=0.75))
    job.v3_plan = replace(
        job.v3_plan,
        clips=(owner,),
        video2=(),
        independent_audio=(IndependentAudioSegment("frozen", 0, 30, 0, frozen),),
    )
    actual25 = render_values(pipeline, job)
    recipe_path = job.recipe_audio_paths[frozen]
    recipe_pcm = pcm_values(recipe_path)
    assert len(recipe_pcm) == 38 * (48000 // 24) * 2
    assert_pcm_matches(actual25, recipe_pcm[: 30 * K * 2])
    sound = samples(ffmpeg, job.audio_master_path, 0.1, 0.8)
    assert energy(sound, 440) > 100 * energy(sound, 220)
    job.v3_plan = replace(job.v3_plan, output_fps=30)
    job.output_fps = 30
    actual30 = render_values(pipeline, job)
    assert job.recipe_audio_paths[frozen] == recipe_path
    assert pcm_values(recipe_path) == recipe_pcm
    assert_pcm_matches(actual30, actual25[: 30 * (48000 // 30) * 2])


def test_pip_sound_is_excluded_and_picture_ends_at_true_source_eof(project):
    ffmpeg, ffprobe, _, pipeline, job, _ = project
    before = render_values(pipeline, job)
    pip = job.upload_dir / "pip.mp4"
    make_video(ffmpeg, pip, "lime", frames=5, fps=25, tone=1600)
    job.video_overlay_path = pip
    job.video_overlay_settings = OverlaySettings(0, 29, "top-left", "small")
    after = render_values(pipeline, job)
    assert after == before
    picture = render_v3_picture(pipeline, job, job.resolved_plan)
    assert pixel(ffmpeg, picture, 0, 100, 100)[1] > 200
    assert pixel(ffmpeg, picture, 4, 100, 100)[1] > 200
    assert pixel(ffmpeg, picture, 5, 100, 100)[0] > 200
    assert pixel(ffmpeg, picture, 15, 100, 100)[2] > 200
    metadata = probe(ffprobe, picture)
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    assert int(video["nb_read_frames"]) == 30
    assert not any(s["codec_type"] == "audio" for s in metadata["streams"])
