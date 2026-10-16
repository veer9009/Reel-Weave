import type { ClipMetadata } from './clips';
import type { EditHistory, EditSnapshot } from './editHistory';
export type SourceKind =
  'video1' | 'video2' | 'pip' | 'image' | 'music' | 'video' | 'audio';
export type SourceToken = {
  session: number;
  sourceId: string;
  requestId: number;
};
export type SourceMetadata = {
  clipMetadata?: ClipMetadata;
  duration?: number;
  sampleCount?: number;
  metadataOrigin?: 'browser' | 'backend';
};
export type SourceRecord = {
  mediaType: 'video' | 'audio' | 'image';
  token: SourceToken;
  kind: SourceKind;
  file: File;
  status: 'loading' | 'ready' | 'error';
  metadata?: ClipMetadata;
  duration?: number;
  sampleCount?: number;
  url?: string;
};
export function createProjectSources() {
  let session = 0;
  const records = new Map<string, SourceRecord>();
  let externalOwners: ReadonlySet<string> = new Set();
  const leases = new Map<
    string,
    { serial: number; ids: ReadonlySet<string> }
  >();
  const beforeClear = new Set<() => void>();
  let leaseSerial = 0;
  let reachable: ReadonlySet<string> = new Set();
  const owners = () =>
    new Set([
      ...externalOwners,
      ...[...leases.values()].flatMap((v) => [...v.ids]),
    ]);
  const reconcile = () => {
    const held = owners();
    for (const [id, r] of records)
      if (r.url && !reachable.has(id) && !held.has(id)) {
        URL.revokeObjectURL(r.url);
        delete r.url;
      }
  };
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
      records.set(token.sourceId, {
        token,
        kind,
        mediaType:
          kind === 'image'
            ? 'image'
            : kind === 'music' || kind === 'audio'
              ? 'audio'
              : 'video',
        file,
        status: 'loading',
      });
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
        (r.kind === 'video1' || r.kind === 'video2' || r.kind === 'video') &&
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
        (r.kind === 'pip' || r.kind === 'music' || r.kind === 'audio') &&
        (!Number.isFinite(metadata.duration) || metadata.duration! <= 0)
      )
        return false;
      Object.assign(r, {
        status: 'ready',
        metadata: m,
        duration: m?.duration ?? metadata.duration,
        sampleCount:
          r.mediaType === 'audio'
            ? (metadata.sampleCount ??
              Math.floor(metadata.duration! * 48000 + 0.5))
            : undefined,
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
      return owners();
    },
    acquireLease(owner: string, ids: ReadonlySet<string>): () => void {
      const serial = ++leaseSerial;
      leases.set(owner, { serial, ids: new Set(ids) });
      return () => {
        if (leases.get(owner)?.serial === serial) {
          leases.delete(owner);
          reconcile();
        }
      };
    },
    onBeforeClear(callback: () => void): () => void {
      beforeClear.add(callback);
      return () => {
        beforeClear.delete(callback);
      };
    },
    reconcileUrls(next: ReadonlySet<string>) {
      reachable = new Set(next);
      reconcile();
    },
    clear() {
      for (const stop of beforeClear) stop();
      for (const r of records.values()) if (r.url) URL.revokeObjectURL(r.url);
      records.clear();
      externalOwners = new Set();
      leases.clear();
      reachable = new Set();
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
    s.binSourceIds?.forEach((id) => ids.add(id));
    s.independentAudio?.forEach((v) => ids.add(v.source.sourceId));
    s.video1.forEach((v) => ids.add(v.sourceId));
    s.video2?.forEach((v) => ids.add(v.sourceId));
    s.music?.forEach((v) => ids.add(v.sourceId));
    if (s.musicSourceId) ids.add(s.musicSourceId);
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
