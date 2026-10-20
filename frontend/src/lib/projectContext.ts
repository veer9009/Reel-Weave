import type { ExportFormat } from './api';
import type { ProjectFps } from './clips';
import type { EditSnapshot } from './editHistory';
import type { ImageOverlay } from './overlays';
import type {
  CapturedSource,
  PortableImageOverlayV1,
  ProjectResult,
} from './projectFileTypes';
import type { ProjectSources, SourceToken } from './projectSources';
export type ProjectContext = {
  incarnationId: string;
  imageOverlay: PortableImageOverlayV1 | null;
  exportFormats: readonly ExportFormat[];
  timingFps: ProjectFps | null;
};
export type ProjectEnvelope = EditSnapshot & { projectContext: ProjectContext };
export type ProjectCapture = {
  envelope: ProjectEnvelope;
  sources: ReadonlyMap<string, CapturedSource>;
  capturedAt: Date;
};
export type PreparedProject = {
  envelope: ProjectEnvelope;
  sources: ProjectSources;
  dispose(): void;
};
export type ProjectOpenLock = {
  replace(prepared: PreparedProject): ProjectResult<void>;
  release(): void;
};
export type ProjectContextRestore = {
  context: ProjectContext;
  image: ImageOverlay | null;
  imageToken: SourceToken | null;
};
export function createProjectContext(): ProjectContext {
  return {
    incarnationId: crypto.randomUUID(),
    imageOverlay: null,
    exportFormats: ['mp4'],
    timingFps: null,
  };
}
export function cloneProjectContext(value: ProjectContext): ProjectContext {
  return {
    ...value,
    exportFormats: [...value.exportFormats],
    imageOverlay: value.imageOverlay ? { ...value.imageOverlay } : null,
  };
}
export function collectSnapshotSources(
  snapshot: EditSnapshot,
): ReadonlySet<string> {
  return new Set([
    ...snapshot.binSourceIds,
    ...snapshot.video1.map((v) => v.sourceId),
    ...snapshot.video2.map((v) => v.sourceId),
    ...snapshot.music.map((v) => v.sourceId),
    ...snapshot.independentAudio.map((v) => v.source.sourceId),
    ...(snapshot.musicSourceId ? [snapshot.musicSourceId] : []),
    ...(snapshot.pip ? [snapshot.pip.sourceId] : []),
    ...(snapshot.projectContext?.imageOverlay
      ? [snapshot.projectContext.imageOverlay.sourceId]
      : []),
  ]);
}
