import type { ClipEdit, ClipSpeed, ProjectFps } from './clips';

export type OverlayKind = 'image' | 'video';
export type OverlayPosition =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'centre';
export type OverlaySize = 'small' | 'medium' | 'large';

export type OverlaySchedule = {
  startFrame: number;
  endFrame: number;
  position: OverlayPosition;
  size: OverlaySize;
};

type OverlaySource = OverlaySchedule & {
  file: File;
  url: string;
  metadataStatus: 'loading' | 'ready' | 'error';
};

export type ImageOverlay = OverlaySource & { kind: 'image' };
export type VideoOverlay = OverlaySource & {
  kind: 'video';
  duration?: number;
};
export type OverlayState = {
  image: ImageOverlay | null;
  video: VideoOverlay | null;
};

export const EMPTY_OVERLAYS: OverlayState = { image: null, video: null };

export function projectFrameCount(
  selectedSourceFrames: number,
  sourceFps: number,
  speed: ClipSpeed,
  outputFps: number,
): number {
  if (
    !Number.isInteger(selectedSourceFrames) ||
    selectedSourceFrames < 1 ||
    !Number.isFinite(sourceFps) ||
    sourceFps <= 0 ||
    !Number.isFinite(speed) ||
    speed <= 0
  )
    return 0;
  return Math.max(
    1,
    Math.floor((selectedSourceFrames / sourceFps / speed) * outputFps + 0.5),
  );
}

export function projectTotalFrames(
  clips: ClipEdit[],
  outputFps: ProjectFps,
): number {
  return clips.reduce(
    (total, clip) =>
      total +
      projectFrameCount(
        clip.trim.endFrame - clip.trim.startFrame + 1,
        clip.metadata.fps,
        clip.speed,
        outputFps,
      ),
    0,
  );
}

export function validateOverlaySchedule(
  schedule: OverlaySchedule,
  totalFrames: number,
): string | null {
  if (
    !Number.isInteger(schedule.startFrame) ||
    !Number.isInteger(schedule.endFrame)
  )
    return 'Overlay frame values must be whole numbers.';
  if (schedule.startFrame < 0 || schedule.startFrame > schedule.endFrame)
    return 'The overlay start frame must be before or equal to its end frame.';
  if (
    !Number.isInteger(totalFrames) ||
    totalFrames < 1 ||
    schedule.endFrame >= totalFrames
  )
    return 'The overlay frame range is outside the project timeline.';
  return null;
}

export function defaultOverlaySchedule(
  kind: OverlayKind,
  totalFrames: number,
): OverlaySchedule {
  if (!Number.isInteger(totalFrames) || totalFrames < 1)
    throw new Error('A project timeline is required before adding an overlay.');
  return {
    startFrame: 0,
    endFrame: totalFrames - 1,
    position: kind === 'image' ? 'top-right' : 'bottom-right',
    size: kind === 'image' ? 'small' : 'medium',
  };
}
