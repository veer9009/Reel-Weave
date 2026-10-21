import type { Limits } from './clips';
import type { ProjectCapture, PreparedProject } from './projectContext';
import { collectSnapshotSources } from './projectContext';
import type { CandidateEvidence, ProjectMediaVerifier } from './projectMedia';
import { checkRelinkCandidate } from './projectMedia';
import type {
  PortableAudioRecipe,
  PortableEditV2,
  ProjectDocument,
  ProjectResult,
  ProjectSourceV1,
} from './projectFileTypes';
import { projectFailure } from './projectFileTypes';
import {
  validateProjectDocument,
  migrateProjectDocumentV1,
} from './projectFileJson';
import { createProjectSources } from './projectSources';
import type { SourceKind, SourceMetadata } from './projectSources';
import { materializeSnapshot, validateRestoration } from './historyProjection';
import { validatePositioned } from './positionedEdits';

export type AcceptedRelink = {
  sourceId: string;
  evidence: CandidateEvidence;
  renamedConfirmed: boolean;
};
export function projectSourceRoles(
  document: ProjectDocument,
): ReadonlyMap<string, ReadonlySet<SourceKind>> {
  const roles = new Map<string, Set<SourceKind>>(
    document.sources.map((s) => [s.id, new Set()]),
  );
  const add = (id: string, kind: SourceKind) => roles.get(id)?.add(kind);
  for (const id of document.edit.binSourceIds)
    add(
      id,
      document.sources.find((s) => s.id === id)?.mediaType === 'audio'
        ? 'audio'
        : 'video',
    );
  document.edit.video1.forEach((v) => add(v.sourceId, 'video1'));
  document.edit.video2.forEach((v) => add(v.sourceId, 'video2'));
  document.edit.music.forEach((v) => add(v.sourceId, 'music'));
  document.edit.independentAudio.forEach((v) =>
    add(v.source.sourceId, v.source.kind === 'audio-file' ? 'audio' : 'video'),
  );
  if (document.edit.pip) add(document.edit.pip.sourceId, 'pip');
  if (document.imageOverlay) add(document.imageOverlay.sourceId, 'image');
  return roles;
}
function portableRecipe(r: PortableAudioRecipe): PortableAudioRecipe {
  return r.kind === 'audio-file'
    ? { kind: r.kind, sourceId: r.sourceId }
    : {
        kind: r.kind,
        sourceId: r.sourceId,
        sourceStartFrame: r.sourceStartFrame,
        sourceEndFrame: r.sourceEndFrame,
        speed: r.speed,
        normalizationFps: r.normalizationFps,
      };
}
export async function serializeProjectCapture(
  capture: ProjectCapture,
  verifier: ProjectMediaVerifier,
  limits: Limits,
  signal: AbortSignal,
): Promise<ProjectResult<ProjectDocument>> {
  try {
    const s = capture.envelope;
    const context = s.projectContext;
    const sources: ProjectSourceV1[] = [];
    for (const id of collectSnapshotSources(s)) {
      if (signal.aborted) return projectFailure('cancelled', 'Save cancelled.');
      const r = capture.sources.get(id);
      if (!r || r.status !== 'ready')
        return projectFailure('media', 'All saved sources must be ready.');
      const fingerprint = await verifier.fingerprint(r.file, signal);
      if (!fingerprint.ok) return fingerprint;
      const common = {
        id,
        originalName: r.file.name,
        sizeBytes: r.file.size,
        mimeType: r.file.type,
        lastModifiedMs:
          Number.isSafeInteger(r.file.lastModified) && r.file.lastModified >= 0
            ? r.file.lastModified
            : null,
        sha256: fingerprint.value,
      };
      if (r.mediaType === 'image') {
        const probe = await verifier.inspect(r.file, 'image', signal);
        if (!probe.ok) return probe;
        if (probe.value.mediaType !== 'image')
          return projectFailure('media', 'Could not read image dimensions.');
        sources.push({
          ...common,
          mediaType: 'image',
          metadata: { width: probe.value.width, height: probe.value.height },
        });
      } else if (r.mediaType === 'audio') {
        if (!r.duration || !r.sampleCount)
          return projectFailure('media', 'Audio source timing is unavailable.');
        sources.push({
          ...common,
          mediaType: 'audio',
          metadata: { durationSeconds: r.duration, sampleCount: r.sampleCount },
        });
      } else {
        const m = r.metadata;
        const durationSeconds = m?.duration ?? r.duration;
        if (!durationSeconds)
          return projectFailure('media', 'Video source timing is unavailable.');
        sources.push({
          ...common,
          mediaType: 'video',
          metadata: {
            durationSeconds,
            ...(m
              ? {
                  width: m.width,
                  height: m.height,
                  clipMetadata: {
                    duration: m.duration,
                    fps: m.fps,
                    totalFrames: m.totalFrames,
                    width: m.width,
                    height: m.height,
                    origin: m.source,
                  },
                }
              : {}),
          },
        });
      }
    }
    const edit: PortableEditV2 = {
      binSourceIds: [...s.binSourceIds],
      video1: s.video1.map((v) => {
        if (!v.trim) throw new Error('Missing trim.');
        return {
          id: v.id,
          sourceId: v.sourceId,
          trim: { startFrame: v.trim.startFrame, endFrame: v.trim.endFrame },
          trimSaved: v.trimSaved,
          speed: v.speed,
          originalAudio: v.originalAudio ?? 'linked',
          ...(v.outputWindow
            ? {
                outputWindow: {
                  outputInFrame: v.outputWindow.outputInFrame,
                  outputOutFrame: v.outputWindow.outputOutFrame,
                },
              }
            : {}),
        };
      }),
      video2: s.video2.map((v) => ({
        id: v.id,
        sourceId: v.sourceId,
        trim: { startFrame: v.trim.startFrame, endFrame: v.trim.endFrame },
        trimSaved: v.trimSaved,
        speed: v.speed,
        originalAudio: v.originalAudio ?? 'linked',
        timelineStartFrame: v.timelineStartFrame,
        contentInFrame: v.contentInFrame,
        contentOutFrame: v.contentOutFrame,
        contentFullSource: v.contentFullSource,
      })),
      music: s.music.map((v) => ({
        id: v.id,
        sourceId: v.sourceId,
        timelineStartFrame: v.timelineStartFrame,
        sourceStartSample: v.sourceStartSample,
        durationFrames: v.durationFrames,
      })),
      independentAudio: s.independentAudio.map((v) => ({
        id: v.id,
        timelineStartFrame: v.timelineStartFrame,
        durationFrames: v.durationFrames,
        sourceStartSample: v.sourceStartSample,
        source: portableRecipe(v.source),
        ...(v.detachedFrom
          ? {
              detachedFrom: {
                track: v.detachedFrom.track,
                clipId: v.detachedFrom.clipId,
              },
            }
          : {}),
      })),
      pip: s.pip
        ? {
            id: s.pip.id,
            sourceId: s.pip.sourceId,
            startFrame: s.pip.startFrame,
            endFrame: s.pip.endFrame,
            position: s.pip.position,
            size: s.pip.size,
          }
        : null,
      audio: {
        originalVolume: s.audio.originalVolume,
        originalMuted: s.audio.originalMuted,
        musicVolume: s.audio.musicVolume,
        musicMuted: s.audio.musicMuted,
      },
      fpsSelection: s.fpsSelection,
    };
    const image = context.imageOverlay;
    const document: ProjectDocument = {
      format: 'avstudio-project',
      schemaVersion: 2,
      sources,
      edit,
      imageOverlay: image
        ? {
            id: image.id,
            sourceId: image.sourceId,
            startFrame: image.startFrame,
            endFrame: image.endFrame,
            position: image.position,
            size: image.size,
          }
        : null,
      exportSettings: { formats: [...context.exportFormats] },
      timingFps: context.timingFps,
    };
    return signal.aborted
      ? projectFailure('cancelled', 'Save cancelled.')
      : validateProjectDocument(document, limits);
  } catch {
    return projectFailure(
      'media',
      'Could not capture project metadata. Finish or cancel pending edits and retry.',
    );
  }
}
export function prepareRelinkedProject(
  document: ProjectDocument,
  matches: ReadonlyMap<string, AcceptedRelink>,
  limits: Limits,
  newId: () => string,
): ProjectResult<PreparedProject> {
  const checked = validateProjectDocument(document, limits);
  if (!checked.ok) return checked;
  document =
    checked.value.schemaVersion === 1
      ? migrateProjectDocumentV1(checked.value)
      : checked.value;
  const sources = createProjectSources();
  try {
    const roles = projectSourceRoles(document);
    const sourceIds = new Map(document.sources.map((s) => [s.id, newId()]));
    const occurrenceIds = new Map<string, string>();
    for (const occurrence of [
      ...document.edit.video1,
      ...document.edit.video2,
      ...document.edit.music,
      ...document.edit.independentAudio,
      ...(document.edit.pip ? [document.edit.pip] : []),
      ...(document.imageOverlay ? [document.imageOverlay] : []),
    ])
      occurrenceIds.set(occurrence.id, newId());
    const provenance = new Map<string, string>();
    const src = (id: string) => {
      const value = sourceIds.get(id);
      if (!value) throw new Error('Missing source identity.');
      return value;
    };
    const occ = (id: string) => {
      const value = occurrenceIds.get(id);
      if (!value) throw new Error('Missing occurrence identity.');
      return value;
    };
    for (const source of document.sources) {
      const match = matches.get(source.id);
      if (!match || match.sourceId !== source.id)
        throw new Error('Missing media.');
      const role = roles.get(source.id) ?? new Set<SourceKind>();
      const valid = checkRelinkCandidate(source, match.evidence, limits, role);
      if (!valid.ok) {
        sources.clear();
        return valid;
      }
      if (valid.value.renamed && !match.renamedConfirmed)
        throw new Error('Confirm renamed media.');
      let metadata: SourceMetadata = {};
      if (source.mediaType === 'audio')
        metadata = {
          duration: source.metadata.durationSeconds,
          sampleCount: source.metadata.sampleCount,
        };
      else if (source.mediaType === 'video') {
        const m = source.metadata.clipMetadata;
        metadata = {
          duration: source.metadata.durationSeconds,
          ...(m
            ? {
                clipMetadata: {
                  duration: m.duration,
                  fps: m.fps,
                  totalFrames: m.totalFrames,
                  width: m.width,
                  height: m.height,
                  source: m.origin,
                },
              }
            : {}),
        };
      }
      const kind: SourceKind =
        source.mediaType === 'image'
          ? 'image'
          : source.mediaType === 'audio'
            ? role.has('music')
              ? 'music'
              : 'audio'
            : role.has('pip')
              ? 'pip'
              : 'video';
      sources.registerReady({
        id: src(source.id),
        file: match.evidence.file,
        mediaType: source.mediaType,
        kind,
        metadata,
      });
    }
    const e = document.edit;
    const envelope = {
      ...e,
      binSourceIds: e.binSourceIds.map(src),
      video1: e.video1.map((v) => ({
        ...v,
        id: occ(v.id),
        sourceId: src(v.sourceId),
        trim: { ...v.trim },
        ...(v.outputWindow ? { outputWindow: { ...v.outputWindow } } : {}),
      })),
      video2: e.video2.map((v) => ({
        ...v,
        id: occ(v.id),
        sourceId: src(v.sourceId),
        trim: { ...v.trim },
      })),
      music: e.music.map((v) => ({
        ...v,
        id: occ(v.id),
        sourceId: src(v.sourceId),
      })),
      independentAudio: e.independentAudio.map((v) => {
        let detachedFrom;
        if (v.detachedFrom) {
          const key = `${v.detachedFrom.track}:${v.detachedFrom.clipId}`;
          let clipId =
            occurrenceIds.get(v.detachedFrom.clipId) ?? provenance.get(key);
          if (!clipId) {
            clipId = newId();
            provenance.set(key, clipId);
          }
          detachedFrom = { track: v.detachedFrom.track, clipId };
        }
        return {
          ...v,
          id: occ(v.id),
          source: { ...v.source, sourceId: src(v.source.sourceId) },
          ...(detachedFrom ? { detachedFrom } : {}),
        };
      }),
      pip: e.pip
        ? { ...e.pip, id: occ(e.pip.id), sourceId: src(e.pip.sourceId) }
        : null,
      audio: { ...e.audio },
      projectContext: {
        incarnationId: newId(),
        imageOverlay: document.imageOverlay
          ? {
              ...document.imageOverlay,
              id: occ(document.imageOverlay.id),
              sourceId: src(document.imageOverlay.sourceId),
            }
          : null,
        exportFormats: [...document.exportSettings.formats],
        timingFps: document.timingFps,
      },
    };
    const issue =
      validateRestoration(envelope, sources, limits) ??
      validatePositioned(envelope, sources, document.timingFps ?? undefined);
    if (issue) throw new Error(issue);
    materializeSnapshot(envelope, sources);
    if (envelope.projectContext.imageOverlay)
      sources.ensureUrl(envelope.projectContext.imageOverlay.sourceId);
    sources.reconcileUrls(collectSnapshotSources(envelope));
    return {
      ok: true,
      value: { envelope, sources, dispose: () => sources.clear() },
    };
  } catch {
    sources.clear();
    return projectFailure(
      'invalid',
      'Could not prepare project: missing, unconfirmed, or incompatible media.',
    );
  }
}
export function createProjectDownload() {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  const revoke = (url: string) => {
    if (!pending.has(url)) return;
    clearTimeout(pending.get(url));
    pending.delete(url);
    URL.revokeObjectURL(url);
  };
  return {
    request(text: string, capturedAt: Date): ProjectResult<void> {
      if (disposed) return projectFailure('cancelled', 'Download cancelled.');
      let url: string | undefined;
      let anchor: HTMLAnchorElement | undefined;
      try {
        const pad = (n: number) => String(n).padStart(2, '0');
        const name = `${capturedAt.getFullYear()}-${pad(capturedAt.getMonth() + 1)}-${pad(capturedAt.getDate())}-${pad(capturedAt.getHours())}${pad(capturedAt.getMinutes())}${pad(capturedAt.getSeconds())}`;
        url = URL.createObjectURL(
          new Blob([text], { type: 'application/json' }),
        );
        anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `AVStudio-project-${name}.avstudio.json`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        const ownedUrl = url;
        pending.set(
          url,
          setTimeout(() => revoke(ownedUrl), 0),
        );
        return { ok: true, value: undefined };
      } catch {
        anchor?.remove();
        if (url) URL.revokeObjectURL(url);
        return projectFailure(
          'resource',
          'Could not request the project download. Retry.',
        );
      }
    },
    dispose() {
      disposed = true;
      for (const url of [...pending.keys()]) revoke(url);
    },
  };
}
