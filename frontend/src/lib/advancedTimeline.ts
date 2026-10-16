import type { ClipEdit, ClipTrim, ClipSpeed, OriginalAudioMode } from './clips';
import type { EditSnapshot } from './editHistory';
import type { ProjectSources } from './projectSources';
import type { OverlayState } from './overlays';
import { validateOverlaySchedule } from './overlays';
import { materializeSnapshot } from './historyProjection';
import { buildTimeline } from './timeline';
import type { TimelineProjection } from './timeline';
import { validateIndependentAudio } from './audioTimeline';

export type Video2Occurrence = {
  originalAudio?: OriginalAudioMode;
  id: string;
  sourceId: string;
  trim: ClipTrim;
  trimSaved: boolean;
  speed: ClipSpeed;
  timelineStartFrame: number;
  contentInFrame: number;
  contentOutFrame: number;
  contentFullSource: boolean;
};
export type MusicOccurrence = {
  id: string;
  sourceId: string;
  timelineStartFrame: number;
  sourceStartSample: number;
  durationFrames: number;
};
export type MaterializedVideo2 = Video2Occurrence & { clip: ClipEdit };
export type MaterializedMusic = MusicOccurrence & {
  file: File;
  url: string;
  sampleCount: number;
};
export type ResolvedInterval = {
  startFrame: number;
  endFrameExclusive: number;
  track: 'video1' | 'video2';
  occurrenceId: string;
  sourceId: string;
  contentStartFrame: number;
};
export type AdvancedTimelineProjection = {
  base: TimelineProjection;
  video2: MaterializedVideo2[];
  music: MaterializedMusic[];
  resolved: ResolvedInterval[];
  displayFrames: number;
  renderErrors: string[];
};
export const placementLength = (v: Video2Occurrence | MusicOccurrence) =>
  'contentInFrame' in v
    ? v.contentOutFrame - v.contentInFrame
    : v.durationFrames;
export function buildAdvancedTimeline(
  s: EditSnapshot,
  sources: ProjectSources,
  overlays: OverlayState,
): AdvancedTimelineProjection {
  const m = materializeSnapshot(s, sources),
    base = buildTimeline(m.clips, s.fpsSelection);
  const errors: string[] = [];
  if (base.fps) {
    const issue = validateIndependentAudio(s, sources, base.fps);
    if (issue) errors.push(issue.message);
  }
  if (base.status !== 'ready') errors.push('Video 1 timing unavailable.');
  const video2 = [...m.video2].sort(
    (a, b) => a.timelineStartFrame - b.timelineStartFrame,
  );
  for (let i = 0; i < video2.length; i++) {
    const v = video2[i],
      end = v.timelineStartFrame + placementLength(v);
    if (end > base.totalFrames)
      errors.push(
        `Video 2 ${v.clip.file.name}: range outside Video 1. Repair or remove this replacement.`,
      );
    if (
      i &&
      video2[i - 1].timelineStartFrame + placementLength(video2[i - 1]) >
        v.timelineStartFrame
    )
      errors.push('Video 2 clips cannot overlap.');
  }
  for (const overlay of [overlays.image, overlays.video])
    if (overlay) {
      const error = validateOverlaySchedule(overlay, base.totalFrames);
      if (error) errors.push(error);
    }
  const points = new Set([0, base.totalFrames]);
  for (const v of base.items) {
    points.add(v.startFrame);
    points.add(v.endFrame + 1);
  }
  for (const v of video2) {
    points.add(v.timelineStartFrame);
    points.add(v.timelineStartFrame + placementLength(v));
  }
  const boundaries = [...points]
      .filter((v) => v >= 0 && v <= base.totalFrames)
      .sort((a, b) => a - b),
    resolved: ResolvedInterval[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i],
      b = boundaries[i + 1];
    const replacement = video2.find(
      (v) =>
        a >= v.timelineStartFrame &&
        a < v.timelineStartFrame + placementLength(v),
    );
    const original = base.items.find(
      (v) => a >= v.startFrame && a <= v.endFrame,
    );
    if (replacement)
      resolved.push({
        startFrame: a,
        endFrameExclusive: b,
        track: 'video2',
        occurrenceId: replacement.id,
        sourceId: replacement.sourceId,
        contentStartFrame:
          replacement.contentInFrame + a - replacement.timelineStartFrame,
      });
    else if (original)
      resolved.push({
        startFrame: a,
        endFrameExclusive: b,
        track: 'video1',
        occurrenceId: original.clip.id,
        sourceId: s.video1.find((v) => v.id === original.clip.id)!.sourceId,
        contentStartFrame:
          (original.clip.outputWindow?.outputInFrame ?? 0) +
          a -
          original.startFrame,
      });
  }
  return {
    base,
    video2,
    music: m.music,
    resolved,
    renderErrors: errors,
    displayFrames: Math.max(
      base.totalFrames,
      ...video2.map((v) => v.timelineStartFrame + placementLength(v)),
      ...m.music.map((v) => v.timelineStartFrame + v.durationFrames),
      ...s.independentAudio.map((v) => v.timelineStartFrame + v.durationFrames),
      ...[overlays.image, overlays.video].map((v) => (v ? v.endFrame + 1 : 0)),
    ),
  };
}
export function resolveProgramFrame(
  p: AdvancedTimelineProjection,
  frame: number,
): { clip: ClipEdit; sourceTime: number; track: 'video1' | 'video2' } | null {
  if (!p.base.fps || frame < 0 || frame >= p.base.totalFrames) return null;
  const r = p.resolved.find(
    (v) => frame >= v.startFrame && frame < v.endFrameExclusive,
  );
  if (!r) return null;
  const clip =
    r.track === 'video2'
      ? p.video2.find((v) => v.id === r.occurrenceId)?.clip
      : p.base.items.find((v) => v.clip.id === r.occurrenceId)?.clip;
  return clip
    ? {
        clip,
        track: r.track,
        sourceTime:
          clip.trim.startFrame / clip.metadata.fps +
          ((r.contentStartFrame + frame - r.startFrame) / p.base.fps) *
            clip.speed,
      }
    : null;
}
