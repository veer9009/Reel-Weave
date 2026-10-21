"""PCM-preserving execution of a resolved version-2 timeline."""

from __future__ import annotations

from pathlib import Path

from .composition import build_overlay_graph
from .jobs import Job, VideoEditRecipe
from .media import MediaPipeline, ProcessingError
from .render_plan import ResolvedRenderPlan, ResolvedSlice, ResolvedVideoEdit


def command(pipeline: MediaPipeline) -> list[str]:
    return [
        pipeline.settings.ffmpeg_path,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
    ]


def media_input(path: Path, formats: str = "mov,matroska,webm,wav") -> list[str]:
    return ["-protocol_whitelist", "file,pipe", "-format_whitelist", formats, "-i", str(path)]


def video_output(fps: int, frames: int, path: Path) -> list[str]:
    return [
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(fps),
        "-fps_mode",
        "cfr",
        "-frames:v",
        str(frames),
        "-t",
        f"{frames / fps:.9f}",
        "-movflags",
        "+faststart",
        str(path),
    ]


def slice_filters(item: ResolvedSlice, fps: int) -> tuple[str, str]:
    start = item.content_start_frame
    end = start + item.end_frame_exclusive - item.start_frame
    k = 48000 // fps
    return (
        f"trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS",
        f"atrim=start_sample={start * k}:end_sample={end * k},asetpts=PTS-STARTPTS",
    )


def _normalize_video_edit(
    pipeline: MediaPipeline,
    job: Job,
    edit: ResolvedVideoEdit,
    ordinal: int = 0,
    *,
    audio_required=True,
) -> tuple[Path, Path]:
    video = job.intermediate_dir / f"advanced-normal-{ordinal:03d}.mp4"
    audio = job.intermediate_dir / f"advanced-normal-{ordinal:03d}.wav"
    s = edit.edit
    fps = job.output_fps
    source = edit.source_info
    filters = (
        f"trim=start_frame={s.start_frame}:end_frame={s.end_frame + 1},"
        f"setpts=(PTS-STARTPTS)/{s.speed:g},"
        "scale=w='trunc(ih*dar/2)*2':h='trunc(ih/2)*2',setsar=1,"
        "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,"
        f"pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps={fps}:eof_action=pass,"
        "format=yuv420p,setsar=1"
    )
    pipeline._run(
        command(pipeline)
        + media_input(source.path)
        + ["-map", "0:v:0", "-vf", filters, "-an"]
        + video_output(fps, edit.output_frames, video)
    )
    metadata = pipeline._probe(video)
    if pipeline._total_frames(metadata, pipeline._video_fps(metadata)) != edit.output_frames:
        raise ProcessingError("Normalized video does not contain the requested frames.")
    if not audio_required:
        return video, audio
    if source.has_audio:
        args = media_input(source.path)
        audio_filter = (
            f"atrim=start={s.start_frame / source.fps:.9f}:"
            f"end={(s.end_frame + 1) / source.fps:.9f},asetpts=PTS-STARTPTS,"
            f"atempo={s.speed:g},aresample=48000,aformat=channel_layouts=stereo,"
        )
    else:
        args = ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
        audio_filter = ""
    audio_filter += (
        f"apad,atrim=end_sample={edit.output_frames * (48000 // fps)},asetpts=PTS-STARTPTS"
    )
    pipeline._run(
        command(pipeline)
        + args
        + [
            "-map",
            "0:a:0",
            "-af",
            audio_filter,
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(audio),
        ]
    )
    return video, audio


def _join_selected_slices(
    pipeline: MediaPipeline,
    job: Job,
    plan: ResolvedRenderPlan,
    normalized: dict[str, tuple[Path, Path]],
    *,
    audio_required=True,
) -> tuple[Path, Path]:
    video = job.intermediate_dir / "selected-video.mp4"
    audio = job.intermediate_dir / "selected-original.wav"
    for audio_only, destination in [(False, video), (True, audio)]:
        if audio_only and not audio_required:
            continue
        args = command(pipeline)
        filters = []
        labels = []
        for i, slice_ in enumerate(plan.slices):
            args += media_input(normalized[slice_.occurrence_id][1 if audio_only else 0])
            video_filter, audio_filter = slice_filters(slice_, plan.output_fps)
            label = f"slice{i}"
            labels.append(f"[{label}]")
            filters.append(
                f"[{i}:{'a' if audio_only else 'v'}:0]"
                f"{audio_filter if audio_only else video_filter}[{label}]"
            )
        filters.append(
            "".join(labels) + f"concat=n={len(labels)}:v={0 if audio_only else 1}:"
            f"a={1 if audio_only else 0}[joined]"
        )
        args += ["-filter_complex", ";".join(filters), "-map", "[joined]"]
        if audio_only:
            args += ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(destination)]
        else:
            args += ["-an"] + video_output(plan.output_fps, plan.total_frames, destination)
        pipeline._run(args)
    return video, audio


