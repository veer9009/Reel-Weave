from __future__ import annotations

import json
import threading
from pathlib import Path

from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile

from tests.backend.conftest import wait_for_status


def clips(count: int, size: int = 4, extension: str = ".mp4"):
    return [
        ("files", (f"user-secret-{index}{extension}", b"x" * size, "video/mp4"))
        for index in range(count)
    ]


def manifest(count: int, **audio_overrides) -> str:
    audio = {
        "original_volume": 1,
        "original_muted": False,
        "music_volume": 0.3,
        "music_muted": False,
        **audio_overrides,
    }
    return json.dumps(
        {
            "clips": [
                {"client_id": f"clip-{index}", "start_frame": 0, "end_frame": 0, "speed": 1}
                for index in range(count)
            ],
            "audio": audio,
        }
    )


def test_health_exposes_tool_availability_and_client_limits(client_factory):
    response = client_factory().get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "ffmpeg_available": False,
        "ffprobe_available": False,
        "limits": {
            "max_file_size_mb": 100 / (1024 * 1024),
            "max_clips": 10,
            "max_audio_file_size_mb": 100 / (1024 * 1024),
        },
    }


def test_merge_rejects_too_few_or_too_many_files(client_factory):
    client = client_factory()

    for count in (1, 11):
        response = client.post("/api/merge", files=clips(count), data={"manifest": manifest(count)})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_file_count"


def test_merge_requires_valid_manifest_and_matching_clip_count(client_factory):
    client = client_factory()
    missing = client.post("/api/merge", files=clips(2))
    malformed = client.post("/api/merge", files=clips(2), data={"manifest": "{"})
    mismatch = client.post("/api/merge", files=clips(2), data={"manifest": manifest(1)})

    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "invalid_manifest"
    assert malformed.json()["error"]["code"] == "invalid_manifest"
    assert mismatch.json()["error"]["code"] == "invalid_manifest"


def test_merge_preserves_manual_trim_signal(client_factory):
    captured = []

    def merge(job):
        captured.append(job)
        job.result_path.write_bytes(b"done")

    value = json.loads(manifest(2))
    value["clips"][0]["trim_saved"] = True
    client = client_factory(merge)
    response = client.post("/api/merge", files=clips(2), data={"manifest": json.dumps(value)})

    assert response.status_code == 202
    wait_for_status(client, response.json()["job_id"], "completed")
    assert captured[0].clip_edits[0].trim_saved is True


