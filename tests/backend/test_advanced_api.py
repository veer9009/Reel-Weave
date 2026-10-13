import json

from tests.backend.advanced_fixtures import advanced_manifest
from tests.backend.conftest import wait_for_status


def test_advanced_upload_catalog_is_dedup_bound(client_factory):
    captured = []

    def merge(job):
        captured.append(job)
        job.result_path.write_bytes(b"result")

    client = client_factory(merge)
    m = advanced_manifest()
    m["clips"].append({**m["clips"][0], "client_id": "split"})
    m["order"].append("split")
    response = client.post(
        "/api/merge",
        data={"manifest": json.dumps(m)},
        files=[
            ("files", ("base.mp4", b"b", "video/mp4")),
            ("files", ("take.mp4", b"t", "video/mp4")),
        ],
    )
    assert response.status_code == 202, response.text
    wait_for_status(client, response.json()["job_id"], "completed")
    assert set(captured[0].video_source_paths) == {"base", "take"}
    assert len(captured[0].advanced_plan.clips) == 2


def test_missing_music_file_rejects_before_queueing(client_factory):
    client = client_factory()
    m = advanced_manifest()
    m["music"] = {
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
    response = client.post(
        "/api/merge",
        data={"manifest": json.dumps(m)},
        files=[
            ("files", ("base.mp4", b"b", "video/mp4")),
            ("files", ("take.mp4", b"t", "video/mp4")),
        ],
    )
    assert response.status_code == 422


def test_failed_advanced_execution_never_publishes_partial_mp4(client_factory):
    def fail(job):
        (job.intermediate_dir / "final-advanced.mp4").write_bytes(b"partial encode")
        raise RuntimeError("encoder failed")

    client = client_factory(fail)
    response = client.post(
        "/api/merge",
        data={"manifest": json.dumps(advanced_manifest())},
        files=[
            ("files", ("base.mp4", b"b", "video/mp4")),
            ("files", ("take.mp4", b"t", "video/mp4")),
        ],
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    wait_for_status(client, job_id, "failed")
    assert client.get(f"/api/jobs/{job_id}/download").status_code == 409
    assert not client.app.state.registry.get(job_id).result_path.exists()
