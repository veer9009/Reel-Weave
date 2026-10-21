"""Authoritative video/audio selection in half-open project frames."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from .jobs import (
    AdvancedMergePlan,
    AudioFileRecipe,
    AudioRecipe,
    ClipEdit,
    ExportFormat,
    MultiSourceMusicPlan,
    MusicPlan,
    V3MergePlan,
    V4MergePlan,
    VideoEditRecipe,
)
from .media import InvalidMediaError, MediaPipeline
from .timeline import project_frame_count


@dataclass(frozen=True, slots=True)
class VideoSourceInfo:
    source_id: str
    path: Path
    fps: float
    total_frames: int
    width: int
    height: int
    has_audio: bool


@dataclass(frozen=True, slots=True)
class ResolvedVideoEdit:
    occurrence_id: str
    source_id: str
    track: Literal["video1", "video2"]
    edit: ClipEdit
    output_frames: int
    source_info: VideoSourceInfo


@dataclass(frozen=True, slots=True)
class ResolvedSlice:
    start_frame: int
    end_frame_exclusive: int
    occurrence_id: str
    content_start_frame: int


@dataclass(frozen=True, slots=True)
class ResolvedAudioSlice:
    start_frame: int
    end_frame_exclusive: int
    source: AudioRecipe | None
    source_start_sample: int
    owner_id: str | None


@dataclass(frozen=True, slots=True)
class ResolvedRenderPlan:
    output_fps: int
    total_frames: int
    video_edits: tuple[ResolvedVideoEdit, ...]
    slices: tuple[ResolvedSlice, ...]
    music: MusicPlan | MultiSourceMusicPlan | None
    music_sample_count: int | None
    audio_slices: tuple[ResolvedAudioSlice, ...] = ()
    exports: tuple[ExportFormat, ...] = ("mp4",)
    music_sample_counts: dict[str, int] = field(default_factory=dict)


def resolve_render_plan(
    plan: AdvancedMergePlan, sources: dict[str, VideoSourceInfo], music_sample_count: int | None
) -> ResolvedRenderPlan:
    edits = []
    for index, occurrence in enumerate((*plan.clips, *plan.video2)):
        source = sources.get(occurrence.source_id)
        if source is None:
            raise InvalidMediaError("Missing video media.")
        edit = MediaPipeline._clamp_edit(occurrence.edit, source.total_frames, index + 1)
        length = project_frame_count(
            edit.end_frame - edit.start_frame + 1, source.fps, edit.speed, plan.output_fps
        )
        edits.append(
            ResolvedVideoEdit(
                occurrence.client_id,
                occurrence.source_id,
                "video1" if index < len(plan.clips) else "video2",
                edit,
                length,
                source,
            )
        )
    by_id = {v.occurrence_id: v for v in edits}
    base = []
    total = 0
    for occurrence_id in plan.order:
        edit = by_id[occurrence_id]
        base.append((total, total + edit.output_frames, occurrence_id, 0))
        total += edit.output_frames
    if total < 1:
        raise InvalidMediaError("Video 1 must contain at least one frame.")
    replacements = []
    for v in sorted(plan.video2, key=lambda v: v.timeline_start_frame):
        length = by_id[v.client_id].output_frames
        start = v.content_in_frame
        end = v.content_out_frame
        if v.content_full_source:
            if start != 0:
                raise InvalidMediaError("Full replacement source window must start at zero.")
            end = length
        if not 0 <= start < end <= length:
            raise InvalidMediaError(
                "Video 2 source window is unavailable. Re-trim the replacement."
            )
        a = v.timeline_start_frame
        b = a + end - start
        if a < 0 or b > total:
            raise InvalidMediaError("Video 2 range is outside Video 1.")
        if replacements and replacements[-1][1] > a:
            raise InvalidMediaError("Video 2 clips cannot overlap.")
        replacements.append((a, b, v.client_id, start))
    if plan.music:
        if not music_sample_count or music_sample_count < 1:
            raise InvalidMediaError("Music has no decoded audio samples.")
        k = 48000 // plan.output_fps
        previous_end = 0
        for v in sorted(plan.music.segments, key=lambda v: v.timeline_start_frame):
            if v.timeline_start_frame < previous_end:
                raise InvalidMediaError("Music segments cannot overlap.")
            if (
                v.source_start_sample >= music_sample_count
                or v.source_start_sample + v.duration_frames * k - music_sample_count >= k
            ):
                raise InvalidMediaError("Music range exceeds source EOF. Re-trim the segment.")
            previous_end = v.timeline_start_frame + v.duration_frames
    boundaries = sorted({0, total, *[n for interval in base + replacements for n in interval[:2]]})
    slices = []
    for a, b in zip(boundaries, boundaries[1:], strict=False):
        selected = next((v for v in replacements if v[0] <= a < v[1]), None)
        if selected is None:
            selected = next(v for v in base if v[0] <= a < v[1])
        offset = selected[3] + a - selected[0]
        if (
            slices
            and slices[-1].occurrence_id == selected[2]
            and slices[-1].content_start_frame
            + slices[-1].end_frame_exclusive
            - slices[-1].start_frame
            == offset
        ):
            previous = slices.pop()
            slices.append(
                ResolvedSlice(previous.start_frame, b, selected[2], previous.content_start_frame)
            )
        else:
            slices.append(ResolvedSlice(a, b, selected[2], offset))
    return ResolvedRenderPlan(
        plan.output_fps, total, tuple(edits), tuple(slices), plan.music, music_sample_count
    )


def resolve_v3_render_plan(
    plan: V3MergePlan | V4MergePlan,
    video_sources: dict[str, VideoSourceInfo],
    audio_sample_counts: dict[str, int],
    recipe_sample_counts: dict[VideoEditRecipe, int],
) -> ResolvedRenderPlan:
    from .errors import ApiError

    def reject(message, track, owner=None, source=None, code="invalid_range"):
        raise ApiError(422, code, message, track=track, segment_id=owner, source_id=source)

    def recipe_for(v):
        return VideoEditRecipe(
            v.source_id, v.edit.start_frame, v.edit.end_frame, v.edit.speed, plan.output_fps
        )

    edits = []
    occurrences = {v.client_id: v for v in (*plan.clips, *plan.video2)}
    for index, v in enumerate((*plan.clips, *plan.video2)):
        track = "video1" if index < len(plan.clips) else "video2"
        source = video_sources.get(v.source_id)
        if source is None:
            reject("Missing video media.", track, v.client_id, v.source_id, "missing_source")
        if v.edit.start_frame >= source.total_frames:
            reject("Source trim contains no decoded frames.", track, v.client_id, v.source_id)
        corrected = MediaPipeline._clamp_edit(v.edit, source.total_frames, index + 1)
        if corrected != v.edit:
            reject(
                "Source trim changed. Re-trim the clip before rendering.",
                track,
                v.client_id,
                v.source_id,
            )
        length = project_frame_count(
            v.edit.end_frame - v.edit.start_frame + 1, source.fps, v.edit.speed, plan.output_fps
        )
        a = v.output_in_frame if track == "video1" else v.content_in_frame
        b = v.output_out_frame if track == "video1" else v.content_out_frame
        if not 0 <= a < b <= length or (
            track == "video2" and v.content_full_source and (a != 0 or b != length)
        ):
            reject(
                "Normalized source window is unavailable. Re-trim the clip.",
                track,
                v.client_id,
                v.source_id,
            )
        edits.append(ResolvedVideoEdit(v.client_id, v.source_id, track, v.edit, length, source))
    base = []
    total = 0
    for i in plan.order:
        v = occurrences[i]
        if (
            v.timeline_start_frame != total
            or v.duration_frames != v.output_out_frame - v.output_in_frame
        ):
            reject("Video 1 must be contiguous with matching windows.", "video1", i)
        base.append((total, total + v.duration_frames, i, v.output_in_frame))
        total += v.duration_frames
    if total < 1:
        reject("Video 1 must contain at least one frame.", "video1")
    replacements = []
    for v in sorted(plan.video2, key=lambda v: v.timeline_start_frame):
        a, b = (
            v.timeline_start_frame,
            v.timeline_start_frame + v.content_out_frame - v.content_in_frame,
        )
        if b > total:
            reject("Video 2 range is outside Video 1.", "video2", v.client_id)
        if replacements and replacements[-1][1] > a:
            reject("Video 2 clips cannot overlap.", "video2", v.client_id, code="invalid_overlap")
        replacements.append((a, b, v.client_id, v.content_in_frame))

    def check_segments(segments, track):
        previous = 0
        for s in sorted(segments, key=lambda s: s.timeline_start_frame):
            owner = s.id if track == "independent_audio" else s.client_id
            if s.timeline_start_frame < previous:
                reject("Audio segments cannot overlap.", track, owner, code="invalid_overlap")
            previous = s.timeline_start_frame + s.duration_frames
            recipe = s.source if track == "independent_audio" else AudioFileRecipe(s.source_id)
            if isinstance(recipe, VideoEditRecipe):
                source = video_sources.get(recipe.source_id)
                if source is None:
                    reject(
                        "Missing frozen video source.",
                        track,
                        owner,
                        recipe.source_id,
                        "missing_source",
                    )
                if (
                    not 0
                    <= recipe.source_start_frame
                    <= recipe.source_end_frame
                    < source.total_frames
                ):
                    reject(
                        "Frozen audio source trim is unavailable.", track, owner, recipe.source_id
                    )
                count = recipe_sample_counts.get(recipe)
            else:
                count = audio_sample_counts.get(recipe.source_id)
            k = 48000 // plan.output_fps
            if (
                count is None
                or s.source_start_sample >= count
                or s.source_start_sample + s.duration_frames * k - count >= k
            ):
                reject(
                    "Audio range exceeds source EOF. Re-trim the segment.",
                    track,
                    owner,
                    recipe.source_id,
                )

    check_segments(plan.independent_audio, "independent_audio")
    if plan.music:
        check_segments(plan.music.segments, "music")
    boundaries = sorted({0, total, *[n for v in base + replacements for n in v[:2]]})
    picture = []
    for a, b in zip(boundaries, boundaries[1:], strict=False):
        v = next((v for v in replacements if v[0] <= a < v[1]), None)
        if v is None:
            v = next(v for v in base if v[0] <= a < v[1])
        picture.append(ResolvedSlice(a, b, v[2], v[3] + a - v[0]))
    boundaries = sorted(
        {
            *boundaries,
            *[
                min(total, n)
                for s in plan.independent_audio
                for n in (s.timeline_start_frame, s.timeline_start_frame + s.duration_frames)
            ],
        }
    )
    audio = []
    k = 48000 // plan.output_fps
    for a, b in zip(boundaries, boundaries[1:], strict=False):
        independent = next(
            (
                s
                for s in plan.independent_audio
                if s.timeline_start_frame <= a < s.timeline_start_frame + s.duration_frames
            ),
            None,
        )
        if independent:
            audio.append(
                ResolvedAudioSlice(
                    a,
                    b,
                    independent.source,
                    independent.source_start_sample + (a - independent.timeline_start_frame) * k,
                    independent.id,
                )
            )
        else:
            selected = next(s for s in picture if s.start_frame <= a < s.end_frame_exclusive)
            v = occurrences[selected.occurrence_id]
            linked = v.original_audio == "linked"
            audio.append(
                ResolvedAudioSlice(
                    a,
                    b,
                    recipe_for(v) if linked else None,
                    (selected.content_start_frame + a - selected.start_frame) * k if linked else 0,
                    v.client_id if linked else None,
                )
            )
    return ResolvedRenderPlan(
        plan.output_fps,
        total,
        tuple(edits),
        tuple(picture),
        plan.music,
        audio_sample_counts.get(plan.music.source_id)
        if isinstance(plan.music, MusicPlan)
        else None,
        tuple(audio),
        plan.exports,
        {s.source_id: audio_sample_counts[s.source_id] for s in plan.music.segments}
        if plan.music
        else {},
    )


def resolve_v4_render_plan(
    plan: V4MergePlan,
    video_sources: dict[str, VideoSourceInfo],
    audio_sample_counts: dict[str, int],
    recipe_sample_counts: dict[VideoEditRecipe, int],
) -> ResolvedRenderPlan:
    """V4 shares authoritative picture/ownership rules; music is source-indexed."""
    return resolve_v3_render_plan(plan, video_sources, audio_sample_counts, recipe_sample_counts)