def test_merge_rejects_non_boolean_manual_trim_signal(client_factory):
    value = json.loads(manifest(2))
    value["clips"][0]["trim_saved"] = "yes"

    response = client_factory().post(
        "/api/merge", files=clips(2), data={"manifest": json.dumps(value)}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_manifest"


def test_merge_rejects_invalid_trim_speed_and_audio_settings(client_factory):
    client = client_factory()
    invalid_trim = json.loads(manifest(2))
    invalid_trim["clips"][0].update(start_frame=3, end_frame=2)
    invalid_speed = json.loads(manifest(2))
    invalid_speed["clips"][0]["speed"] = 2
    invalid_volume = json.loads(manifest(2))
    invalid_volume["audio"]["music_volume"] = 1.1
    invalid_client_id = json.loads(manifest(2))
    invalid_client_id["clips"][0]["client_id"] = 42

    responses = [
        client.post("/api/merge", files=clips(2), data={"manifest": json.dumps(value)})
        for value in (invalid_trim, invalid_speed, invalid_volume, invalid_client_id)
    ]
    assert [response.json()["error"]["code"] for response in responses] == [
        "invalid_trim_range",
        "invalid_speed",
        "invalid_manifest",
        "invalid_manifest",
    ]


def test_merge_accepts_one_supported_background_audio_and_stores_generated_path(
    client_factory,
):
    captured = []

    def merge(job):
        captured.append(job)
        job.result_path.write_bytes(b"done")

    client = client_factory(merge)
    response = client.post(
        "/api/merge",
        files=[*clips(2), ("background_audio", ("my secret song.mp3", b"music", "audio/mpeg"))],
        data={"manifest": manifest(2)},
    )
    assert response.status_code == 202
    wait_for_status(client, response.json()["job_id"], "completed")
    assert captured[0].background_audio_path.name == "background.mp3"
    assert "secret" not in str(captured[0].background_audio_path)


def test_merge_rejects_unsupported_or_oversized_background_audio(client_factory):
    client = client_factory()
    unsupported = client.post(
        "/api/merge",
        files=[*clips(2), ("background_audio", ("song.txt", b"music", "text/plain"))],
        data={"manifest": manifest(2)},
    )
    oversized = client.post(
        "/api/merge",
        files=[*clips(2), ("background_audio", ("song.mp3", b"x" * 101, "audio/mpeg"))],
        data={"manifest": manifest(2)},
    )
    assert unsupported.status_code == 415
    assert unsupported.json()["error"]["code"] == "unsupported_audio_type"
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "audio_too_large"


def test_merge_rejects_multiple_background_audio_parts(client_factory):
    response = client_factory().post(
        "/api/merge",
        files=[
            *clips(2),
            ("background_audio", ("one.mp3", b"one", "audio/mpeg")),
            ("background_audio", ("two.wav", b"two", "audio/wav")),
        ],
        data={"manifest": manifest(2)},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_audio_count"


def test_merge_rejects_unsupported_extension(client_factory):
    response = client_factory().post(
        "/api/merge", files=clips(2, extension=".avi"), data={"manifest": manifest(2)}
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_media_type"


def test_merge_rejects_empty_file_and_removes_job(client_factory, settings):
    response = client_factory().post(
        "/api/merge", files=clips(2, size=0), data={"manifest": manifest(2)}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "empty_file"
    assert list(settings.upload_root.iterdir()) == []


def test_merge_requires_media_tools_for_builtin_pipeline(settings):
    from backend.app.main import create_app

    with TestClient(create_app(settings=settings)) as client:
        response = client.post("/api/merge", files=clips(2), data={"manifest": manifest(2)})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "media_tools_unavailable"


def test_invalid_upload_closes_all_multipart_files(client_factory, monkeypatch):
    closed: list[str] = []
    original_close = UploadFile.close

    async def record_close(upload):
        closed.append(upload.filename or "")
        await original_close(upload)

    monkeypatch.setattr(UploadFile, "close", record_close)

    response = client_factory().post(
        "/api/merge", files=clips(2, extension=".avi"), data={"manifest": manifest(2)}
    )

    assert response.status_code == 415
    assert closed == ["user-secret-0.avi", "user-secret-1.avi"]


def test_merge_rejects_oversize_file_and_removes_partial_job(client_factory, settings):
    client = client_factory()
    response = client.post("/api/merge", files=clips(2, size=101), data={"manifest": manifest(2)})

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"
    assert list(settings.upload_root.iterdir()) == []


def test_request_body_limit_rejects_before_multipart_parsing(client_factory, settings):
    response = client_factory().post(
        "/api/merge",
        content=b"ignored",
        headers={
            "content-type": "multipart/form-data; boundary=x",
            "content-length": str(settings.max_request_size_bytes + 1),
        },
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


def test_copy_failure_is_structured_and_cleans_registry_and_storage(
    client_factory, settings, monkeypatch
):
    client = client_factory()
    original_open = Path.open

    def fail_generated_upload(path, mode="r", *args, **kwargs):
        if mode == "xb" and path.parent.parent == settings.upload_root:
            raise OSError("C:/private/disk details")
        return original_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", fail_generated_upload)

    response = client.post("/api/merge", files=clips(2), data={"manifest": manifest(2)})

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "upload_failed", "message": "The clips could not be stored."}
    }
    assert client.app.state.registry.known_ids() == set()
    assert list(settings.upload_root.iterdir()) == []


def test_framework_errors_use_structured_error_contract(client_factory):
    response = client_factory().get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message": "The requested endpoint was not found."}
    }


def test_openapi_describes_repeated_multipart_files(client_factory):
    schema = client_factory().get("/openapi.json").json()

    request_body = schema["paths"]["/api/merge"]["post"]["requestBody"]
    files_schema = request_body["content"]["multipart/form-data"]["schema"]["properties"]["files"]
    assert files_schema == {
        "type": "array",
        "minItems": 2,
        "maxItems": 10,
        "items": {"type": "string", "format": "binary"},
    }


def test_job_lookup_distinguishes_malformed_and_unknown_ids(client_factory):
    client = client_factory()

    malformed = client.get("/api/jobs/not-a-uuid")
    unknown = client.get("/api/jobs/11111111-1111-4111-8111-111111111111")

    assert malformed.status_code == 400
    assert malformed.json()["error"]["code"] == "invalid_job_id"
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "job_not_found"


def test_worker_completes_job_and_serves_video_and_download(client_factory):
    def merge(job):
        job.result_path.parent.mkdir(parents=True, exist_ok=True)
        job.result_path.write_bytes(b"finished-video")

    client = client_factory(merge)
    created = client.post("/api/merge", files=clips(2), data={"manifest": manifest(2)})

    assert created.status_code == 202
    job_id = created.json()["job_id"]
    assert set(created.json()) == {"job_id", "status", "error"}
    assert wait_for_status(client, job_id, "completed")["error"] is None
    assert client.get(f"/api/jobs/{job_id}/video").content == b"finished-video"
    download = client.get(f"/api/jobs/{job_id}/download")
    assert download.content == b"finished-video"
    assert "attachment" in download.headers["content-disposition"]


def test_worker_records_safe_failure_message(client_factory):
    def fail(_job):
        raise RuntimeError(r"C:\private\secret.mp4 exploded")

    client = client_factory(fail)
    created = client.post("/api/merge", files=clips(2), data={"manifest": manifest(2)})

    failed = wait_for_status(client, created.json()["job_id"], "failed")
    assert failed["error"] == "Video processing failed. Check that each clip is readable."
    assert "private" not in failed["error"]


def test_delete_rejects_active_job_then_removes_terminal_job(client_factory, settings):
    started = threading.Event()
    release = threading.Event()

    def merge(job):
        started.set()
        release.wait(timeout=2)
        job.result_path.parent.mkdir(parents=True, exist_ok=True)
        job.result_path.write_bytes(b"done")

    client = client_factory(merge)
    created = client.post("/api/merge", files=clips(2), data={"manifest": manifest(2)})
    job_id = created.json()["job_id"]
    assert started.wait(timeout=1)

    active = client.delete(f"/api/jobs/{job_id}")
    assert active.status_code == 409
    assert active.json()["error"]["code"] == "job_active"

    release.set()
    wait_for_status(client, job_id, "completed")
    assert client.delete(f"/api/jobs/{job_id}").status_code == 204
    assert client.get(f"/api/jobs/{job_id}").status_code == 404
    assert not (settings.upload_root / job_id).exists()
