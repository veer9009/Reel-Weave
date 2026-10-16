import json

import pytest

from tests.backend.advanced_fixtures import v3_manifest
from tests.backend.conftest import wait_for_status


def post(client, manifest, extras=()):
    return client.post(
        "/api/merge",
        data={"manifest": json.dumps(manifest)},
        files=[
            ("files", ("base.mp4", b"base", "video/mp4")),
            ("files", ("take.mp4", b"take", "video/mp4")),
            *extras,
        ],
    )


def test_v3_audio_upload_catalog_bound_and_status_additive(client_factory):
    captured = []

    def run(job):
        captured.append(job)

    client = client_factory(run)
    m = v3_manifest()
    m["audio_sources"] = [{"source_id": "voice"}]
    m["independent_audio"] = [
        {
            "id": "sound",
            "timeline_start_frame": 0,
            "duration_frames": 1,
            "source_start_sample": 0,
            "source": {"kind": "audio-file", "source_id": "voice"},
        }
    ]
    response = post(client, m, [("audio_files", ("voice.wav", b"sound", "audio/wav"))])
    assert response.status_code == 202, response.text
    assert response.json()["exports"]["mp4"]["status"] == "queued"
    wait_for_status(client, response.json()["job_id"], "completed")
    job = captured[0]
    assert job.v3_plan.schema_version == 3
    assert job.audio_source_paths["voice"].read_bytes() == b"sound"
    assert job.background_audio_path is None


@pytest.mark.parametrize(
    "extras",
    [
        [("background_audio", ("old.wav", b"sound", "audio/wav"))],
        [("audio_files", ("extra.wav", b"sound", "audio/wav"))],
        [("audio_files", (None, "not a file"))],
    ],
)
def test_v3_incompatible_uploads_reject_cleanly(client_factory, extras):
    client = client_factory()
    response = post(client, v3_manifest(), extras)
    assert response.status_code == 422, response.text
    assert client.app.state.registry.known_ids() == set()
    assert client.app.state.job_manager.queue.empty()
    for root in (
        client.app.state.settings.upload_root,
        client.app.state.settings.output_root,
        client.app.state.settings.intermediate_root,
    ):
        assert list(root.iterdir()) == []


def test_legacy_rejects_v3_audio_files(client_factory):
    from tests.backend.advanced_fixtures import advanced_manifest

    response = post(
        client_factory(), advanced_manifest(), [("audio_files", ("extra.wav", b"x", "audio/wav"))]
    )
    assert response.status_code == 422


def test_manifest_utf8_budget_even_when_parser_accepts_field(client_factory):
    client = client_factory()
    raw = json.dumps(v3_manifest())
    for length, status in [(65536, 202), (65537, 422)]:
        response = client.post(
            "/api/merge",
            data={"manifest": raw + " " * (length - len(raw))},
            files=[
                ("files", ("base.mp4", b"b", "video/mp4")),
                ("files", ("take.mp4", b"t", "video/mp4")),
            ],
        )
        assert response.status_code == status, response.text


def audio_manifest():
    m = v3_manifest()
    m["audio_sources"] = [{"source_id": "voice"}, {"source_id": "song"}]
    m["independent_audio"] = [
        {
            "id": "sound",
            "timeline_start_frame": 0,
            "duration_frames": 1,
            "source_start_sample": 0,
            "source": {"kind": "audio-file", "source_id": "voice"},
        }
    ]
    m["music"] = {
        "source_id": "song",
        "segments": [
            {
                "client_id": "music",
                "source_id": "song",
                "timeline_start_frame": 0,
                "source_start_sample": 0,
                "duration_frames": 1,
            }
        ],
    }
    return m


def test_v3_combined_external_audio_budget_cleans_partial_files(client_factory):
    client = client_factory()
    response = post(
        client,
        audio_manifest(),
        [
            ("audio_files", ("voice.wav", b"a" * 60, "audio/wav")),
            ("audio_files", ("song.wav", b"b" * 41, "audio/wav")),
        ],
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "audio_too_large"
    assert client.app.state.registry.known_ids() == set()
    assert client.app.state.job_manager.queue.empty()
    for root in client.app.state.storage.roots:
        assert list(root.iterdir()) == []


def test_v3_authoritative_window_rejection_before_queue(client_factory, monkeypatch):
    from backend.app import capabilities
    from backend.app.media import MediaPipeline

    monkeypatch.setattr("backend.app.main._tool_available", lambda _: True)
    monkeypatch.setattr(
        capabilities,
        "probe_export_capabilities",
        lambda _: dict.fromkeys(("mp4", "mov", "wav", "mp3"), True),
    )
    monkeypatch.setattr(
        MediaPipeline,
        "_probe",
        lambda self, path: {
            "streams": [
                {
                    "codec_type": "video",
                    "width": 320,
                    "height": 180,
                    "avg_frame_rate": "25/1",
                    "nb_read_frames": "149" if path.name.startswith("000") else "60",
                }
            ]
        },
    )
    client = client_factory(None)
    m = v3_manifest()
    # Detached picture requires no normalization work; authoritative frames must reject it first.
    for v in m["clips"] + m["video2"]:
        v["original_audio"] = "detached"
    response = post(client, m)
    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "invalid_range"
    assert error["segment_id"] == "main" and error["track"] == "video1"
    assert client.app.state.registry.known_ids() == set()
    assert client.app.state.job_manager.queue.empty()
    for root in client.app.state.storage.roots:
        assert list(root.iterdir()) == []


def test_v3_requires_decoded_frame_count_not_duration_guess(client_factory, monkeypatch):
    from backend.app import capabilities
    from backend.app.media import MediaPipeline

    monkeypatch.setattr("backend.app.main._tool_available", lambda _: True)
    monkeypatch.setattr(
        capabilities,
        "probe_export_capabilities",
        lambda _: dict.fromkeys(("mp4", "mov", "wav", "mp3"), True),
    )
    monkeypatch.setattr(
        MediaPipeline,
        "_probe",
        lambda self, path: {
            "streams": [
                {
                    "codec_type": "video",
                    "width": 320,
                    "height": 180,
                    "avg_frame_rate": "25/1",
                    "duration": "6" if path.name.startswith("000") else "2.4",
                }
            ]
        },
    )
    client = client_factory(None)
    m = v3_manifest()
    for v in m["clips"] + m["video2"]:
        v["original_audio"] = "detached"
    response = post(client, m)
    assert response.status_code == 422, response.text
    assert client.app.state.registry.known_ids() == set()
