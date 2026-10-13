"""Authoritative video/audio selection in half-open project frames."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .jobs import AdvancedMergePlan, ClipEdit, MusicPlan
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
class ResolvedRenderPlan:
    output_fps: int
    total_frames: int
    video_edits: tuple[ResolvedVideoEdit, ...]
    slices: tuple[ResolvedSlice, ...]
    music: MusicPlan | None
    music_sample_count: int | None


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
