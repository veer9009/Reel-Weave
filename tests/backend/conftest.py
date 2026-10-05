from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def settings(tmp_path: Path):
    from backend.app.config import Settings

    return Settings(
        working_root=tmp_path / "work",
        max_file_size_bytes=100,
        max_audio_file_size_bytes=100,
        max_overlay_image_file_size_bytes=100,
        max_overlay_video_file_size_bytes=100,
        max_clips=10,
        queue_size=2,
        retention_seconds=60,
        cleanup_interval_seconds=3600,
        allowed_origins=("http://localhost:5173",),
        ffmpeg_path="ffmpeg-test",
        ffprobe_path="ffprobe-test",
        subprocess_timeout_seconds=10,
    )


@pytest.fixture
def client_factory(settings):
    clients: list[TestClient] = []
    default_executor = object()

    def no_op_executor(_job) -> None:
        pass

    def make(executor: Callable | None | object = default_executor) -> TestClient:
        from backend.app.main import create_app

        if executor is default_executor:
            executor = no_op_executor
        client = TestClient(create_app(settings=settings, merge_executor=executor))
        client.__enter__()
        clients.append(client)
        return client

    yield make

    for client in reversed(clients):
        client.__exit__(None, None, None)


def wait_for_status(client: TestClient, job_id: str, expected: str, timeout: float = 2) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        if response.status_code == 200 and response.json()["status"] == expected:
            return response.json()
        time.sleep(0.01)
    pytest.fail(f"job {job_id} did not reach {expected}")
