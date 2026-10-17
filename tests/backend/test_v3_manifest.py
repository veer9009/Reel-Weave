import copy
import json

import pytest

from backend.app.errors import ApiError
from backend.app.main import _parse_manifest
from tests.backend.advanced_fixtures import v3_manifest


def parse(m):
    return _parse_manifest(json.dumps(m), 2, 10)


def test_v3_window_and_frozen_recipe_contract():
    m = v3_manifest()
    m["clips"][0]["original_audio"] = "detached"
    m["independent_audio"] = [
        {
            "id": "audio-a-right",
            "timeline_start_frame": 100,
            "duration_frames": 50,
            "source_start_sample": 192000,
            "source": {
                "kind": "video-edit",
                "source_id": "base",
                "source_start_frame": 0,
                "source_end_frame": 149,
                "speed": 1,
                "normalization_fps": 25,
            },
            "detached_from": {"track": "video1", "clip_id": "deleted"},
        }
    ]
    plan = parse(m)
    assert plan.exports == ("mp4",)
    assert plan.clips[0].output_out_frame == 150
    assert plan.independent_audio[0].source.normalization_fps == 25
    assert plan.independent_audio[0].detached_from.clip_id == "deleted"


@pytest.mark.parametrize(
    "path,value",
    [
        (("typo",), 1),
        (("output_fps",), True),
        (("output_fps",), 29),
        (("clips", 0, "output_in_frame"), True),
        (("clips", 0, "output_out_frame"), 0),
        (("clips", 0, "duration_frames"), 149),
        (("clips", 0, "timeline_start_frame"), 1),
        (("clips", 0, "original_audio"), "silent"),
        (("clips", 0, "speed"), float("nan")),
        (("clips", 0, "client_id"), "é" * 65),
        (("clips", 0, "source_id"), "missing"),
        (("audio", "original_volume"), float("inf")),
        (("exports",), []),
        (("exports",), ["wav"]),
        (("exports",), ["mp4", "mp4"]),
        (("exports",), ["mp4", "../wav"]),
        (("audio_sources",), [{"source_id": "base"}]),
        (("video2", 0, "client_id"), "main"),
    ],
)
def test_invalid_v3_contract(path, value):
    m = v3_manifest()
    target = m
    for k in path[:-1]:
        target = target[k]
    target[path[-1]] = value
    with pytest.raises(ApiError) as error:
        parse(m)
    assert error.value.status_code == 422


def test_utf8_identifier_boundary_and_duplicate_raw_keys():
    m = v3_manifest()
    m["clips"][0]["client_id"] = "é" * 64
    m["order"] = ["é" * 64]
    assert parse(m).order == ("é" * 64,)
    raw = json.dumps(m).replace('"schema_version": 3', '"schema_version": 3, "schema_version": 3')
    with pytest.raises(ApiError):
        _parse_manifest(raw, 2, 10)
    downgraded = json.dumps(m).replace(
        '"schema_version": 3', '"schema_version": 3, "schema_version": 1'
    )
    # Even a duplicate version key must not downgrade a V3 request into legacy parsing.
    with pytest.raises(ApiError) as e:
        _parse_manifest(downgraded, 1, 10)
    assert e.value.code == "invalid_manifest"


def test_audio_catalog_and_strict_recipe_provenance():
    m = v3_manifest()
    m["audio_sources"] = [{"source_id": "song"}]
    segment = {
        "id": "sound",
        "timeline_start_frame": 0,
        "duration_frames": 1,
        "source_start_sample": 0,
        "source": {"kind": "audio-file", "source_id": "song"},
    }
    m["independent_audio"] = [segment]
    assert parse(m).independent_audio[0].source.source_id == "song"
    for key, value in [
        ("id", "main"),
        ("source_start_sample", -1),
        ("typo", 0),
        ("source", {"kind": "audio-file", "source_id": "song", "speed": 1}),
        ("detached_from", {"track": "music", "clip_id": "gone"}),
    ]:
        invalid = copy.deepcopy(m)
        invalid["independent_audio"][0][key] = value
        with pytest.raises(ApiError):
            parse(invalid)


def test_duplicate_detection_keeps_legacy_ignored_fields_compatible():
    from tests.backend.test_api import manifest

    raw = manifest(1)
    raw = raw[:-1] + ', "unused": {"schema_version": 3, "same": 1, "same": 2}}'
    assert _parse_manifest(raw, 1, 10).order == ("clip-0",)


@pytest.mark.parametrize("field,value", [("position", []), ("size", {})])
@pytest.mark.parametrize("kind", ["image", "video"])
def test_v3_overlay_invalid_enum_types_return_validation_error(kind, field, value):
    m = v3_manifest()
    m["overlays"][kind] = {
        "start_frame": 0,
        "end_frame": 1,
        "position": "top-left",
        "size": "small",
        field: value,
    }
    with pytest.raises(ApiError) as error:
        parse(m)
    assert error.value.status_code == 422
