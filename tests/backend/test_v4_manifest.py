import copy
import json

import pytest

from backend.app.errors import ApiError
from backend.app.main import _parse_manifest
from tests.backend.advanced_fixtures import v3_manifest


def v4_manifest():
    m = v3_manifest()
    m["schema_version"] = 4
    m["exports"] = ["mp4", "mov", "wav", "mp3"]
    m["audio_sources"] = [{"source_id": "song-a"}, {"source_id": "song-b"}]
    m["music"] = {
        "segments": [
            {
                "client_id": "left",
                "source_id": "song-a",
                "timeline_start_frame": 10,
                "source_start_sample": 4800,
                "duration_frames": 20,
            },
            {
                "client_id": "right",
                "source_id": "song-b",
                "timeline_start_frame": 30,
                "source_start_sample": 9600,
                "duration_frames": 35,
            },
        ]
    }
    return m


def parse(m):
    return _parse_manifest(json.dumps(m), 2, 10)


def test_v4_accepts_per_piece_music_sources():
    plan = parse(v4_manifest())
    assert plan.schema_version == 4
    assert plan.exports == ("mp4", "mov", "wav", "mp3")
    assert [
        (s.source_id, s.timeline_start_frame, s.source_start_sample, s.duration_frames)
        for s in plan.music.segments
    ] == [("song-a", 10, 4800, 20), ("song-b", 30, 9600, 35)]


def test_v3_still_rejects_mixed_music_sources():
    m = v4_manifest()
    m["schema_version"] = 3
    m["music"]["source_id"] = "song-a"
    with pytest.raises(ApiError, match="Music segment source"):
        parse(m)


@pytest.mark.parametrize(
    "path,value",
    [
        (("music", "source_id"), "song-a"),
        (("music", "segments", 0, "duration_frames"), 0),
        (("music", "segments", 0, "timeline_start_frame"), True),
        (("music", "segments", 0, "source_start_sample"), -1),
        (("music", "segments", 1, "source_id"), "missing"),
        (("music", "segments", 1, "client_id"), "left"),
        (("audio_sources", 1, "source_id"), "song-a"),
        (("exports",), ["mp4", "unknown"]),
        (("exports",), ["wav"]),
        (("schema_version",), 5),
    ],
)
def test_v4_rejects_invalid_ranges_references_and_shapes(path, value):
    m = copy.deepcopy(v4_manifest())
    node = m
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    with pytest.raises(ApiError):
        parse(m)


def test_v4_rejects_duplicate_json_keys():
    raw = json.dumps(v4_manifest()).replace(
        '"schema_version": 4', '"schema_version": 4, "schema_version": 4'
    )
    with pytest.raises(ApiError, match="Duplicate"):
        _parse_manifest(raw, 2, 10)