def render_advanced_video(
    pipeline: MediaPipeline, job: Job, plan: ResolvedRenderPlan, *, audio_required=True
) -> tuple[Path, Path]:
    normalized = {}
    cache = {}
    for edit in plan.video_edits:
        key = (edit.source_id, edit.edit, edit.output_frames)
        if key not in cache:
            cache[key] = _normalize_video_edit(
                pipeline, job, edit, len(cache), audio_required=audio_required
            )
        normalized[edit.occurrence_id] = cache[key]
    video, audio = _join_selected_slices(
        pipeline, job, plan, normalized, audio_required=audio_required
    )
    if job.video_overlay_path or job.image_overlay_path:
        args = command(pipeline) + media_input(video)
        index = 1
        pip = None
        image = None
        if job.video_overlay_path and job.video_overlay_settings:
            args += media_input(job.video_overlay_path)
            pip = (index, job.video_overlay_settings)
            index += 1
        if job.image_overlay_path and job.image_overlay_settings:
            args += ["-loop", "1", "-framerate", str(plan.output_fps)] + media_input(
                job.image_overlay_path, "image2,png_pipe,jpeg_pipe"
            )
            image = (index, job.image_overlay_settings)
        graph = build_overlay_graph(plan.output_fps, plan.total_frames, pip, image)
        composed = job.intermediate_dir / "selected-composited.mp4"
        pipeline._run(
            args
            + ["-filter_complex", graph.filter_complex, "-map", graph.output_label, "-an"]
            + video_output(plan.output_fps, plan.total_frames, composed)
        )
        video = composed
    return video, audio


