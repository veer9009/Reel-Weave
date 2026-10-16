import type { Clip, Limits } from './clips';
import type { EditSnapshot } from './editHistory';
import type { ProjectSources } from './projectSources';
import type { OverlayState } from './overlays';
import type { MaterializedVideo2, MaterializedMusic } from './advancedTimeline';
import { validatePositioned } from './positionedEdits';
import { resolveProjectFps } from './clips';
import { projectFrameCount } from './overlays';
export function materializeSnapshot(
  s: Pick<EditSnapshot, 'video1' | 'pip'> &
    Partial<Pick<EditSnapshot, 'video2' | 'music'>>,
  sources: ProjectSources,
): {
  clips: Clip[];
  pip: OverlayState['video'];
  video2: MaterializedVideo2[];
  music: MaterializedMusic[];
} {
  return {
    video2: (s.video2 ?? []).map((v) => {
      const r = sources.get(v.sourceId);
      if (!r || !r.metadata || r.status !== 'ready')
        throw new Error('Missing or unready replacement source.');
      return {
        ...v,
        clip: {
          id: v.id,
          file: r.file,
          url: sources.ensureUrl(v.sourceId),
          metadata: r.metadata,
          metadataStatus: 'ready',
          trim: v.trim,
          trimSaved: v.trimSaved,
          speed: v.speed,
          originalAudio: v.originalAudio ?? 'linked',
        },
      };
    }),
    music: (s.music ?? []).map((v) => {
      const r = sources.get(v.sourceId);
      if (!r || !r.sampleCount)
        throw new Error('Missing or unready music source.');
      return {
        ...v,
        file: r.file,
        url: sources.ensureUrl(v.sourceId),
        sampleCount: r.sampleCount,
      };
    }),
    clips: s.video1.map((v) => {
      const r = sources.get(v.sourceId);
      if (!r) throw new Error('Missing project source.');
      return {
        id: v.id,
        file: r.file,
        url: sources.ensureUrl(v.sourceId),
        metadataStatus: r.status,
        metadata: r.metadata,
        duration: r.duration,
        trim: v.trim ?? undefined,
        trimSaved: v.trimSaved,
        speed: v.speed,
        originalAudio: v.originalAudio ?? 'linked',
        outputWindow: v.outputWindow,
      };
    }),
    pip: s.pip
      ? (() => {
          const r = sources.get(s.pip.sourceId);
          if (!r) throw new Error('Missing PIP source.');
          return {
            kind: 'video',
            file: r.file,
            url: sources.ensureUrl(s.pip.sourceId),
            metadataStatus: r.status,
            duration: r.duration,
            startFrame: s.pip.startFrame,
            endFrame: s.pip.endFrame,
            position: s.pip.position,
            size: s.pip.size,
          };
        })()
      : null,
  };
}
export function validateRestoration(
  s: EditSnapshot,
  sources: ProjectSources,
  limits: Limits,
): string | null {
  if (
    s.video1.length + s.video2.length > limits.max_clips ||
    s.music.length + (s.independentAudio?.length ?? 0) > 10 * limits.max_clips
  )
    return 'Clip limit prevents restoring this edit.';
  const ids = new Set<string>();
  for (const id of s.binSourceIds ?? [])
    if (!sources.get(id)) return 'Missing bin source.';
  for (const segment of s.independentAudio ?? []) {
    const record = sources.get(segment.source.sourceId);
    if (
      !record ||
      (segment.source.kind === 'audio-file'
        ? record.mediaType !== 'audio'
        : record.mediaType !== 'video')
    )
      return 'Missing or incompatible audio source.';
    if (ids.has(segment.id)) return 'Conflicting occurrence identity.';
    ids.add(segment.id);
  }
  for (const v of [
    ...s.video1,
    ...s.video2,
    ...s.music,
    ...(s.pip ? [s.pip] : []),
  ]) {
    if (ids.has(v.id)) return 'Conflicting occurrence identity.';
    ids.add(v.id);
    const r = sources.get(v.sourceId);
    if (
      !r ||
      ('trim' in v
        ? r.mediaType !== 'video'
        : 'sourceStartSample' in v
          ? r.mediaType !== 'audio'
          : r.kind !== 'pip')
    )
      return 'Missing or incompatible project source.';
    if ('trim' in v && v.trim) {
      const t = v.trim;
      if (
        !Number.isInteger(t.startFrame) ||
        !Number.isInteger(t.endFrame) ||
        t.startFrame < 0 ||
        t.endFrame < t.startFrame ||
        (r.metadata && t.endFrame >= r.metadata.totalFrames)
      )
        return 'Invalid source trim.';
    }
  }
  const fps = resolveProjectFps(
    s.fpsSelection,
    sources.get(s.video1[0]?.sourceId)?.metadata?.fps,
  );
  for (const occurrence of s.video1) {
    const window = occurrence.outputWindow;
    if (!window) continue;
    const metadata = sources.get(occurrence.sourceId)?.metadata;
    if (
      !metadata ||
      !occurrence.trim ||
      !fps ||
      !Number.isSafeInteger(window.outputInFrame) ||
      !Number.isSafeInteger(window.outputOutFrame) ||
      window.outputInFrame < 0 ||
      window.outputOutFrame <= window.outputInFrame ||
      window.outputOutFrame >
        projectFrameCount(
          occurrence.trim.endFrame - occurrence.trim.startFrame + 1,
          metadata.fps,
          occurrence.speed,
          fps,
        )
    )
      return 'Invalid normalized source window.';
  }
  return validatePositioned(s, sources, fps ?? undefined);
}
