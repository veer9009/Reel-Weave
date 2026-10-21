from tests.backend.conftest import wait_for_status
from tests.backend.test_v3_api import post
from tests.backend.test_v4_manifest import v4_manifest


def test_v4_catalog_uploads_bind_per_piece_sources(client_factory):
    captured = []
    client = client_factory(lambda job: captured.append(job))
    response = post(
        client,
        v4_manifest(),
        [
            ("audio_files", ("song-a.wav", b"audio-a", "audio/wav")),
            ("audio_files", ("song-b.wav", b"audio-b", "audio/wav")),
        ],
    )
    assert response.status_code == 202, response.text
    wait_for_status(client, response.json()["job_id"], "completed")
    job = captured[0]
    assert job.v3_plan.schema_version == 4
    assert {k: v.read_bytes() for k, v in job.audio_source_paths.items()} == {
        "song-a": b"audio-a",
        "song-b": b"audio-b",
    }
    assert set(response.json()["exports"]) == {"mp4", "mov", "wav", "mp3"}


def test_v4_missing_upload_is_atomic(client_factory):
    client = client_factory()
    response = post(client, v4_manifest(), [])
    assert response.status_code == 422
    assert client.app.state.registry.known_ids() == set()
    assert client.app.state.job_manager.queue.empty()
    for root in (
        client.app.state.settings.upload_root,
        client.app.state.settings.output_root,
        client.app.state.settings.intermediate_root,
    ):
        assert list(root.iterdir()) == []
