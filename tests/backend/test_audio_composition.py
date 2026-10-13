from backend.app.jobs import AudioMixSettings, MusicSegment


def test_music_graph_uses_sample_offsets_and_silent_bed():
    from backend.app.audio_composition import build_music_graph

    graph = build_music_graph(
        (MusicSegment("left", "song", 25, 0, 50), MusicSegment("right", "song", 75, 144000, 125)),
        25,
        150,
        0,
    )
    assert "start_sample=144000" in graph.filter_complex
    assert "48000S" in graph.filter_complex and "144000S" in graph.filter_complex
    assert "end_sample=288000" in graph.filter_complex
    assert "normalize=0" in graph.filter_complex
    assert "anullsrc" in graph.filter_complex


def test_music_outside_export_is_silent_and_gain_applies_once():
    from backend.app.audio_composition import build_final_mix_graph, build_music_graph

    graph = build_music_graph((MusicSegment("tail", "song", 200, 0, 10),), 25, 150, 0)
    assert "adelay" not in graph.filter_complex
    mix = build_final_mix_graph(1, 2, AudioMixSettings(1, True, 0.3, False), 288000)
    assert "volume=0[" in mix.filter_complex
    assert mix.filter_complex.count("volume=0.3") == 1
