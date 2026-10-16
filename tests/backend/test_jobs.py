import json
import time
from threading import Event

from backend.app.jobs import ExportState
from tests.backend.advanced_fixtures import v3_manifest
from tests.backend.conftest import wait_for_status


def request(client, formats):
    m = v3_manifest()
    m["exports"] = formats
    response = client.post(
        "/api/merge",
        data={"manifest": json.dumps(m)},
        files=[("files", ("a.mp4", b"a", "video/mp4")), ("files", ("b.mp4", b"b", "video/mp4"))],
    )
    assert response.status_code == 202, response.text
    return response.json()["job_id"]


def test_primary_ready_while_extra_processing_excludes_cleanup(client_factory):
    ready, release = Event(), Event()

    def render(job):
        job.result_path.write_bytes(b"encoded mp4")
        job.exports["mp4"] = ExportState("ready", path=job.result_path)
        job.exports["mp3"] = ExportState("processing")
        ready.set()
        assert release.wait(10)
        job.exports["mp3"] = ExportState("failed", "MP3 export failed.")

    client = client_factory(render)
    try:
        job_id = request(client, ["mp4", "mp3"])
        assert ready.wait(5)
        status = client.get(f"/api/jobs/{job_id}").json()
        assert status["status"] == "processing"
        assert status["exports"]["mp4"]["download_url"].endswith("/exports/mp4")
        assert "download_url" not in status["exports"]["mp3"]
        assert client.get(f"/api/jobs/{job_id}/exports/mp4").status_code == 200
        assert client.get(f"/api/jobs/{job_id}/video").status_code == 200
        assert client.get(f"/api/jobs/{job_id}/exports/mp3").status_code == 409
        assert client.delete(f"/api/jobs/{job_id}").status_code == 409
        registry = client.app.state.registry
        registry.cleanup_expired(client.app.state.storage, 1, time.time() + 1000)
        assert registry.get(job_id) is not None
    finally:
        release.set()
    status = wait_for_status(client, job_id, "completed")
    assert status["exports"]["mp3"]["status"] == "failed"
    response = client.get(f"/api/jobs/{job_id}/exports/mp3")
    assert response.json()["error"]["code"] == "export_failed"
    assert client.get(f"/api/jobs/{job_id}/exports/wav").status_code == 404
    assert client.get(f"/api/jobs/{job_id}/exports/flac").status_code == 422
    registry.cleanup_expired(client.app.state.storage, 1, time.time() + 1000)
    assert client.get(f"/api/jobs/{job_id}/exports/mp4").status_code == 404


def test_primary_failure_exposes_no_formats(client_factory):
    def fail(job):
        job.result_path.write_bytes(b"partial")
        raise RuntimeError("sensitive path must stay private")

    client = client_factory(fail)
    job_id = request(client, ["mp4", "wav"])
    status = wait_for_status(client, job_id, "failed")
    assert all(s["status"] == "failed" for s in status["exports"].values())
    assert "sensitive" not in str(status)
    assert not client.app.state.registry.get(job_id).result_path.exists()
    assert client.get(f"/api/jobs/{job_id}/exports/mp4").status_code == 409
