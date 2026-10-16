import json
from dataclasses import replace

import pytest

from backend.app.errors import ApiError
from backend.app.main import _parse_manifest
from backend.app.render_plan import resolve_v3_render_plan
from tests.backend.advanced_fixtures import v3_manifest
from tests.backend.test_render_plan import sources


def plan():
    return _parse_manifest(json.dumps(v3_manifest()), 2, 10)


def test_picture_windows_and_independent_ownership():
    p = plan()
    from backend.app.jobs import AudioFileRecipe, IndependentAudioSegment

    s = IndependentAudioSegment("dialog", 80, 40, 192000, AudioFileRecipe("voice"))
    p = replace(p, independent_audio=(s,))
    r = resolve_v3_render_plan(p, sources(), {"voice": 288000}, {})
    assert r.total_frames == 150
    assert [(s.start_frame, s.end_frame_exclusive, s.owner_id) for s in r.audio_slices] == [
        (0, 40, "main"),
        (40, 80, "replacement"),
        (80, 100, "dialog"),
        (100, 120, "dialog"),
        (120, 150, "main"),
    ]
    assert r.audio_slices[3].source_start_sample == 192000 + 20 * 1920


def test_detached_selected_picture_is_silent_without_fallback():
    p = plan()
    p = replace(p, video2=(replace(p.video2[0], original_audio="detached"),))
    r = resolve_v3_render_plan(p, sources(), {}, {})
    assert r.audio_slices[1].source is None
    assert r.audio_slices[2].owner_id == "main"


@pytest.mark.parametrize("shortfall,accepted", [(1919, True), (1920, False)])
def test_independent_EOF_threshold_and_tails(shortfall, accepted):
    from backend.app.jobs import AudioFileRecipe, IndependentAudioSegment

    p = replace(
        plan(),
        independent_audio=(IndependentAudioSegment("sound", 200, 2, 0, AudioFileRecipe("voice")),),
    )
    if accepted:
        r = resolve_v3_render_plan(p, sources(), {"voice": 3840 - shortfall}, {})
        assert all(v.owner_id != "sound" for v in r.audio_slices)
    else:
        with pytest.raises(ApiError) as e:
            resolve_v3_render_plan(p, sources(), {"voice": 3840 - shortfall}, {})
        assert e.value.code == "invalid_range"
        assert e.value.details["segment_id"] == "sound"


def test_authoritative_windows_never_clamp_and_full_source_is_exact():
    p = plan()
    with pytest.raises(ApiError):
        resolve_v3_render_plan(p, sources(base_frames=149), {}, {})
    p = replace(p, video2=(replace(p.video2[0], content_full_source=True, content_out_frame=59),))
    with pytest.raises(ApiError):
        resolve_v3_render_plan(p, sources(), {}, {})


def test_window_offset_and_video_only_referenced_by_recipe():
    from backend.app.jobs import IndependentAudioSegment, VideoEditRecipe

    p = plan()
    recipe = VideoEditRecipe("take", 0, 59, 1, 30)
    s = IndependentAudioSegment("sound", 0, 10, 0, recipe)
    p = replace(
        p,
        video2=(),
        independent_audio=(s,),
        clips=(replace(p.clips[0], output_in_frame=40, output_out_frame=60, duration_frames=20),),
    )
    r = resolve_v3_render_plan(p, sources(), {}, {recipe: 115200})
    assert r.slices[0].content_start_frame == 40
    assert r.audio_slices[1].source_start_sample == 50 * 1920


def test_audio_and_video2_overlap_rejected_with_lane():
    p = plan()
    p = replace(
        p, video2=(*p.video2, replace(p.video2[0], client_id="other", timeline_start_frame=99))
    )
    with pytest.raises(ApiError) as e:
        resolve_v3_render_plan(p, sources(), {}, {})
    assert e.value.details["track"] == "video2"
