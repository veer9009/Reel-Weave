from dataclasses import replace
from pathlib import Path

import pytest

from backend.app.jobs import MusicPlan, MusicSegment
from backend.app.manifests import parse_advanced_manifest
from backend.app.media import InvalidMediaError
from backend.app.render_plan import VideoSourceInfo, resolve_render_plan
from tests.backend.advanced_fixtures import advanced_manifest


def sources(base_frames=150, take_frames=60):
    return {
        "base": VideoSourceInfo("base", Path("base.mp4"), 25, base_frames, 320, 180, True),
        "take": VideoSourceInfo("take", Path("take.mp4"), 25, take_frames, 320, 180, True),
    }


def test_priority_partition_and_base_resumption():
    p = resolve_render_plan(parse_advanced_manifest(advanced_manifest(), 2, 10), sources(), None)
    assert p.total_frames == 150
    assert [
        (v.start_frame, v.end_frame_exclusive, v.occurrence_id, v.content_start_frame)
        for v in p.slices
    ] == [(0, 40, "main", 0), (40, 100, "replacement", 0), (100, 150, "main", 100)]


def test_authoritative_full_window_expands_but_explicit_window_rejects():
    plan = parse_advanced_manifest(advanced_manifest(), 2, 10)
    with pytest.raises(InvalidMediaError):
        resolve_render_plan(plan, sources(take_frames=30), None)
    plan = replace(plan, video2=(replace(plan.video2[0], content_full_source=True),))
    p = resolve_render_plan(plan, sources(take_frames=30), None)
    assert p.slices[1].end_frame_exclusive == 70


@pytest.mark.parametrize("start,end", [(90, 120), (40, 50), (140, 170)])
def test_overlap_or_outside_export_rejected(start, end):
    plan = parse_advanced_manifest(advanced_manifest(), 2, 10)
    other = replace(
        plan.video2[0], client_id="other", timeline_start_frame=start, content_out_frame=end - start
    )
    with pytest.raises(InvalidMediaError):
        resolve_render_plan(replace(plan, video2=(*plan.video2, other)), sources(), None)


def test_adjacent_replacements_and_missing_media():
    plan = parse_advanced_manifest(advanced_manifest(), 2, 10)
    other = replace(
        plan.video2[0], client_id="other", timeline_start_frame=100, content_out_frame=20
    )
    assert (
        resolve_render_plan(
            replace(plan, video2=(*plan.video2, other)), sources(), None
        ).total_frames
        == 150
    )
    with pytest.raises(InvalidMediaError):
        resolve_render_plan(plan, {}, None)


def test_music_padding_at_K_minus_one_accepts_K_rejects():
    plan = replace(
        parse_advanced_manifest(advanced_manifest(), 2, 10),
        music=MusicPlan("song", (MusicSegment("music", "song", 200, 0, 1),)),
    )
    assert resolve_render_plan(plan, sources(), 1).music_sample_count == 1
    with pytest.raises(InvalidMediaError):
        resolve_render_plan(plan, sources(), 0)
    plan = replace(plan, music=MusicPlan("song", (MusicSegment("music", "song", 0, 0, 2),)))
    with pytest.raises(InvalidMediaError):
        resolve_render_plan(plan, sources(), 1920)


def test_music_overlap_and_source_exhaustion():
    plan = parse_advanced_manifest(advanced_manifest(), 2, 10)
    for segments in [
        (MusicSegment("a", "song", 0, 0, 10), MusicSegment("b", "song", 5, 0, 10)),
        (MusicSegment("a", "song", 0, 50000, 1),),
    ]:
        with pytest.raises(InvalidMediaError):
            resolve_render_plan(replace(plan, music=MusicPlan("song", segments)), sources(), 48000)
