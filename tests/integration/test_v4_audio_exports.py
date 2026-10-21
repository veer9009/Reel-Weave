"""Independent PCM and delivery oracles for multiple music source windows."""

import json
import math
import os
import struct
import subprocess
import wave

import pytest
from fastapi.testclient import TestClient

from backend.app.advanced_media import render_audio_master
from backend.app.main import _parse_manifest, create_app
from tests.integration.advanced_fixtures import pixel, probe
from tests.integration.test_timeline_audio_exports import project as project
from tests.integration.test_timeline_audio_exports import submit, wait
from tests.integration.test_v3_audio_invariants import pcm_values, write_pcm

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_FFMPEG_TESTS") != "1", reason="Real FFmpeg tests are opt-in."
)


def test_real_v4_music_windows_match_independent_stereo_pcm(project):
    _, _, _, pipeline, job, m = project
    a, b = job.upload_dir / "a.wav", job.upload_dir / "b.wav"
    write_pcm(a, 192000, tone=330)
    write_pcm(b, 192000, tone=990)
    m.update(schema_version=4, audio_sources=[{"source_id": "a"}, {"source_id": "b"}])
    m["audio"].update(original_muted=True, music_volume=1)
    m["music"] = {
        "segments": [
            {
                "client_id": "a-left",
                "source_id": "a",
                "timeline_start_frame": 0,
                "source_start_sample": 4800,
                "duration_frames": 10,
            },
            {
                "client_id": "b",
                "source_id": "b",
                "timeline_start_frame": 10,
                "source_start_sample": 9600,
                "duration_frames": 10,
            },
            {
                "client_id": "a-right",
                "source_id": "a",
                "timeline_start_frame": 20,
                "source_start_sample": 24000,
                "duration_frames": 10,
            },
        ]
    }
    job.v3_plan = _parse_manifest(json.dumps(m), 2, 10)
    job.audio_source_paths = {"a": a, "b": b}
    job.audio_mix = job.v3_plan.audio_mix
    pipeline.validate_job(job)
    actual = pcm_values(render_audio_master(pipeline, job, job.resolved_plan))
    pa, pb = pcm_values(a), pcm_values(b)
    expected = pa[9600:48000] + pb[19200:57600] + pa[48000:86400]
    assert len(actual) == len(expected) == 115200
    assert max(abs(x - y) for x, y in zip(actual, expected, strict=True)) <= 1


def assert_delivery_pcm(actual, expected, *, lossless):
    if lossless:
        assert len(actual) == len(expected)
        assert max(abs(a - b) for a, b in zip(actual, expected, strict=True)) <= 1
        return
    # Codec padding is permitted only at EOF; no edited-output alignment search.
    assert abs(len(actual) - len(expected)) <= 2 * 1152
    active = [(i, v) for i, v in enumerate(expected) if v]
    want = sum(v * v for _, v in active)
    got = sum(actual[i] * actual[i] for i, _ in active)
    dot = sum(actual[i] * v for i, v in active)
    assert want > 0 and got > 0
    assert 0.7 * want <= got <= 1.3 * want
    assert dot / math.sqrt(want * got) > 0.98


def test_delivery_oracle_rejects_missing_shifted_doubled_or_wrong_channel_audio():
    expected = tuple(
        v
        for n in range(9600)
        for v in (round(5000 * math.sin(n * n / 40000)), round(1500 * math.cos(n / 37)))
    )
    assert_delivery_pcm(expected, expected, lossless=False)
    for corrupted in (
        [0] * len(expected),
        [0] * 3840 + list(expected[:-3840]),
        [2 * v for v in expected],
        [expected[i ^ 1] for i in range(len(expected))],
    ):
        with pytest.raises(AssertionError):
            assert_delivery_pcm(corrupted, expected, lossless=False)


