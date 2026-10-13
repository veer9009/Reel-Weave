import type { Clip, Limits } from './clips';
import type { EditSnapshot } from './editHistory';
import type { ProjectSources } from './projectSources';
import type { OverlayState } from './overlays';
import type { MaterializedVideo2, MaterializedMusic } from './advancedTimeline';
import { validatePositioned } from './positionedEdits';
import { resolveProjectFps } from './clips';
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
    s.music.length > 10 * limits.max_clips
  )
    return 'Clip limit prevents restoring this edit.';
  const ids = new Set<string>();
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
        ? !['video1', 'video2'].includes(r.kind)
        : 'sourceStartSample' in v
          ? r.kind !== 'music'
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
  return validatePositioned(s, sources, fps ?? undefined);
}
