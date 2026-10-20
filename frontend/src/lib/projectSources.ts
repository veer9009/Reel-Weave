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
  restoredProjectSource?: true;
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
export type ReadySourceInput = {
  id: string;
  file: File;
  kind: SourceKind;
  mediaType: SourceRecord['mediaType'];
  metadata: SourceMetadata;
};
export type SourceAdoption = { commit(): void; rollback(): void };
export type ProjectSources = {
  registerReady(input: ReadySourceInput): SourceToken;
  adoptFrom(staged: ProjectSources): SourceAdoption;
  collectGarbage(next: ReadonlySet<string>): void;
  register(file: File, kind: SourceKind): SourceToken;
  get(id: string): SourceRecord | undefined;
  markReady(token: SourceToken, metadata: SourceMetadata): boolean;
  markError(token: SourceToken): boolean;
  ensureUrl(id: string): string;
  setExternalOwners(ids: ReadonlySet<string>): void;
  readonly externalOwners: ReadonlySet<string>;
  acquireLease(owner: string, ids: ReadonlySet<string>): () => void;
  onBeforeClear(callback: () => void): () => void;
  reconcileUrls(next: ReadonlySet<string>): void;
  clear(): void;
};
const registries = new WeakMap<
  object,
  { records: Map<string, SourceRecord>; session(): number }
>();
export function createProjectSources(): ProjectSources {
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
  let pruning = false;
  const adoptions = new Set<() => void>();
  const owners = () =>
    new Set([
      ...externalOwners,
      ...[...leases.values()].flatMap((v) => [...v.ids]),
    ]);
  const reconcile = (prune = pruning) => {
    const held = owners();
    for (const [id, r] of records) {
      if (!reachable.has(id) && !held.has(id)) {
        if (r.url) {
          URL.revokeObjectURL(r.url);
          delete r.url;
        }
        if (prune) records.delete(id);
      }
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
  const api: ProjectSources = {
    registerReady(input: ReadySourceInput): SourceToken {
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(input.id) ||
        records.has(input.id) ||
        !input.file.size
      )
        throw new Error('Invalid or conflicting prepared source.');
      const { clipMetadata: m, duration, sampleCount } = input.metadata;
      const expectedType =
        input.kind === 'image'
          ? 'image'
          : input.kind === 'audio' || input.kind === 'music'
            ? 'audio'
            : 'video';
      if (
        input.mediaType !== expectedType ||
        (input.mediaType !== 'image' &&
          (!Number.isFinite(m?.duration ?? duration) ||
            (m?.duration ?? duration ?? 0) <= 0)) ||
        (input.mediaType === 'audio' &&
          (!Number.isSafeInteger(sampleCount) ||
            !sampleCount ||
            sampleCount < 1))
      )
        throw new Error('Invalid prepared source metadata.');
      if (
        m &&
        (![m.duration, m.fps, m.width, m.height, m.totalFrames].every(
          (n) => Number.isFinite(n) && n > 0,
        ) ||
          !Number.isSafeInteger(m.totalFrames))
      )
        throw new Error('Invalid prepared video timing.');
      const token = { session, sourceId: input.id, requestId: 1 };
      records.set(input.id, {
        token,
        kind: input.kind,
        mediaType: input.mediaType,
        file: input.file,
        status: 'ready',
        restoredProjectSource: true,
        ...(m ? { metadata: { ...m } } : {}),
        ...((m?.duration ?? duration)
          ? { duration: m?.duration ?? duration }
          : {}),
        ...(sampleCount ? { sampleCount } : {}),
      });
      return token;
    },
    adoptFrom(staged: ProjectSources): SourceAdoption {
      const state = registries.get(staged);
      if (!state || staged === api)
        throw new Error('Invalid staging registry.');
      const entries = [...state.records];
      if (entries.some(([id, r]) => records.has(id) || r.status !== 'ready'))
        throw new Error('Conflicting or unready staged source.');
      const epoch = session,
        stagedEpoch = state.session();
      const owner = `adoption-${++leaseSerial}`;
      leases.set(owner, {
        serial: leaseSerial,
        ids: new Set(entries.map(([id]) => id)),
      });
      let settled: 'pending' | 'committed' | 'rolled-back' = 'pending';
      const rollback = () => {
        if (settled !== 'pending') return;
        settled = 'rolled-back';
        for (const [id] of entries) records.delete(id);
        leases.delete(owner);
        adoptions.delete(rollback);
      };
      adoptions.add(rollback);
      try {
        for (const [id, record] of entries)
          records.set(id, {
            ...record,
            token: {
              session,
              sourceId: id,
              requestId: record.token.requestId + 1,
            },
          });
      } catch (error) {
        rollback();
        throw error;
      }
      return {
        rollback,
        commit() {
          if (settled === 'committed') return;
          if (
            settled !== 'pending' ||
            session !== epoch ||
            state.session() !== stagedEpoch
          ) {
            rollback();
            throw new Error('Source adoption expired.');
          }
          for (const [id] of entries) state.records.delete(id);
          settled = 'committed';
          leases.delete(owner);
          adoptions.delete(rollback);
          reconcile();
        },
      };
    },
    collectGarbage(next: ReadonlySet<string>) {
      reachable = new Set(next);
      pruning = true;
      reconcile();
    },
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
      if (r.restoredProjectSource && r.status === 'ready') return true;
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
      if (pruning) reconcile();
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
      reconcile(false);
    },
    clear() {
      for (const stop of beforeClear) stop();
      for (const cancel of [...adoptions]) cancel();
      for (const r of records.values()) if (r.url) URL.revokeObjectURL(r.url);
      records.clear();
      externalOwners = new Set();
      leases.clear();
      reachable = new Set();
      pruning = false;
      session++;
    },
  };
  registries.set(api, { records, session: () => session });
  return api;
}
export function collectReachableSources(
  h: EditHistory,
  preview: EditSnapshot | null,
  pending: readonly SourceToken[],
  owners: ReadonlySet<string>,
): ReadonlySet<string> {
  const ids = new Set(owners);
  const add = (s: EditSnapshot) => {
    if (s.projectContext?.imageOverlay)
      ids.add(s.projectContext.imageOverlay.sourceId);
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
