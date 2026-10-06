import { isEditableClip, resolveProjectFps } from './clips';
import type { Clip, ClipEdit, ProjectFps, ProjectFpsSelection } from './clips';
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
