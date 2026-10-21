import json
from dataclasses import replace

import pytest

from backend.app.audio_composition import build_segmented_music_graph
from backend.app.errors import ApiError
from backend.app.jobs import MusicSegment
from backend.app.main import _parse_manifest
from backend.app.render_plan import resolve_v4_render_plan
from tests.backend.test_render_plan import sources
from tests.backend.test_v4_manifest import v4_manifest


def test_each_music_piece_validates_its_own_eof():
    plan = _parse_manifest(json.dumps(v4_manifest()), 2, 10)
    resolved = resolve_v4_render_plan(plan, sources(), {"song-a": 48000, "song-b": 96000}, {})
    assert resolved.total_frames == 150
    assert resolved.music_sample_counts == {"song-a": 48000, "song-b": 96000}
    assert [s.source_id for s in resolved.music.segments] == ["song-a", "song-b"]
    with pytest.raises(ApiError) as error:
        resolve_v4_render_plan(plan, sources(), {"song-a": 999999, "song-b": 1000}, {})
    assert error.value.details["source_id"] == "song-b"
    assert error.value.details["segment_id"] == "right"


def test_v4_overlap_rejected_and_picture_ownership_unchanged():
    plan = _parse_manifest(json.dumps(v4_manifest()), 2, 10)
    overlap = replace(plan.music.segments[1], timeline_start_frame=20)
    with pytest.raises(ApiError) as error:
        resolve_v4_render_plan(
            replace(plan, music=replace(plan.music, segments=(plan.music.segments[0], overlap))),
            sources(),
            {"song-a": 48000, "song-b": 96000},
            {},
        )
    assert error.value.code == "invalid_overlap"
    a = resolve_v4_render_plan(plan, sources(), {"song-a": 48000, "song-b": 96000}, {})
    b = resolve_v4_render_plan(replace(plan, music=None), sources(), {}, {})
    assert a.slices == b.slices
    assert a.audio_slices == b.audio_slices


def test_segmented_music_uses_own_source_inputs_and_offsets():
    graph = build_segmented_music_graph(
        (
            MusicSegment("left", "a", 10, 4800, 20),
            MusicSegment("right", "b", 30, 9600, 35),
            MusicSegment("again", "a", 70, 100, 2),
        ),
        25,
        150,
        {"a": 3, "b": 4},
    )
    assert "[3:a:0]asplit=2" in graph.filter_complex
    assert "[4:a:0]asplit=1" in graph.filter_complex
    assert "start_sample=4800:end_sample=43200" in graph.filter_complex
    assert "start_sample=9600:end_sample=76800" in graph.filter_complex
    assert "delays=57600S" in graph.filter_complex
    assert "normalize=0" in graph.filter_complex
    assert "volume=" not in graph.filter_complex
