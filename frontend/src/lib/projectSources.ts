import type { ClipMetadata } from './clips';
import type { EditHistory, EditSnapshot } from './editHistory';
export type SourceKind = 'video1' | 'pip' | 'image' | 'music';
export type SourceToken = {
  session: number;
  sourceId: string;
  requestId: number;
};
export type SourceMetadata = { clipMetadata?: ClipMetadata; duration?: number };
export type SourceRecord = {
  token: SourceToken;
  kind: SourceKind;
  file: File;
  status: 'loading' | 'ready' | 'error';
  metadata?: ClipMetadata;
  duration?: number;
  url?: string;
};
export function createProjectSources() {
  let session = 0;
  const records = new Map<string, SourceRecord>();
  let externalOwners: ReadonlySet<string> = new Set();
  const valid = (t: SourceToken) => {
    const r = records.get(t.sourceId);
    return r &&
      r.token.session === t.session &&
      r.token.requestId === t.requestId
      ? r
      : undefined;
  };
  return {
    register(file: File, kind: SourceKind): SourceToken {
      const token = { session, sourceId: crypto.randomUUID(), requestId: 1 };
      records.set(token.sourceId, { token, kind, file, status: 'loading' });
      return token;
    },
    get(id: string) {
      return records.get(id);
    },
    markReady(token: SourceToken, metadata: SourceMetadata): boolean {
      const r = valid(token);
      if (!r || r.status === 'error') return false;
      const m = metadata.clipMetadata;
      if (
        r.kind === 'video1' &&
        (!m ||
          !Number.isFinite(m.duration) ||
          m.duration <= 0 ||
          !Number.isFinite(m.fps) ||
          m.fps <= 0 ||
          !Number.isInteger(m.totalFrames) ||
          m.totalFrames < 1 ||
          !Number.isFinite(m.width) ||
          m.width <= 0 ||
          !Number.isFinite(m.height) ||
          m.height <= 0)
      )
        return false;
      if (
        (r.kind === 'pip' || r.kind === 'music') &&
        (!Number.isFinite(metadata.duration) || metadata.duration! <= 0)
      )
        return false;
      Object.assign(r, {
        status: 'ready',
        metadata: m,
        duration: m?.duration ?? metadata.duration,
      });
      return true;
    },
    markError(token: SourceToken): boolean {
      const r = valid(token);
      if (!r) return false;
      r.status = 'error';
      return true;
    },
    ensureUrl(id: string): string {
      const r = records.get(id);
      if (!r) throw new Error('Missing project source.');
      return (r.url ??= URL.createObjectURL(r.file));
    },
    setExternalOwners(ids: ReadonlySet<string>) {
      externalOwners = new Set(ids);
    },
    get externalOwners() {
      return externalOwners;
    },
    reconcileUrls(reachable: ReadonlySet<string>) {
      for (const [id, r] of records)
        if (r.url && !reachable.has(id) && !externalOwners.has(id)) {
          URL.revokeObjectURL(r.url);
          delete r.url;
        }
    },
    clear() {
      for (const r of records.values()) if (r.url) URL.revokeObjectURL(r.url);
      records.clear();
      externalOwners = new Set();
      session++;
    },
  };
}
export type ProjectSources = ReturnType<typeof createProjectSources>;
export function collectReachableSources(
  h: EditHistory,
  preview: EditSnapshot | null,
  pending: readonly SourceToken[],
  owners: ReadonlySet<string>,
): ReadonlySet<string> {
  const ids = new Set(owners);
  const add = (s: EditSnapshot) => {
    s.video1.forEach((v) => ids.add(v.sourceId));
    if (s.pip) ids.add(s.pip.sourceId);
  };
  add(h.present);
  if (preview) add(preview);
  [...h.past, ...h.future].forEach((e) => {
    add(e.before);
    add(e.after);
  });
  pending.forEach((t) => ids.add(t.sourceId));
  return ids;
}
