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


def test_v3_master_applies_each_bus_gain_once(settings, monkeypatch):
    from dataclasses import replace

    from backend.app.advanced_media import render_audio_master
    from backend.app.jobs import AudioMixSettings, Job, MusicPlan, MusicSegment
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    job = Job.create(Storage(settings), "abababab-abab-4bab-8bab-abababababab")
    job.audio_mix = AudioMixSettings(0.5, False, 0.3, False)
    job.decoded_audio_paths["song"] = job.intermediate_dir / "song.wav"
    base = resolve_render_plan(parse_advanced_manifest(advanced_manifest(), 2, 10), sources(), None)
    music = MusicPlan(
        "song", (MusicSegment("a", "song", 0, 0, 10), MusicSegment("b", "song", 20, 19200, 10))
    )
    plan = replace(base, music=music)
    commands = []
    pipeline = MediaPipeline(settings)
    monkeypatch.setattr(pipeline, "_run", commands.append)
    render_audio_master(pipeline, job, plan)
    args = commands[0]
    graph = args[args.index("-filter_complex") + 1]
    assert graph.count("volume=0.5") == 1
    assert graph.count("volume=0.3") == 1
    assert "pcm_s16le" in args and "end_sample=288000" in graph
