import json

import pytest

from backend.app.errors import ApiError
from backend.app.main import _parse_manifest
from tests.backend.advanced_fixtures import advanced_manifest


def test_advanced_catalog_and_occurrence_namespaces():
    plan = _parse_manifest(json.dumps(advanced_manifest()), 2, 10)
    assert plan.video_sources[1].source_id == "take"
    assert plan.video2[0].content_out_frame == 60
    assert plan.order == ("main",)


@pytest.mark.parametrize(
    "change",
    [
        "version",
        "unknown",
        "flag",
        "bool",
        "duplicate",
        "missing",
        "order",
        "nan",
        "speed",
        "extra",
    ],
)
def test_reject_invalid_version2_contract(change):
    m = advanced_manifest()
    if change == "version":
        m["schema_version"] = 3
    if change == "unknown":
        m["timeline_typo"] = 0
    if change == "flag":
        del m["video2"][0]["content_full_source"]
    if change == "bool":
        m["video2"][0]["timeline_start_frame"] = True
    if change == "duplicate":
        m["video2"][0]["client_id"] = "main"
    if change == "missing":
        m["video2"][0]["source_id"] = "missing"
    if change == "order":
        m["order"] = ["replacement"]
    if change == "nan":
        m["audio"]["music_volume"] = float("nan")
    if change == "speed":
        m["video2"][0]["speed"] = 2
    if change == "extra":
        m["video_sources"].append({"source_id": "unused"})
    with pytest.raises(ApiError):
        _parse_manifest(json.dumps(m), 2, 10)


def test_explicit_legacy_schema_is_supported():
    m = advanced_manifest()
    m = {k: v for k, v in m.items() if k not in {"video_sources", "video2", "music"}}
    m["schema_version"] = 1
    del m["clips"][0]["source_id"]
    assert _parse_manifest(json.dumps(m), 1, 10).order == ("main",)
