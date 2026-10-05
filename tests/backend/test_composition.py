from __future__ import annotations


def test_overlay_graph_maps_sizes_positions_timing_and_z_order():
    from backend.app.composition import build_overlay_graph
    from backend.app.jobs import OverlaySettings

    graph = build_overlay_graph(
        output_fps=30,
        total_project_frames=120,
        video=(1, OverlaySettings(15, 44, "bottom-left", "medium")),
        image=(2, OverlaySettings(30, 89, "top-right", "small")),
    )

    assert "[0:v]setpts=PTS-STARTPTS[base0]" in graph.filter_complex
    assert "[1:v]fps=30" in graph.filter_complex
    assert (
        "scale=384:216:force_original_aspect_ratio=decrease:force_divisible_by=2"
        in graph.filter_complex
    )
    assert "trim=duration=1.000000" in graph.filter_complex
    assert "setpts=PTS-STARTPTS+15/(30*TB)[pip]" in graph.filter_complex
    assert "x=24:y=H-h-24" in graph.filter_complex
    assert "enable='between(n\\,15\\,44)'" in graph.filter_complex
    assert "eof_action=pass:repeatlast=0:shortest=0" in graph.filter_complex
    assert "[2:v]fps=30,format=rgba" in graph.filter_complex
    assert (
        "scale=256:144:force_original_aspect_ratio=decrease:force_divisible_by=2"
        in graph.filter_complex
    )
    assert "x=W-w-24:y=24" in graph.filter_complex
    assert graph.filter_complex.index("[pip]") < graph.filter_complex.index("[image]")
    assert "fps=30,format=yuv420p,setsar=1[outv]" in graph.filter_complex
    assert graph.output_label == "[outv]"


def test_overlay_graph_supports_all_positions_and_sizes():
    from backend.app.composition import build_overlay_graph
    from backend.app.jobs import OverlaySettings

    expected = {
        ("top-left", "small"): ("x=24:y=24", "scale=256:144"),
        ("top-right", "medium"): ("x=W-w-24:y=24", "scale=384:216"),
        ("bottom-left", "large"): ("x=24:y=H-h-24", "scale=512:288"),
        ("bottom-right", "small"): ("x=W-w-24:y=H-h-24", "scale=256:144"),
        ("centre", "medium"): ("x=(W-w)/2:y=(H-h)/2", "scale=384:216"),
    }
    for (position, size), (coordinates, scale) in expected.items():
        graph = build_overlay_graph(24, 100, (1, OverlaySettings(0, 9, position, size)), None)
        assert coordinates in graph.filter_complex
        assert scale in graph.filter_complex


def test_image_only_graph_uses_rgba_and_inclusive_one_frame_schedule():
    from backend.app.composition import build_overlay_graph
    from backend.app.jobs import OverlaySettings

    graph = build_overlay_graph(25, 25, None, (1, OverlaySettings(24, 24, "centre", "large")))

    assert "trim=duration=0.040000" in graph.filter_complex
    assert "setpts=PTS-STARTPTS+24/(25*TB)[image]" in graph.filter_complex
    assert "enable='between(n\\,24\\,24)'" in graph.filter_complex
