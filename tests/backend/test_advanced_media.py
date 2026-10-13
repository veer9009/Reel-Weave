from backend.app.manifests import parse_advanced_manifest
from backend.app.render_plan import resolve_render_plan
from tests.backend.advanced_fixtures import advanced_manifest
from tests.backend.test_render_plan import sources


def test_selected_slice_offsets_are_frames_and_PCM_samples():
    from backend.app.advanced_media import slice_filters

    plan = resolve_render_plan(parse_advanced_manifest(advanced_manifest(), 2, 10), sources(), None)
    assert slice_filters(plan.slices[2], 25) == (
        "trim=start_frame=100:end_frame=150,setpts=PTS-STARTPTS",
        "atrim=start_sample=192000:end_sample=288000,asetpts=PTS-STARTPTS",
    )