def write_chirp(path, frequency, rate):
    values = []
    for n in range(192000):
        t = n / 48000
        sample = round(5000 * math.sin(2 * math.pi * (frequency * t + rate * t * t / 2)))
        values.extend((sample, -sample // 2))
    with wave.open(str(path), "wb") as out:
        out.setparams((2, 2, 48000, 192000, "NONE", "not compressed"))
        out.writeframes(struct.pack(f"<{len(values)}h", *values))


def test_one_source_shared_by_both_buses_is_uploaded_once_and_gained_once(project):
    _, _, _, pipeline, job, m = project
    a = job.upload_dir / "shared.wav"
    write_pcm(a, 192000, tone=660)
    m.update(schema_version=4, audio_sources=[{"source_id": "shared"}])
    m["audio"].update(original_volume=0.5, music_volume=0.25)
    m["independent_audio"] = [
        dict(
            id="original",
            timeline_start_frame=0,
            duration_frames=30,
            source_start_sample=4800,
            source={"kind": "audio-file", "source_id": "shared"},
        )
    ]
    m["music"] = {
        "segments": [
            dict(
                client_id="music",
                source_id="shared",
                timeline_start_frame=0,
                duration_frames=30,
                source_start_sample=4800,
            )
        ]
    }
    job.v3_plan = _parse_manifest(json.dumps(m), 2, 10)
    job.audio_source_paths = {"shared": a}
    job.audio_mix = job.v3_plan.audio_mix
    pipeline.validate_job(job)
    actual = pcm_values(render_audio_master(pipeline, job, job.resolved_plan))
    expected = [round(v * 0.75) for v in pcm_values(a)[9600:124800]]
    assert len(actual) == len(expected) == 115200
    assert max(abs(a - b) for a, b in zip(actual, expected, strict=True)) <= 1


@pytest.mark.parametrize("fps,total_frames", [(24, 29), (25, 30), (30, 36), (50, 60), (60, 72)])
@pytest.mark.parametrize("lane", ["independent", "detached", "music"])
@pytest.mark.parametrize(
    "action", ["split", "move", "trim-start", "trim-end", "delete", "lift", "replace"]
)
def test_each_audio_edit_in_every_delivery_format(
    project, tmp_path, fps, total_frames, lane, action, recipe_speed=1
):
    ffmpeg, ffprobe, settings, _, job, m = project
    k = 48000 // fps
    a, b = job.upload_dir / "a.wav", job.upload_dir / "b.wav"
    # Chirps expose source-offset errors even at integer tone cycles per frame.
    write_chirp(a, 330, 400)
    write_chirp(b, 990, 200)
    decoded_base = tmp_path / "base-pcm.wav"
    # Frozen offsets address the existing normalized video-edit recipe, not raw
    # container PCM. Decode this untouched fixture independently before applying
    # the authored edit map; do not align against or inspect rendered output.
    recipe_samples = {1: total_frames * k, 0.75: 76800, 0.5: 115200}[recipe_speed]
    normalization = (
        f"atrim=start=0:end=1.2,asetpts=PTS-STARTPTS,atempo={recipe_speed:g},aresample=48000,"
        "aformat=channel_layouts=stereo,"
        f"apad=whole_len={recipe_samples},atrim=end_sample={recipe_samples},"
        "asetpts=PTS-STARTPTS"
    )
    subprocess.run(
        [
            ffmpeg,
            "-v",
            "error",
            "-y",
            "-i",
            str(job.video_source_paths["base"]),
            "-map",
            "0:a:0",
            "-af",
            normalization,
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(decoded_base),
        ],
        check=True,
        capture_output=True,
    )
    raw = {"a": pcm_values(decoded_base if lane == "detached" else a), "b": pcm_values(b)}
    # Authored expected final events, independent of editor and render-plan helpers.
    events = [("a", 4, 8, 4800), ("a", 12, 8, 4800 + 8 * k)]
    if action == "move":
        events[1] = ("a", 20, 8, 4800 + 8 * k)
    if action == "trim-start":
        events[1] = ("a", 14, 6, 4800 + 10 * k)
    if action == "trim-end":
        events[1] = ("a", 12, 6, 4800 + 8 * k)
    if action == "delete":
        events = [("a", 4, 8, 4800 + 8 * k)]
    if action == "lift":
        events = [("a", 12, 8, 4800 + 8 * k)]
    if action == "replace":
        events[1] = ("b", 12, 8, 0)
    expected = [0] * (total_frames * k * 2)
    for source, start, duration, offset in events:
        values = raw[source][offset * 2 : (offset + duration * k) * 2]
        expected[start * k * 2 : start * k * 2 + len(values)] = values
    m.update(schema_version=4, output_fps=fps, exports=["mp4", "mov", "wav", "mp3"])
    m["clips"][0].update(
        duration_frames=total_frames, output_out_frame=total_frames, original_audio="detached"
    )
    m["video2"][0]["original_audio"] = "detached"
    m["audio"].update(original_volume=1, original_muted=False, music_volume=1, music_muted=False)
    file_refs = sorted({source for source, *_ in events if lane != "detached" or source == "b"})
    m["audio_sources"] = [{"source_id": source} for source in file_refs]
    if lane == "music":
        m["music"] = {
            "segments": [
                dict(
                    client_id=f"piece-{i}",
                    source_id=source,
                    timeline_start_frame=start,
                    duration_frames=duration,
                    source_start_sample=offset,
                )
                for i, (source, start, duration, offset) in enumerate(events)
            ]
        }
    else:
        m["independent_audio"] = [
            dict(
                id=f"piece-{i}",
                timeline_start_frame=start,
                duration_frames=duration,
                source_start_sample=offset,
                source=(
                    {
                        "kind": "video-edit",
                        "source_id": "base",
                        "source_start_frame": 0,
                        "source_end_frame": 29,
                        "speed": recipe_speed,
                        "normalization_fps": fps,
                    }
                    if lane == "detached" and source == "a"
                    else {"kind": "audio-file", "source_id": source}
                ),
            )
            for i, (source, start, duration, offset) in enumerate(events)
        ]
    with TestClient(create_app(settings)) as client:
        status = wait(client, submit(client, job, m, [{"a": a, "b": b}[sid] for sid in file_refs]))
        for fmt in m["exports"]:
            assert status["exports"][fmt]["status"] == "ready", status
            result = tmp_path / f"{lane}-{action}.{fmt}"
            response = client.get(status["exports"][fmt]["download_url"])
            assert response.status_code == 200
            result.write_bytes(response.content)
            decoded = result if fmt == "wav" else tmp_path / f"decoded-{fmt}.wav"
            if fmt != "wav":
                subprocess.run(
                    [
                        ffmpeg,
                        "-v",
                        "error",
                        "-y",
                        "-i",
                        str(result),
                        "-map",
                        "0:a:0",
                        "-ar",
                        "48000",
                        "-ac",
                        "2",
                        "-c:a",
                        "pcm_s16le",
                        str(decoded),
                    ],
                    check=True,
                    capture_output=True,
                )
            assert_delivery_pcm(pcm_values(decoded), expected, lossless=fmt == "wav")
            if fmt in ("mp4", "mov"):
                streams = probe(ffprobe, result)["streams"]
                assert (
                    int(next(s for s in streams if s["codec_type"] == "video")["nb_read_frames"])
                    == total_frames
                )
                assert pixel(ffmpeg, result, 4)[0] > 200
                assert pixel(ffmpeg, result, 12)[2] > 200


@pytest.mark.parametrize("speed", [0.75, 0.5])
def test_frozen_slow_recipes_keep_split_windows_in_all_formats(project, tmp_path, speed):
    test_each_audio_edit_in_every_delivery_format(
        project, tmp_path, 25, 30, "detached", "split", recipe_speed=speed
    )
