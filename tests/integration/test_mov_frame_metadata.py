"""Audio-tail metadata must not turn source trims into container-time frames."""

import copy
import json
import os

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from tests.integration.advanced_fixtures import energy, probe, run_media, samples
from tests.integration.test_timeline_audio_exports import packet_hashes, wait
from tests.integration.test_timeline_audio_exports import project as project

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_FFMPEG_TESTS") != "1", reason="Real FFmpeg tests are opt-in."
)


@pytest.mark.parametrize("mode", ["linked", "detached", "split"])
@pytest.mark.parametrize(
    "source_fps,frames,output_fps,speed,output_frames",
    [(30, 30, 25, 1, 25), (24, 24, 30, 0.5, 60), (30000 / 1001, 30, 24, 0.75, 32)],
)
def test_audio_tail_metadata_to_moving_mp4_and_mov(
    project, tmp_path, mode, source_fps, frames, output_fps, speed, output_frames
):
    ffmpeg, ffprobe, settings, _, job, manifest = project
    path = job.video_source_paths["base"]
    duration = frames / source_fps
    run_media(
        [
            ffmpeg,
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc2=s=160x90:r={source_fps}:d={duration}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:sample_rate=48000:d={duration + 0.2}",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(path),
        ]
    )
    source = probe(ffprobe, path)
    assert (
        int(next(s for s in source["streams"] if s["codec_type"] == "video")["nb_read_frames"])
        == frames
    )
    estimated_frames = round(float(source["format"]["duration"]) * source_fps)
    assert estimated_frames > frames
    manifest.update(
        video_sources=[{"source_id": "base"}],
        video2=[],
        output_fps=output_fps,
        exports=["mp4", "mov"],
    )
    clip = manifest["clips"][0]
    clip.update(
        end_frame=frames - 1,
        trim_saved=False,
        speed=speed,
        duration_frames=output_frames,
        output_out_frame=output_frames,
    )

    def submit(client, value):
        return client.post(
            "/api/merge",
            data={"manifest": json.dumps(value)},
            files={"files": ("tail.mp4", path.read_bytes(), "video/mp4")},
        )

    with TestClient(create_app(settings)) as client:
        # The old browser estimate fails before MOV encoding, even with linked audio.
        bad = copy.deepcopy(manifest)
        bad["clips"][0]["end_frame"] = estimated_frames - 1
        response = submit(client, bad)
        assert response.status_code == 422
        assert "Frozen audio source trim is unavailable" in response.text

        if mode == "linked" and source_fps == 30:
            # Same unsaved browser trim succeeds via the existing MP4-only V2
            # path, which resolves full-source video edits before rendering.
            legacy = copy.deepcopy(bad)
            legacy["schema_version"] = 2
            for key in ("exports", "audio_sources", "independent_audio"):
                legacy.pop(key)
            legacy["clips"] = [
                {
                    key: value
                    for key, value in legacy["clips"][0].items()
                    if key
                    in {"client_id", "source_id", "start_frame", "end_frame", "speed", "trim_saved"}
                }
            ]
            response = submit(client, legacy)
            assert response.status_code == 202, response.text
            legacy_status = wait(client, response.json()["job_id"])
            assert legacy_status["status"] == "completed"

        metadata = client.post(
            "/api/video-metadata", files={"files": ("tail.mp4", path.read_bytes(), "video/mp4")}
        )
        assert metadata.status_code == 200, metadata.text
        assert metadata.json()["totalFrames"] == frames
        assert metadata.json()["fps"] == pytest.approx(source_fps, rel=1e-6)
        clip["end_frame"] = metadata.json()["totalFrames"] - 1
        if mode != "linked":
            clip["original_audio"] = "detached"
            recipe = dict(
                kind="video-edit",
                source_id="base",
                source_start_frame=0,
                source_end_frame=frames - 1,
                speed=speed,
                normalization_fps=output_fps,
            )
            cut = output_frames // 2 if mode == "split" else output_frames
            manifest["independent_audio"] = [
                dict(
                    id="left",
                    timeline_start_frame=0,
                    duration_frames=cut,
                    source_start_sample=0,
                    source=recipe,
                )
            ]
            if mode == "split":
                manifest["independent_audio"].append(
                    dict(
                        id="right",
                        timeline_start_frame=cut,
                        duration_frames=output_frames - cut,
                        source_start_sample=cut * (48000 // output_fps),
                        source=recipe,
                    )
                )
        response = submit(client, manifest)
        assert response.status_code == 202, response.text
        status = wait(client, response.json()["job_id"])
        for fmt in ("mp4", "mov"):
            assert status["exports"][fmt]["status"] == "ready", status
            result = tmp_path / f"moving.{fmt}"
            result.write_bytes(client.get(status["exports"][fmt]["download_url"]).content)
            streams = probe(ffprobe, result)["streams"]
            video = next(s for s in streams if s["codec_type"] == "video")
            assert int(video["nb_read_frames"]) == output_frames
            assert float(video["duration"]) == pytest.approx(output_frames / output_fps, abs=1e-5)
            # Decode every frame: a frozen still cannot satisfy distinct frame hashes.
            hashes = run_media(
                [ffmpeg, "-v", "error", "-i", str(result), "-map", "0:v:0", "-f", "framemd5", "-"]
            )
            assert (
                len(
                    {
                        line.split(b",")[-1]
                        for line in hashes.splitlines()
                        if line and not line.startswith(b"#")
                    }
                )
                > output_frames // 2
            )
            for start in (0.1, output_frames / output_fps - 0.2):
                sound = samples(ffmpeg, result, start, 0.1)
                assert energy(sound, 440) > 1e-5
                assert energy(sound, 440) > 20 * energy(sound, 220)
        assert packet_hashes(ffprobe, tmp_path / "moving.mp4") == packet_hashes(
            ffprobe, tmp_path / "moving.mov"
        )
