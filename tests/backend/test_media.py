from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest


def completed(args, stdout="", stderr=""):
    return subprocess.CompletedProcess(args=args, returncode=0, stdout=stdout, stderr=stderr)


def test_pipeline_uses_argument_lists_generated_paths_and_preserves_clip_order(
    settings, monkeypatch, tmp_path: Path
):
    from backend.app.jobs import Job
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    storage = Storage(settings)
    job = Job.create(storage, "77777777-7777-4777-8777-777777777777")
    job.input_paths = storage.save_uploads(
        job.id, [("first secret.mp4", b"1"), ("second.mov", b"2")]
    )
    calls: list[list[str]] = []
    probes = iter(
        [
            {
                "streams": [{"codec_type": "video"}, {"codec_type": "audio"}],
                "format": {"duration": "0.7"},
            },
            {"streams": [{"codec_type": "video"}]},
        ]
    )

    def run(args, **kwargs):
        assert isinstance(args, list)
        calls.append(args)
        if args[0] == settings.ffprobe_path:
            return completed(args, stdout=json.dumps(next(probes)))
        Path(args[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(args[-1]).write_bytes(b"media")
        return completed(args)

    monkeypatch.setattr(subprocess, "run", run)
    MediaPipeline(settings).merge(job)

    flattened = " ".join(value for args in calls for value in args)
    assert "first secret" not in flattened
    assert "second.mov" not in flattened
    assert calls[0][0] == "ffprobe-test"
    assert calls[-1][0] == "ffmpeg-test"
    assert calls[-1][-1] == str(job.result_path)
    concat_file = job.intermediate_dir / "concat.txt"
    concat_text = concat_file.read_text(encoding="utf-8")
    assert concat_text.index("000.mp4") < concat_text.index("001.mp4")
    assert "anullsrc" in flattened
    assert "setsar=1" in flattened
    first_normalize = calls[1]
    assert first_normalize[first_normalize.index("-t") + 1] == "0.700000"


def test_pipeline_uses_selected_fps_for_normalization_and_concat(settings, monkeypatch):
    from backend.app.jobs import ClipEdit, Job
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    job = Job.create(Storage(settings), "12121212-1212-4121-8121-121212121212")
    job.input_paths = [job.upload_dir / "000.mp4", job.upload_dir / "001.mp4"]
    for path in job.input_paths:
        path.write_bytes(b"video")
    job.clip_edits = [ClipEdit(0, 23, 1), ClipEdit(0, 59, 1)]
    job.output_fps = 25
    pipeline = MediaPipeline(settings)
    metadata = iter(
        [
            {
                "streams": [
                    {
                        "codec_type": "video",
                        "avg_frame_rate": "24/1",
                        "nb_read_frames": "24",
                    }
                ]
            },
            {
                "streams": [
                    {
                        "codec_type": "video",
                        "avg_frame_rate": "60/1",
                        "nb_read_frames": "60",
                    }
                ]
            },
        ]
    )
    monkeypatch.setattr(pipeline, "_probe", lambda _path: next(metadata))
    calls = []

    def run(args, **_kwargs):
        calls.append(args)
        Path(args[-1]).write_bytes(b"media")
        return completed(args)

    monkeypatch.setattr(pipeline, "_run", run)

    pipeline.merge(job)

    for normalize in calls[:2]:
        assert "fps=25" in normalize[normalize.index("-vf") + 1]
    concat = calls[2]
    assert "fps=25" in concat[concat.index("-vf") + 1]
    for flag, expected in (
        ("-r", "25"),
        ("-fps_mode", "cfr"),
        ("-c:v", "libx264"),
        ("-preset", "medium"),
        ("-crf", "23"),
        ("-c:a", "aac"),
        ("-b:a", "192k"),
        ("-movflags", "+faststart"),
    ):
        assert concat[concat.index(flag) + 1] == expected


def test_pipeline_rejects_clip_without_video(settings, monkeypatch):
    from backend.app.jobs import Job
    from backend.app.media import InvalidMediaError, MediaPipeline
    from backend.app.storage import Storage

    storage = Storage(settings)
    job = Job.create(storage, "88888888-8888-4888-8888-888888888888")
    job.input_paths = storage.save_uploads(job.id, [("audio.mp4", b"audio")])

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda args, **kwargs: completed(args, stdout='{"streams":[{"codec_type":"audio"}]}'),
    )

    with pytest.raises(InvalidMediaError, match="video stream"):
        MediaPipeline(settings).merge(job)


def test_pipeline_sets_timeout_and_sanitizes_subprocess_failures(settings, monkeypatch, caplog):
    from backend.app.jobs import Job
    from backend.app.media import MediaPipeline, ProcessingError
    from backend.app.storage import Storage

    storage = Storage(settings)
    job = Job.create(storage, "99999999-9999-4999-8999-999999999999")
    job.input_paths = storage.save_uploads(job.id, [("secret.mp4", b"bad")])

    def fail(args, **kwargs):
        assert kwargs["timeout"] == settings.subprocess_timeout_seconds
        raise subprocess.CalledProcessError(
            1,
            args,
            stderr=r"C:\private\secret.mp4: Invalid data found when processing input",
        )

    monkeypatch.setattr(subprocess, "run", fail)

    with pytest.raises(ProcessingError) as caught:
        MediaPipeline(settings).merge(job)
    assert "private" not in str(caught.value)
    assert "private" not in caplog.text
    assert "returncode=1" in caplog.text
    assert "reason=invalid_data" in caplog.text


def test_pipeline_restricts_demuxers_protocols_and_stdin(settings, monkeypatch):
    from backend.app.jobs import Job
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    storage = Storage(settings)
    job = Job.create(storage, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    job.input_paths = storage.save_uploads(job.id, [("renamed.mp4", b"playlist")])
    calls: list[list[str]] = []
    call_options: list[dict] = []

    def run(args, **kwargs):
        calls.append(args)
        call_options.append(kwargs)
        if args[0] == settings.ffprobe_path:
            return completed(args, stdout='{"streams":[{"codec_type":"video"}]}')
        Path(args[-1]).write_bytes(b"media")
        return completed(args)

    monkeypatch.setattr(subprocess, "run", run)
    MediaPipeline(settings).merge(job)

    probe, normalize, concatenate = calls
    assert "-nostdin" not in probe
    assert "-nostdin" in normalize
    assert "-nostdin" in concatenate
    assert all(options["stdin"] is subprocess.DEVNULL for options in call_options)
    assert probe[probe.index("-protocol_whitelist") + 1] == "file,pipe"
    assert probe[probe.index("-format_whitelist") + 1] == "mov,matroska,webm"
    assert normalize[normalize.index("-protocol_whitelist") + 1] == "file,pipe"
    assert normalize[normalize.index("-format_whitelist") + 1] == "mov,matroska,webm"
    assert concatenate[concatenate.index("-protocol_whitelist") + 1] == "file,pipe"
    assert concatenate[concatenate.index("-format_whitelist") + 1] == "concat,mov"
    assert "copy" not in concatenate
    assert concatenate[concatenate.index("-r") + 1] == "30"
    assert concatenate[concatenate.index("-fps_mode") + 1] == "cfr"


def test_pipeline_trims_before_speed_and_mixes_looped_background_audio(settings, monkeypatch):
    from backend.app.jobs import AudioMixSettings, ClipEdit, Job
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    storage = Storage(settings)
    job = Job.create(storage, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    job.input_paths = storage.save_uploads(job.id, [("secret.mp4", b"video")])
    job.background_audio_path = job.upload_dir / "background.mp3"
    job.background_audio_path.write_bytes(b"music")
    job.clip_edits = [ClipEdit(start_frame=10, end_frame=19, speed=0.5)]
    job.audio_mix = AudioMixSettings(
        original_volume=0.8,
        original_muted=False,
        music_volume=0.3,
        music_muted=False,
    )
    calls: list[list[str]] = []

    def run(args, **kwargs):
        calls.append(args)
        if args[0] == settings.ffprobe_path:
            return completed(
                args,
                stdout=json.dumps(
                    {
                        "streams": [
                            {
                                "codec_type": "video",
                                "avg_frame_rate": "30/1",
                                "nb_frames": "90",
                                "duration": "3",
                            },
                            {"codec_type": "audio"},
                        ],
                        "format": {"duration": "3"},
                    }
                ),
            )
        Path(args[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(args[-1]).write_bytes(b"media")
        return completed(args)

    monkeypatch.setattr(subprocess, "run", run)
    MediaPipeline(settings).merge(job)

    normalize = calls[1]
    video_filter = normalize[normalize.index("-vf") + 1]
    audio_filter = normalize[normalize.index("-af") + 1]
    assert "trim=start_frame=10:end_frame=20" in video_filter
    assert video_filter.index("trim=") < video_filter.index("setpts=(PTS-STARTPTS)/0.5")
    assert "atrim=start=0.333333:end=0.666667" in audio_filter
    assert "atempo=0.5" in audio_filter
    assert normalize[normalize.index("-t") + 1] == "0.666667"
    mix = calls[-1]
    assert "-stream_loop" in mix and mix[mix.index("-stream_loop") + 1] == "-1"
    filters = mix[mix.index("-filter_complex") + 1]
    assert "volume=0.8" in filters
    assert "volume=0.3" in filters
    assert "amix=inputs=2" in filters
    assert "normalize=0" in filters
    assert "atrim=duration=0.666667" in filters
    assert "secret" not in " ".join(value for call in calls for value in call)
    music_input = mix.index(str(job.background_audio_path))
    assert mix[music_input - 2 : music_input] == ["mov,mp3,wav,aac", "-i"]


def test_pipeline_applies_original_mute_without_background_audio(settings, monkeypatch):
    from backend.app.jobs import AudioMixSettings, ClipEdit, Job
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    job = Job.create(Storage(settings), "cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    job.input_paths = [job.upload_dir / "000.mp4"]
    job.input_paths[0].write_bytes(b"video")
    job.clip_edits = [ClipEdit(0, 29, 1)]
    job.audio_mix = AudioMixSettings(original_muted=True)
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        if args[0] == settings.ffprobe_path:
            return completed(
                args,
                stdout=json.dumps(
                    {
                        "streams": [
                            {
                                "codec_type": "video",
                                "avg_frame_rate": "30/1",
                                "nb_frames": "30",
                                "duration": "1",
                            },
                            {"codec_type": "audio"},
                        ]
                    }
                ),
            )
        Path(args[-1]).write_bytes(b"media")
        return completed(args)

    monkeypatch.setattr(subprocess, "run", run)
    MediaPipeline(settings).merge(job)
    normalize = calls[1]
    assert "volume=0" in normalize[normalize.index("-af") + 1]


def test_pipeline_clamps_stale_end_before_building_ffmpeg_filters(settings, monkeypatch):
    from backend.app.jobs import ClipEdit, Job
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    job = Job.create(Storage(settings), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    job.input_paths = [job.upload_dir / "000.mp4"]
    job.input_paths[0].write_bytes(b"video")
    job.clip_edits = [ClipEdit(0, 35, 1, trim_saved=False)]
    pipeline = MediaPipeline(settings)
    monkeypatch.setattr(
        pipeline,
        "_probe",
        lambda _path: {
            "streams": [
                {
                    "codec_type": "video",
                    "avg_frame_rate": "30/1",
                    "nb_read_frames": "30",
                    "duration": "1",
                }
            ]
        },
    )
    calls = []

    def run(args, **_kwargs):
        calls.append(args)
        Path(args[-1]).write_bytes(b"media")
        return completed(args)

    monkeypatch.setattr(pipeline, "_run", run)

    pipeline.merge(job)

    video_filter = calls[0][calls[0].index("-vf") + 1]
    assert "trim=start_frame=0:end_frame=30" in video_filter
    assert job.clip_edits == [ClipEdit(0, 29, 1, trim_saved=False)]


def test_preflight_clamps_untouched_browser_end_to_decoded_final_frame(settings, monkeypatch):
    from backend.app.jobs import ClipEdit, Job
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    job = Job.create(Storage(settings), "dddddddd-dddd-4ddd-8ddd-dddddddddddd")
    job.input_paths = [job.upload_dir / "000.mp4"]
    job.input_paths[0].write_bytes(b"video")
    job.clip_edits = [ClipEdit(0, 583, 1, trim_saved=False)]
    pipeline = MediaPipeline(settings)
    monkeypatch.setattr(
        pipeline,
        "_probe",
        lambda _path: {
            "streams": [
                {
                    "codec_type": "video",
                    "avg_frame_rate": "30/1",
                    "nb_read_frames": "583",
                }
            ]
        },
    )
    pipeline.validate_job(job)

    assert job.clip_edits == [ClipEdit(0, 582, 1, trim_saved=False)]


def test_preflight_clamps_saved_end_when_range_remains_valid(settings, monkeypatch):
    from backend.app.jobs import ClipEdit, Job
    from backend.app.media import MediaPipeline
    from backend.app.storage import Storage

    job = Job.create(Storage(settings), "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    job.input_paths = [job.upload_dir / "000.mp4"]
    job.input_paths[0].write_bytes(b"video")
    job.clip_edits = [ClipEdit(20, 35, 1, trim_saved=True)]
    pipeline = MediaPipeline(settings)
    monkeypatch.setattr(
        pipeline,
        "_probe",
        lambda _path: {
            "streams": [
                {
                    "codec_type": "video",
                    "avg_frame_rate": "30/1",
                    "nb_read_frames": "30",
                }
            ]
        },
    )

    pipeline.validate_job(job)

    assert job.clip_edits == [ClipEdit(20, 29, 1, trim_saved=True)]


def test_preflight_rejects_saved_range_invalid_after_clamping(settings, monkeypatch):
    from backend.app.jobs import ClipEdit, Job
    from backend.app.media import InvalidMediaError, MediaPipeline
    from backend.app.storage import Storage

    job = Job.create(Storage(settings), "ffffffff-ffff-4fff-8fff-ffffffffffff")
    job.input_paths = [job.upload_dir / "000.mp4"]
    job.input_paths[0].write_bytes(b"video")
    job.clip_edits = [ClipEdit(30, 35, 1, trim_saved=True)]
    pipeline = MediaPipeline(settings)
    monkeypatch.setattr(
        pipeline,
        "_probe",
        lambda _path: {
            "streams": [
                {
                    "codec_type": "video",
                    "avg_frame_rate": "30/1",
                    "nb_read_frames": "30",
                }
            ]
        },
    )

    with pytest.raises(InvalidMediaError, match="Clip 1.*selected trim.*decoded frames"):
        pipeline.validate_job(job)


def test_preflight_rejects_non_audio_music(settings, monkeypatch):
    from backend.app.jobs import ClipEdit, Job
    from backend.app.media import InvalidMediaError, MediaPipeline
    from backend.app.storage import Storage

    job = Job.create(Storage(settings), "dddddddd-dddd-4ddd-8ddd-dddddddddddd")
    job.input_paths = [job.upload_dir / "000.mp4"]
    job.input_paths[0].write_bytes(b"video")
    pipeline = MediaPipeline(settings)
    monkeypatch.setattr(
        pipeline,
        "_probe",
        lambda _path: {
            "streams": [
                {
                    "codec_type": "video",
                    "avg_frame_rate": "30/1",
                    "nb_read_frames": "30",
                }
            ]
        },
    )

    job.clip_edits = [ClipEdit(0, 29, 1)]
    job.background_audio_path = job.upload_dir / "background.mp3"
    job.background_audio_path.write_bytes(b"not audio")
    monkeypatch.setattr(pipeline, "_probe_audio", lambda _path: False)
    with pytest.raises(InvalidMediaError, match="background audio"):
        pipeline.validate_job(job)
