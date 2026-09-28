"""Opt-in, real FFmpeg API integration; no subprocess mocks."""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_FFMPEG_TESTS") != "1", reason="Set RUN_FFMPEG_TESTS=1 for real FFmpeg tests"
)


def run_media(args: list[str]) -> bytes:
    result = subprocess.run(args, capture_output=True, timeout=90, check=False)
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-2000:]
    return result.stdout


@pytest.fixture
def media_tools() -> tuple[str, str]:
    ffmpeg = shutil.which(os.getenv("REELWEAVE_FFMPEG_PATH", "ffmpeg"))
    ffprobe = shutil.which(os.getenv("REELWEAVE_FFPROBE_PATH", "ffprobe"))
    assert ffmpeg and ffprobe, "Install FFmpeg and FFprobe before enabling this test"
    run_media([ffmpeg, "-version"])
    run_media([ffprobe, "-version"])
    return ffmpeg, ffprobe


def wait_for_job(client: TestClient, job_id: str) -> dict:
    deadline = time.monotonic() + 120
    observed = set()
    while time.monotonic() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200
        body = response.json()
        observed.add(body["status"])
        if body["status"] in {"completed", "failed"}:
            return body
        time.sleep(0.05)
    pytest.fail(f"Job did not finish; observed states: {observed}")


def test_real_mixed_merge_playback_download_and_delete(tmp_path: Path, media_tools):
    ffmpeg, ffprobe = media_tools
    source_dir = tmp_path / "fixtures"
    source_dir.mkdir()
    fixtures = [
        ("first.mov", "red", "320x180", "24", "mpeg4", True),
        ("second.webm", "lime", "180x320", "15", "libvpx-vp9", False),
        ("third.mkv", "blue", "256x144", "25", "ffv1", False),
        ("fourth.mp4", "yellow", "320x240", "30", "libx264", True),
    ]
    sources = []
    for name, color, size, fps, codec, audio in fixtures:
        path = source_dir / name
        args = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s={size}:r={fps}",
        ]
        if audio:
            args += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"]
        args += ["-t", "0.7", "-c:v", codec]
        if audio:
            args += ["-c:a", "aac"]
        args += [str(path)]
        run_media(args)
        sources.append(path)

    settings = Settings(working_root=tmp_path / "work", ffmpeg_path=ffmpeg, ffprobe_path=ffprobe)
    with TestClient(create_app(settings)) as client:
        health = client.get("/api/health").json()
        assert health["ffmpeg_available"] and health["ffprobe_available"]
        response = client.post(
            "/api/merge",
            files=[
                ("files", (path.name, path.read_bytes(), "application/octet-stream"))
                for path in sources
            ],
            data={
                "manifest": json.dumps(
                    {
                        "clips": [
                            {
                                "client_id": f"fixture-{index}",
                                "start_frame": 0,
                                "end_frame": end,
                                "speed": 1,
                            }
                            for index, end in enumerate((16, 9, 17, 20))
                        ],
                        "order": [f"fixture-{index}" for index in range(4)],
                        "output_fps": 25,
                        "audio": {
                            "original_volume": 1,
                            "original_muted": False,
                            "music_volume": 0.3,
                            "music_muted": False,
                        },
                    }
                )
            },
        )
        assert response.status_code == 202, response.text
        job_id = response.json()["job_id"]
        terminal = wait_for_job(client, job_id)
        assert terminal["status"] == "completed", terminal

        download = client.get(f"/api/jobs/{job_id}/download")
        assert download.status_code == 200
        assert download.headers["content-type"] == "video/mp4"
        assert "attachment" in download.headers["content-disposition"]
        assert ".mp4" in download.headers["content-disposition"]
        output = tmp_path / "downloaded.mp4"
        output.write_bytes(download.content)
        probe = json.loads(
            run_media(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-show_streams",
                    "-show_format",
                    "-of",
                    "json",
                    str(output),
                ]
            )
        )
        video = next(s for s in probe["streams"] if s["codec_type"] == "video")
        audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
        assert (video["codec_name"], video["width"], video["height"]) == ("h264", 1280, 720)
        assert video["r_frame_rate"] == "25/1"
        assert video["pix_fmt"] == "yuv420p"
        assert (audio["codec_name"], audio["sample_rate"], audio["channels"]) == ("aac", "48000", 2)
        assert 2.7 <= float(probe["format"]["duration"]) <= 3.2

        colors = []
        for timestamp in (0.2, 0.95, 1.65, 2.4):
            pixel = run_media(
                [
                    ffmpeg,
                    "-v",
                    "error",
                    "-nostdin",
                    "-ss",
                    str(timestamp),
                    "-i",
                    str(output),
                    "-vf",
                    "crop=32:32:(iw-32)/2:(ih-32)/2,scale=1:1",
                    "-frames:v",
                    "1",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "rgb24",
                    "pipe:1",
                ]
            )
            assert len(pixel) == 3
            colors.append(tuple(pixel))
        red, green, blue, yellow = colors
        assert red[0] > 180 and red[1] < 50 and red[2] < 50
        assert green[1] > 180 and green[0] < 50 and green[2] < 50
        assert blue[2] > 180 and blue[0] < 50 and blue[1] < 50
        assert yellow[0] > 180 and yellow[1] > 180 and yellow[2] < 50

        # A portrait clip must be padded, not stretched to fill the landscape frame.
        edge = run_media(
            [
                ffmpeg,
                "-v",
                "error",
                "-nostdin",
                "-ss",
                "0.95",
                "-i",
                str(output),
                "-vf",
                "crop=32:32:0:344,scale=1:1",
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ]
        )
        assert len(edge) == 3 and max(edge) < 20

        # Keep the first clip's real audio and supply silence during the second.
        peaks = []
        for timestamp in (0.2, 0.95):
            pcm = run_media(
                [
                    ffmpeg,
                    "-v",
                    "error",
                    "-nostdin",
                    "-ss",
                    str(timestamp),
                    "-i",
                    str(output),
                    "-t",
                    "0.1",
                    "-map",
                    "0:a:0",
                    "-ac",
                    "1",
                    "-ar",
                    "48000",
                    "-f",
                    "s16le",
                    "pipe:1",
                ]
            )
            assert pcm
            samples = struct.unpack(f"<{len(pcm) // 2}h", pcm)
            peaks.append(max(abs(sample) for sample in samples))
        assert peaks[0] > 100
        assert peaks[1] < 50

        ranged = client.get(f"/api/jobs/{job_id}/video", headers={"Range": "bytes=0-99"})
        assert ranged.status_code == 206
        assert ranged.content == download.content[:100]
        assert client.delete(f"/api/jobs/{job_id}").status_code == 204
        assert client.get(f"/api/jobs/{job_id}").status_code == 404
        assert client.get(f"/api/jobs/{job_id}/download").status_code == 404
        assert not any(settings.working_root.rglob(f"*{job_id}*"))


