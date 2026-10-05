import type { OverlayState } from './overlays';

export type Limits = {
  max_clips: number;
  max_file_size_mb: number;
  max_audio_file_size_mb?: number;
  max_overlay_image_file_size_mb?: number;
  max_overlay_video_file_size_mb?: number;
};
export type ClipSpeed = 1 | 0.75 | 0.5;
export const SUPPORTED_PROJECT_FPS = [24, 25, 30, 50, 60] as const;
export type ProjectFps = (typeof SUPPORTED_PROJECT_FPS)[number];
export type ProjectFpsSelection = 'auto' | `${ProjectFps}`;
export type ClipMetadata = {
  duration: number;
  fps: number;
  totalFrames: number;
  width: number;
  height: number;
  source: 'browser' | 'backend';
};
export type ClipTrim = { startFrame: number; endFrame: number };
export type Clip = {
  id: string;
  file: File;
  url: string;
  duration?: number;
  metadata?: ClipMetadata;
  metadataStatus?: 'loading' | 'ready' | 'error';
  trim?: ClipTrim;
  trimSaved?: boolean;
  speed?: ClipSpeed;
};
export type ClipEdit = Clip & {
  metadata: ClipMetadata;
  metadataStatus: 'ready';
  trim: ClipTrim;
  trimSaved: boolean;
  speed: ClipSpeed;
};
export type AudioSettings = {
  originalVolume: number;
  originalMuted: boolean;
  musicVolume: number;
  musicMuted: boolean;
};
export type MergeManifest = {
  output_fps: ProjectFps;
  order: string[];
  clips: Array<{
    client_id: string;
    start_frame: number;
    end_frame: number;
    speed: ClipSpeed;
    trim_saved: boolean;
  }>;
  audio: {
    original_volume: number;
    original_muted: boolean;
    music_volume: number;
    music_muted: boolean;
  };
  overlays: {
    image: SerializedOverlay | null;
    video: SerializedOverlay | null;
  };
};

type SerializedOverlay = {
  start_frame: number;
  end_frame: number;
  position: NonNullable<OverlayState['image']>['position'];
  size: NonNullable<OverlayState['image']>['size'];
};

export function resolveProjectFps(
  selection: ProjectFpsSelection,
  firstSourceFps?: number,
): ProjectFps | null {
  if (selection !== 'auto') return Number(selection) as ProjectFps;
  if (
    firstSourceFps === undefined ||
    !Number.isFinite(firstSourceFps) ||
    firstSourceFps <= 0
  )
    return null;
  return SUPPORTED_PROJECT_FPS.reduce((nearest, candidate) =>
    Math.abs(candidate - firstSourceFps) < Math.abs(nearest - firstSourceFps)
      ? candidate
      : nearest,
  );
}
export function validateSelection(
  files: File[],
  count: number,
  limits: Limits,
): string | null {
  if (count + files.length > limits.max_clips)
    return `You can merge up to ${limits.max_clips} clips at a time. Remove a clip and try again.`;
  for (const file of files) {
    if (!/\.(mp4|mov|webm|mkv)$/i.test(file.name))
      return 'Choose MP4, MOV, WebM, or MKV video files.';
    if (file.size === 0)
      return `“${file.name}” is empty. Choose a video with content.`;
    if (file.size > limits.max_file_size_mb * 1024 * 1024)
      return `“${file.name}” exceeds the ${limits.max_file_size_mb} MB file size limit.`;
  }
  return null;
}
export function moveClip<T>(clips: T[], from: number, to: number): T[] {
  if (
    from < 0 ||
    from >= clips.length ||
    to < 0 ||
    to >= clips.length ||
    from === to
  )
    return clips;
  const result = [...clips];
  const [clip] = result.splice(from, 1);
  result.splice(to, 0, clip);
  return result;
}
export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return 'Duration unavailable';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const milliseconds = Math.round(safe * 1000);
  const minutes = Math.floor(milliseconds / 60000);
  const remaining = milliseconds - minutes * 60000;
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(remaining / 1000)).padStart(2, '0')}.${String(remaining % 1000).padStart(3, '0')}`;
}

export function frameToSeconds(frame: number, fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? frame / fps : 0;
}

export function estimateFrameRate(mediaTimes: number[]): number | null {
  const deltas = mediaTimes
    .slice(1)
    .map((time, index) => time - mediaTimes[index])
    .filter((delta) => Number.isFinite(delta) && delta > 0)
    .sort((left, right) => left - right);
  if (!deltas.length) return null;
  const middle = Math.floor(deltas.length / 2);
  const frameDuration =
    deltas.length % 2
      ? deltas[middle]
      : (deltas[middle - 1] + deltas[middle]) / 2;
  const fps = 1 / frameDuration;
  return Number.isFinite(fps) && fps >= 1 && fps <= 240 ? fps : null;
}

export function frameCountFromDuration(duration: number, fps: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(1, Math.round(duration * fps));
}

export function selectedFrameCount(trim: ClipTrim): number {
  return trim.endFrame - trim.startFrame + 1;
}

export function selectedSourceDuration(trim: ClipTrim, fps: number): number {
  return selectedFrameCount(trim) / fps;
}

export function outputDuration(
  trim: ClipTrim,
  fps: number,
  speed: ClipSpeed,
): number {
  return selectedSourceDuration(trim, fps) / speed;
}

export function validateTrim(
  trim: ClipTrim,
  totalFrames: number,
): string | null {
  if (!Number.isInteger(trim.startFrame) || !Number.isInteger(trim.endFrame))
    return 'Frame values must be whole numbers.';
  if (trim.startFrame < 0 || trim.startFrame > trim.endFrame)
    return 'The start frame must be before or equal to the end frame.';
  if (
    !Number.isInteger(totalFrames) ||
    totalFrames < 1 ||
    trim.endFrame >= totalFrames
  )
    return 'The selected frame range is outside this clip.';
  return null;
}

export function isEditableClip(clip: Clip): clip is ClipEdit {
  return Boolean(
    clip.metadataStatus === 'ready' &&
    clip.metadata &&
    clip.trim &&
    typeof clip.trimSaved === 'boolean' &&
    clip.speed &&
    validateTrim(clip.trim, clip.metadata.totalFrames) === null,
  );
}

export function buildMergeManifest(
  clips: ClipEdit[],
  audio: AudioSettings,
  outputFps: ProjectFps,
  overlays: OverlayState = { image: null, video: null },
  order = clips.map((clip) => clip.id),
): MergeManifest {
  const serializeOverlay = (
    overlay: OverlayState['image'] | OverlayState['video'],
  ): SerializedOverlay | null =>
    overlay
      ? {
          start_frame: overlay.startFrame,
          end_frame: overlay.endFrame,
          position: overlay.position,
          size: overlay.size,
        }
      : null;
  return {
    output_fps: outputFps,
    order,
    clips: clips.map((clip) => ({
      client_id: clip.id,
      start_frame: clip.trim.startFrame,
      end_frame: clip.trim.endFrame,
      speed: clip.speed,
      trim_saved: clip.trimSaved,
    })),
    audio: {
      original_volume: audio.originalVolume,
      original_muted: audio.originalMuted,
      music_volume: audio.musicVolume,
      music_muted: audio.musicMuted,
    },
    overlays: {
      image: serializeOverlay(overlays.image),
      video: serializeOverlay(overlays.video),
    },
  };
}
