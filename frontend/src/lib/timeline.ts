import { isEditableClip, resolveProjectFps } from './clips';
import type {
  Clip,
  ClipEdit,
  ClipTrim,
  ProjectFps,
  ProjectFpsSelection,
} from './clips';
import { projectFrameCount } from './overlays';
import type { OverlayKind } from './overlays';

export type TimelineSelection =
  | { kind: 'none' }
  | { kind: 'clip'; id: string }
  | { kind: 'overlay'; overlayKind: OverlayKind }
  | { kind: 'audio'; track: 'original' | 'music' };
export type TimelineItem = {
  clip: ClipEdit;
  startFrame: number;
  endFrame: number;
  frameCount: number;
};
export type TimelineProjection = {
  status: 'empty' | 'unavailable' | 'ready';
  fps: ProjectFps | null;
  items: TimelineItem[];
  totalFrames: number;
  durationSeconds: number;
};

export function planClipSplit(
  timeline: TimelineProjection,
  targetId: string,
  frame: number,
): { leftTrim: ClipTrim; rightTrim: ClipTrim } | { error: string } {
  const item = timeline.items.find(({ clip }) => clip.id === targetId);
  if (item && item.clip.trim.startFrame === item.clip.trim.endFrame)
    return { error: 'Cannot split a one-frame clip. Choose a longer range.' };
  if (
    timeline.status !== 'ready' ||
    !timeline.fps ||
    !item ||
    !Number.isInteger(frame) ||
    frame <= item.startFrame ||
    frame >= item.endFrame
  )
    return {
      error:
        'Select a ready Video 1 clip and move the playhead strictly inside it.',
    };
  const target = item.clip;
  const cutFrame =
    target.trim.startFrame +
    Math.floor(
      ((frame - item.startFrame) / timeline.fps) *
        target.speed *
        target.metadata.fps +
        1e-9,
    );
  if (
    !Number.isFinite(cutFrame) ||
    cutFrame < target.trim.startFrame ||
    cutFrame >= target.trim.endFrame
  )
    return {
      error:
        'Move the playhead earlier so at least one source frame remains after the split.',
    };
  return {
    leftTrim: { startFrame: target.trim.startFrame, endFrame: cutFrame },
    rightTrim: { startFrame: cutFrame + 1, endFrame: target.trim.endFrame },
  };
}

export function planVersionReplacement(
  timeline: TimelineProjection,
  targetId: string,
  version2: Clip,
  frame: number,
): { leftTrim: ClipTrim; rightTrim: ClipTrim } | { error: string } {
  const item = timeline.items.find(({ clip }) => clip.id === targetId);
  if (version2.id === targetId)
    return {
      error:
        'Version 2 must be a different timeline occurrence from the target clip.',
    };
  if (
    timeline.status !== 'ready' ||
    !timeline.fps ||
    !item ||
    !Number.isInteger(frame) ||
    frame <= item.startFrame ||
    frame >= item.endFrame
  )
    return {
      error: 'Select a Video 1 clip and move the playhead strictly inside it.',
    };
  if (
    !isEditableClip(version2) ||
    !Number.isFinite(version2.metadata.fps) ||
    version2.metadata.fps <= 0 ||
    !Number.isFinite(item.clip.metadata.fps) ||
    item.clip.metadata.fps <= 0
  )
    return { error: 'Choose another ready Video 1 source as Version 2.' };
  const target = item.clip;
  const sourceFps = target.metadata.fps;
  const cutFrame =
    target.trim.startFrame +
    Math.floor(
      ((frame - item.startFrame) / timeline.fps) * target.speed * sourceFps +
        1e-9,
    );
  if (cutFrame >= target.trim.endFrame)
    return {
      error:
        'Move the playhead earlier so at least one source frame remains after the cut.',
    };
  const startTime = (cutFrame + 1) / sourceFps;
  const endTime = (target.trim.endFrame + 1) / sourceFps;
  const replacementFps = version2.metadata.fps;
  if (
    version2.metadata.totalFrames < Math.ceil(endTime * replacementFps - 1e-9)
  )
    return {
      error:
        'Version 2 is too short to cover the matching source range. Choose a longer source.',
    };
  const rightTrim = {
    startFrame: Math.round(startTime * replacementFps),
    endFrame: Math.round(endTime * replacementFps) - 1,
  };
  if (rightTrim.startFrame > rightTrim.endFrame)
    return {
      error:
        'The remaining range is shorter than one Version 2 frame. Move the playhead earlier.',
    };
  return {
    leftTrim: { startFrame: target.trim.startFrame, endFrame: cutFrame },
    rightTrim,
  };
}

export function buildTimeline(
  clips: Clip[],
  fpsSelection: ProjectFpsSelection,
): TimelineProjection {
  const fps = resolveProjectFps(fpsSelection, clips[0]?.metadata?.fps);
  const empty: TimelineProjection = {
    status: clips.length ? 'unavailable' : 'empty',
    fps,
    items: [],
    totalFrames: 0,
    durationSeconds: 0,
  };
  if (!clips.length || fps === null || !clips.every(isEditableClip))
    return empty;
  let totalFrames = 0;
  const items = clips.map((clip) => {
    const frameCount = projectFrameCount(
      clip.trim.endFrame - clip.trim.startFrame + 1,
      clip.metadata.fps,
      clip.speed,
      fps,
    );
    const startFrame = totalFrames;
    totalFrames += frameCount;
    return { clip, frameCount, startFrame, endFrame: totalFrames - 1 };
  });
  return {
    status: 'ready',
    fps,
    items,
    totalFrames,
    durationSeconds: totalFrames / fps,
  };
}
