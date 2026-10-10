import type { Clip, Limits } from './clips';
import type { EditSnapshot } from './editHistory';
import type { ProjectSources } from './projectSources';
import type { OverlayState } from './overlays';
export function materializeSnapshot(
  s: Pick<EditSnapshot, 'video1' | 'pip'>,
  sources: ProjectSources,
): { clips: Clip[]; pip: OverlayState['video'] } {
  return {
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
  if (s.video1.length > limits.max_clips)
    return 'Clip limit prevents restoring this edit.';
  const ids = new Set<string>();
  for (const v of [...s.video1, ...(s.pip ? [s.pip] : [])]) {
    if (ids.has(v.id)) return 'Conflicting occurrence identity.';
    ids.add(v.id);
    const r = sources.get(v.sourceId);
    if (!r || r.kind !== ('trim' in v ? 'video1' : 'pip'))
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
  return null;
}
