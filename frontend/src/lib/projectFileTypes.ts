import type {
  AudioSettings,
  ClipSpeed,
  ClipTrim,
  OriginalAudioMode,
  OutputWindow,
  ProjectFps,
  ProjectFpsSelection,
} from './clips';
import type { OverlaySchedule } from './overlays';
import type { SourceRecord } from './projectSources';

export type ProjectIssueCode =
  | 'not-project'
  | 'read'
  | 'corrupt'
  | 'unsupported-version'
  | 'limit'
  | 'invalid'
  | 'media'
  | 'cancelled'
  | 'resource';
export type ProjectIssue = {
  code: ProjectIssueCode;
  message: string;
  path?: string;
};
export type ProjectResult<T> =
  { ok: true; value: T } | { ok: false; issue: ProjectIssue };
export type PortableClipMetadata = {
  duration: number;
  fps: number;
  totalFrames: number;
  width: number;
  height: number;
  origin: 'browser' | 'backend';
};
type SourceIdentity = {
  id: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  lastModifiedMs: number | null;
  sha256: string;
};
export type ProjectSourceV1 = SourceIdentity &
  (
    | {
        mediaType: 'video';
        metadata: {
          durationSeconds: number;
          clipMetadata?: PortableClipMetadata;
          width?: number;
          height?: number;
        };
      }
    | {
        mediaType: 'audio';
        metadata: { durationSeconds: number; sampleCount: number };
      }
    | { mediaType: 'image'; metadata: { width: number; height: number } }
  );
export type PortableVideo1 = {
  id: string;
  sourceId: string;
  trim: ClipTrim;
  trimSaved: boolean;
  speed: ClipSpeed;
  originalAudio: OriginalAudioMode;
  outputWindow?: OutputWindow;
};
export type PortableVideo2 = {
  id: string;
  sourceId: string;
  trim: ClipTrim;
  trimSaved: boolean;
  speed: ClipSpeed;
  originalAudio: OriginalAudioMode;
  timelineStartFrame: number;
  contentInFrame: number;
  contentOutFrame: number;
  contentFullSource: boolean;
};
export type PortableMusic = {
  id: string;
  sourceId: string;
  timelineStartFrame: number;
  sourceStartSample: number;
  durationFrames: number;
};
export type PortableAudioRecipe =
  | { kind: 'audio-file'; sourceId: string }
  | {
      kind: 'video-edit';
      sourceId: string;
      sourceStartFrame: number;
      sourceEndFrame: number;
      speed: ClipSpeed;
      normalizationFps: ProjectFps;
    };
export type PortableIndependentAudio = {
  id: string;
  timelineStartFrame: number;
  durationFrames: number;
  sourceStartSample: number;
  source: PortableAudioRecipe;
  detachedFrom?: { track: 'video1' | 'video2'; clipId: string };
};
export type PortableImageOverlayV1 = OverlaySchedule & {
  id: string;
  sourceId: string;
};
export type PortableEditV1 = {
  binSourceIds: string[];
  video1: PortableVideo1[];
  video2: PortableVideo2[];
  musicSourceId: string | null;
  music: PortableMusic[];
  independentAudio: PortableIndependentAudio[];
  pip: (OverlaySchedule & { id: string; sourceId: string }) | null;
  audio: AudioSettings;
  fpsSelection: ProjectFpsSelection;
};
export type ProjectDocumentV1 = {
  format: 'avstudio-project';
  schemaVersion: 1;
  sources: ProjectSourceV1[];
  edit: PortableEditV1;
  imageOverlay: PortableImageOverlayV1 | null;
  exportSettings: { formats: ('mp4' | 'mov' | 'wav' | 'mp3')[] };
  timingFps: ProjectFps | null;
};
export type PortableEditV2 = Omit<PortableEditV1, 'musicSourceId'>;
export type ProjectDocumentV2 = Omit<
  ProjectDocumentV1,
  'schemaVersion' | 'edit'
> & { schemaVersion: 2; edit: PortableEditV2 };
export type ProjectDocument = ProjectDocumentV1 | ProjectDocumentV2;
export type CapturedSource = Readonly<
  Pick<
    SourceRecord,
    | 'kind'
    | 'mediaType'
    | 'file'
    | 'status'
    | 'metadata'
    | 'duration'
    | 'sampleCount'
  >
>;
export function projectFailure<T>(
  code: ProjectIssueCode,
  message: string,
  path?: string,
): ProjectResult<T> {
  return { ok: false, issue: { code, message, ...(path ? { path } : {}) } };
}