def test_real_corrupted_video_is_rejected_before_queueing(tmp_path: Path, media_tools):
    ffmpeg, ffprobe = media_tools
    settings = Settings(working_root=tmp_path / "work", ffmpeg_path=ffmpeg, ffprobe_path=ffprobe)
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/merge",
            files=[
                ("files", ("broken.mp4", b"this is not a video", "video/mp4")),
                ("files", ("also-broken.mov", b"invalid", "video/quicktime")),
            ],
            data={
                "manifest": json.dumps(
                    {
                        "clips": [
                            {"client_id": "broken-1", "start_frame": 0, "end_frame": 0, "speed": 1},
                            {"client_id": "broken-2", "start_frame": 0, "end_frame": 0, "speed": 1},
                        ],
                        "order": ["broken-1", "broken-2"],
                        "output_fps": 30,
                        "audio": {
                            "original_volume": 1,
                            "original_muted": False,
                            "music_volume": 0.3,
                            "music_muted": False,
                        },
                    }
                )
            },
        )
        assert response.status_code == 422, response.text
        assert response.json() == {
            "error": {
                "code": "invalid_media",
                "message": "Clip 1 metadata is unreadable.",
            }
        }
        assert all(not any(root.iterdir()) for root in settings.working_root.iterdir())


@pytest.mark.parametrize(
    ("speed", "music_duration"),
    [(0.5, 0.2), (0.75, 2.0)],
    ids=["slow-looped-music", "three-quarter-trimmed-music"],
)
def test_real_frame_trim_speed_and_music_length(
    tmp_path: Path, media_tools, speed: float, music_duration: float
):
    ffmpeg, ffprobe = media_tools
    sources = []
    for index, color in enumerate(("red", "blue")):
        path = tmp_path / f"source-{index}.mp4"
        run_media(
            [
                ffmpeg,
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c={color}:s=160x90:r=30:d=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=1",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-shortest",
                str(path),
            ]
        )
        sources.append(path)
    music = tmp_path / "music.wav"
    run_media(
        [
            ffmpeg,
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=880:sample_rate=48000:duration={music_duration:g}",
            str(music),
        ]
    )
    settings = Settings(working_root=tmp_path / "work", ffmpeg_path=ffmpeg, ffprobe_path=ffprobe)
    manifest = {
        "clips": [
            {"client_id": "red", "start_frame": 0, "end_frame": 0, "speed": 1},
            {"client_id": "blue", "start_frame": 10, "end_frame": 19, "speed": speed},
        ],
        "order": ["red", "blue"],
        "output_fps": 30,
        "audio": {
            "original_volume": 0.8,
            "original_muted": False,
            "music_volume": 0.3,
            "music_muted": False,
        },
    }
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/merge",
            files=[
                *[("files", (path.name, path.read_bytes(), "video/mp4")) for path in sources],
                ("background_audio", (music.name, music.read_bytes(), "audio/wav")),
            ],
            data={"manifest": json.dumps(manifest)},
        )
        assert response.status_code == 202, response.text
        terminal = wait_for_job(client, response.json()["job_id"])
        assert terminal["status"] == "completed", terminal
        output = tmp_path / "trimmed.mp4"
        output.write_bytes(client.get(f"/api/jobs/{response.json()['job_id']}/download").content)
        probe = json.loads(
            run_media(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-show_streams",
                    "-show_format",
                    "-of",
                    "json",
                    str(output),
                ]
            )
        )
        expected_duration = 1 / 30 + (10 / 30) / speed
        assert abs(float(probe["format"]["duration"]) - expected_duration) <= 0.08
        assert any(stream["codec_type"] == "audio" for stream in probe["streams"])