def render_advanced(pipeline: MediaPipeline, job: Job) -> None:
    from .audio_composition import build_final_mix_graph, build_music_graph

    plan = job.resolved_plan
    if plan is None:
        raise ProcessingError("Validated timeline is missing.")
    video, original = render_advanced_video(pipeline, job, plan)
    music_path = None
    if plan.music is not None:
        if job.decoded_music_path is None:
            raise ProcessingError("Decoded music source is missing.")
        graph = build_music_graph(plan.music.segments, plan.output_fps, plan.total_frames, 0)
        music_path = job.intermediate_dir / "selected-music.wav"
        pipeline._run(
            command(pipeline)
            + media_input(job.decoded_music_path)
            + [
                "-filter_complex",
                graph.filter_complex,
                "-map",
                graph.output_label,
                "-c:a",
                "pcm_s16le",
                "-ar",
                "48000",
                "-ac",
                "2",
                str(music_path),
            ]
        )
    args = command(pipeline) + media_input(video) + media_input(original)
    if music_path:
        args += media_input(music_path)
    graph = build_final_mix_graph(
        1, 2 if music_path else None, job.audio_mix, plan.total_frames * (48000 // plan.output_fps)
    )
    # Publish only after the complete bounded encode succeeds.
    destination = job.intermediate_dir / "final-advanced.mp4"
    pipeline._run(
        args
        + [
            "-filter_complex",
            graph.filter_complex,
            "-map",
            "0:v:0",
            "-map",
            graph.output_label,
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
        ]
        + video_output(plan.output_fps, plan.total_frames, destination)
    )
    destination.replace(job.result_path)


def normalize_video_recipe(pipeline, job: Job, recipe: VideoEditRecipe, source) -> Path:
    from .timeline import project_frame_count

    if recipe in job.recipe_audio_paths:
        return job.recipe_audio_paths[recipe]
    length = project_frame_count(
        recipe.source_end_frame - recipe.source_start_frame + 1,
        source.fps,
        recipe.speed,
        recipe.normalization_fps,
    )
    count = length * (48000 // recipe.normalization_fps)
    audio = job.intermediate_dir / f"recipe-{len(job.recipe_audio_paths):03d}.wav"
    if source.has_audio:
        args = media_input(source.path)
        filters = (
            f"atrim=start={recipe.source_start_frame / source.fps:.9f}:"
            f"end={(recipe.source_end_frame + 1) / source.fps:.9f},asetpts=PTS-STARTPTS,"
            f"atempo={recipe.speed:g},aresample=48000,aformat=channel_layouts=stereo,"
        )
    else:
        args = [
            "-f",
            "lavfi",
            "-i",
            f"anullsrc=channel_layout=stereo:sample_rate=48000:d={count / 48000:.9f}",
        ]
        filters = ""
    pipeline._run(
        command(pipeline)
        + args
        + [
            "-map",
            "0:a:0",
            "-af",
            filters + f"apad=whole_len={count},atrim=end_sample={count},asetpts=PTS-STARTPTS",
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(audio),
        ]
    )
    job.recipe_audio_paths[recipe] = audio
    return audio


def render_v3_picture(pipeline, job, plan) -> Path:
    return render_advanced_video(pipeline, job, plan, audio_required=False)[0]


def render_audio_master(pipeline, job, plan) -> Path:
    from .audio_composition import build_original_graph, build_segmented_music_graph
    from .jobs import AudioFileRecipe

    args = command(pipeline)
    indexes = {}
    file_indexes = {}
    for s in plan.audio_slices:
        if s.source is not None and s.source not in indexes:
            path = (
                job.decoded_audio_paths[s.source.source_id]
                if isinstance(s.source, AudioFileRecipe)
                else job.recipe_audio_paths[s.source]
            )
            if path not in file_indexes:
                file_indexes[path] = len(file_indexes)
                args += media_input(path)
            indexes[s.source] = file_indexes[path]
    original = build_original_graph(plan.audio_slices, indexes, plan.output_fps, plan.total_frames)
    filters = [original.filter_complex]
    original_gain = 0 if job.audio_mix.original_muted else job.audio_mix.original_volume
    music_gain = 0 if job.audio_mix.music_muted else job.audio_mix.music_volume
    filters.append(f"{original.output_label}volume={original_gain:g}[originalgain]")
    k = 48000 // plan.output_fps
    total = plan.total_frames * k
    if plan.music:
        music_indexes = {}
        for segment in plan.music.segments:
            path = job.decoded_audio_paths[segment.source_id]
            if path not in file_indexes:
                file_indexes[path] = len(file_indexes)
                args += media_input(path)
            music_indexes[segment.source_id] = file_indexes[path]
        music = build_segmented_music_graph(
            plan.music.segments, plan.output_fps, plan.total_frames, music_indexes
        )
        filters.append(music.filter_complex)
        filters.append(f"{music.output_label}volume={music_gain:g}[musicgain]")
        filters.append(
            "[originalgain][musicgain]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
            f"atrim=end_sample={total}[master]"
        )
    else:
        filters.append(f"[originalgain]atrim=end_sample={total}[master]")
    destination = job.intermediate_dir / "audio-master.wav"
    pipeline._run(
        args
        + [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[master]",
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(destination),
        ]
    )
    job.audio_master_path = destination
    return destination


def render_v3(pipeline, job) -> None:
    from . import exports
    from .jobs import ExportState

    plan = job.resolved_plan
    if plan is None:
        raise ProcessingError("Validated timeline is missing.")
    job.exports["mp4"] = ExportState("processing")
    try:
        picture = render_v3_picture(pipeline, job, plan)
        master = render_audio_master(pipeline, job, plan)
        primary = exports.publish_artifact(
            job, exports.render_primary_mp4(pipeline, job, picture, master, plan), "mp4"
        )
        job.exports["mp4"] = ExportState("ready", path=primary)
    except Exception:
        for name in job.exports:
            job.exports[name] = ExportState("failed", f"{name.upper()} export failed.")
        raise
    for name in plan.exports:
        if name == "mp4":
            continue
        job.exports[name] = ExportState("processing")
        try:
            staged = exports.render_optional_export(pipeline, job, name, primary, master, plan)
            path = exports.publish_artifact(job, staged, name)
        except Exception:
            job.exports[name] = ExportState(
                "failed", f"{name.upper()} export failed. Submit a new render to retry."
            )
        else:
            job.exports[name] = ExportState("ready", path=path)
