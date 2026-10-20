import { useEffect, useState } from 'react';
import type {
  ClipSpeed,
  Limits,
  ProjectFps,
  ProjectFpsSelection,
} from '../lib/clips';
import { resolveProjectFps } from '../lib/clips';
import { convertPositionedFps } from '../lib/positionedEdits';
import type { PositionedTrack } from '../lib/positionedEdits';
import { projectFrameCount } from '../lib/overlays';
import type { ClipTrim, ClipSpeed as Speed } from '../lib/clips';
import { placementLength } from '../lib/advancedTimeline';
import {
  createHistory,
  commitHistory,
  undoHistory,
  redoHistory,
  rebaseHistory as rebaseScopedHistory,
  snapshotsEqual,
  normalizeSnapshot,
  commitProjectReplacement,
} from '../lib/editHistory';
import {
  cloneProjectContext,
  collectSnapshotSources,
  createProjectContext,
} from '../lib/projectContext';
import type {
  PreparedProject,
  ProjectCapture,
  ProjectContext,
  ProjectContextRestore,
  ProjectEnvelope,
  ProjectOpenLock,
} from '../lib/projectContext';
import type { CapturedSource, ProjectResult } from '../lib/projectFileTypes';
import { projectFailure } from '../lib/projectFileTypes';
import { validatePositioned } from '../lib/positionedEdits';
import type {
  EditSnapshot,
  GestureToken,
  HistoryAction,
  HistoryControls,
} from '../lib/editHistory';
import {
  createProjectSources,
  collectReachableSources,
} from '../lib/projectSources';
import type { SourceMetadata, SourceToken } from '../lib/projectSources';
import { validateRestoration } from '../lib/historyProjection';
import { materializeSnapshot } from '../lib/historyProjection';
import { buildTimeline } from '../lib/timeline';
import { changeBaseSourceEdit } from '../lib/overwriteEdits';
import { buildAdvancedTimeline } from '../lib/advancedTimeline';
import { detachAudio, editIndependentAudio } from '../lib/audioTimeline';
import type { AudioTarget, AudioSegmentEdit } from '../lib/audioTimeline';
import type { PlacementDraft } from '../lib/placement';
import { validatePlacement } from '../lib/placement';
import type { TransportAnchor, TransportEdit } from '../lib/transportMapping';
export type TransportListener = {
  capture: () => TransportAnchor;
  apply: (anchor: TransportAnchor, edit: TransportEdit) => void;
  cancel: () => void;
};
import {
  defaultOverlaySchedule,
  validateOverlaySchedule,
} from '../lib/overlays';
export type HistoryOptions = {
  onProjectContextRestore?: (restored: ProjectContextRestore) => void;
  onPlaced?: (track: PlacementDraft['track'], id: string) => void;
  limits: Limits;
  editingLocked: boolean;
  trimDraftOpen: boolean;
  onError: (message: string) => void;
  onAnnouncement: (message: string) => void;
};
const defaults = (): EditSnapshot => ({
  projectContext: createProjectContext(),
  binSourceIds: [],
  independentAudio: [],
  video1: [],
  video2: [],
  musicSourceId: null,
  music: [],
  pip: null,
  audio: {
    originalVolume: 1,
    originalMuted: false,
    musicVolume: 0.3,
    musicMuted: false,
  },
  fpsSelection: 'auto',
});
type Transaction = {
  token: GestureToken;
  action:
    | 'trim'
    | 'audio-volume'
    | 'video2-trim'
    | 'music-trim'
    | 'video2-move'
    | 'music-move'
    | 'independent-move'
    | 'independent-trim';
  targetId: string;
  preview: EditSnapshot;
};
function structural(a: EditSnapshot, b: EditSnapshot) {
  return !snapshotsEqual({ ...a, audio: b.audio }, b);
}
function createController(initialOptions: HistoryOptions, changed: () => void) {
  let options = initialOptions;
  let history = createHistory(defaults());
  let transaction: Transaction | null = null;
  let revision = 0;
  let sourceRevision = 0;
  let transport: TransportListener | null = null,
    transportToken = 0;
  let pendingPip: SourceToken | null = null;
  let lastResolvedFps: ProjectFps | null = null;
  let openLock: object | null = null;
  let pendingImports: EditSnapshot['video1'] = [];
  let pendingBinImports: {
    token: SourceToken;
    mediaType: 'video' | 'audio';
    placement?: PlacementDraft;
    replaceId?: string;
  }[] = [];
  let timelineCandidates: {
    token: SourceToken;
    track: PositionedTrack;
    startFrame: number;
    targetId?: string;
  }[] = [];
  const sources = createProjectSources();
  sources.onBeforeClear(() => transport?.cancel());
  const allowed = () =>
    !openLock &&
    !api.options.editingLocked &&
    !api.options.trimDraftOpen &&
    !transaction;
  const context = () => history.present.projectContext!;
  const withTiming = (s: EditSnapshot): EditSnapshot =>
    s.projectContext
      ? {
          ...s,
          projectContext: {
            ...s.projectContext,
            timingFps:
              resolveProjectFps(
                s.fpsSelection,
                sources.get(s.video1[0]?.sourceId)?.metadata?.fps,
              ) ?? s.projectContext.timingFps,
          },
        }
      : s;
  const rebaseHistory = (
    h: typeof history,
    rewrite: (s: EditSnapshot) => EditSnapshot,
    userEdit: boolean,
  ) =>
    rebaseScopedHistory(
      h,
      (s) => withTiming(rewrite(s)),
      userEdit,
      context().incarnationId,
    );
  const reconcile = () =>
    sources.collectGarbage(
      collectReachableSources(
        history,
        transaction?.preview ?? null,
        [
          ...(pendingPip ? [pendingPip] : []),
          ...pendingImports.map((v) => sources.get(v.sourceId)!.token),
          ...timelineCandidates.map((v) => v.token),
          ...pendingBinImports.map((v) => v.token),
        ],
        new Set(),
      ),
    );
  const publish = () => {
    reconcile();
    changed();
  };
  const restoreContext = (
    s: EditSnapshot,
    registry = sources,
  ): ProjectContextRestore => {
    const next = cloneProjectContext(s.projectContext!);
    const overlay = next.imageOverlay;
    const r = overlay ? registry.get(overlay.sourceId) : null;
    if (overlay && (!r || r.mediaType !== 'image' || r.status !== 'ready'))
      throw new Error('Missing or unready image source.');
    return {
      context: next,
      image:
        overlay && r
          ? {
              kind: 'image',
              file: r.file,
              url: registry.ensureUrl(overlay.sourceId),
              metadataStatus: 'ready',
              startFrame: overlay.startFrame,
              endFrame: overlay.endFrame,
              position: overlay.position,
              size: overlay.size,
            }
          : null,
      imageToken: r?.token ?? null,
    };
  };
  const publishReplacement = (
    next: typeof history,
    restored: ProjectContextRestore,
  ) => {
    transport?.cancel();
    history = next;
    lastResolvedFps = restored.context.timingFps;
    revision++;
    sourceRevision++;
    sources.setExternalOwners(
      new Set(
        restored.context.imageOverlay
          ? [restored.context.imageOverlay.sourceId]
          : [],
      ),
    );
    options.onProjectContextRestore?.(restored);
    publish();
  };
  const apply = (
    next: typeof history,
    action: TransportEdit['action'] = 'trim',
    lineage: ReadonlyMap<string, string> = new Map(),
  ) => {
    const anchor = transport?.capture();
    const projection = (snapshot: EditSnapshot) => {
      const m = materializeSnapshot(snapshot, sources);
      return buildAdvancedTimeline(snapshot, sources, {
        image: null,
        video: m.pip,
      });
    };
    const edit =
      transport && anchor
        ? {
            token: ++transportToken,
            before: projection(history.present),
            after: projection(next.present),
            action,
            lineage,
          }
        : null;
    if (structural(history.present, next.present)) revision++;
    history = rebaseScopedHistory(
      next,
      withTiming,
      false,
      context().incarnationId,
    );
    if (edit && anchor) transport?.apply(anchor, edit);
    lastResolvedFps =
      resolveProjectFps(
        history.present.fpsSelection,
        sources.get(history.present.video1[0]?.sourceId)?.metadata?.fps,
      ) ??
      history.present.projectContext?.timingFps ??
      lastResolvedFps;
    publish();
  };
  const valid = (snapshot: EditSnapshot) => {
    const resolved = resolveProjectFps(
      snapshot.fpsSelection,
      sources.get(snapshot.video1[0]?.sourceId)?.metadata?.fps,
    );
    const error =
      validateRestoration(snapshot, sources, api.options.limits) ??
      validatePositioned(
        snapshot,
        sources,
        resolved ?? snapshot.projectContext?.timingFps ?? undefined,
      );
    if (error) api.options.onError(error);
    return !error;
  };
  const navigate = (redo: boolean) => {
    if (!allowed()) return false;
    const entry = (redo ? history.future : history.past).at(-1);
    if (!entry || !valid(redo ? entry.after : entry.before)) return false;
    const target = redo ? entry.after : entry.before;
    let restored: ProjectContextRestore | undefined;
    try {
      materializeSnapshot(target, sources);
      if (entry.action === 'project-open') restored = restoreContext(target);
    } catch (error) {
      api.options.onError(
        error instanceof Error
          ? error.message
          : 'Could not restore preview resources.',
      );
      return false;
    }
    pendingPip = null;
    pendingImports = [];
    pendingBinImports = [];
    timelineCandidates = [];
    const next = redo ? redoHistory(history) : undoHistory(history);
    if (restored) publishReplacement(next, restored);
    else apply(next, redo ? 'redo' : 'undo');
    api.options.onAnnouncement(`${redo ? 'Redid' : 'Undid'} ${entry.label}.`);
    return true;
  };
  const api = {
    get projectContext(): ProjectContext {
      return cloneProjectContext(context());
    },
    updateExternalProjectContext(
      patch: Pick<Partial<ProjectContext>, 'imageOverlay' | 'exportFormats'>,
      userEdit: 'image' | 'export' | 'metadata',
    ) {
      if (openLock) return;
      history = rebaseScopedHistory(
        history,
        (s) => ({
          ...s,
          projectContext: cloneProjectContext({
            ...s.projectContext!,
            ...patch,
          }),
        }),
        userEdit === 'image',
        context().incarnationId,
      );
      publish();
    },
    captureProject(capturedAt: Date): ProjectCapture {
      const envelope = normalizeSnapshot(
        withTiming(history.present),
      ) as ProjectEnvelope;
      const captured = new Map<string, CapturedSource>();
      for (const sourceId of collectSnapshotSources(envelope)) {
        const r = sources.get(sourceId);
        if (!r || r.status !== 'ready')
          throw new Error('All saved sources must be ready.');
        captured.set(sourceId, {
          kind: r.kind,
          mediaType: r.mediaType,
          file: r.file,
          status: r.status,
          ...(r.metadata ? { metadata: { ...r.metadata } } : {}),
          ...(r.duration !== undefined ? { duration: r.duration } : {}),
          ...(r.sampleCount !== undefined
            ? { sampleCount: r.sampleCount }
            : {}),
        });
      }
      return {
        envelope,
        sources: captured,
        capturedAt: new Date(capturedAt.getTime()),
      };
    },
    acquireProjectOpenLock(): ProjectOpenLock | null {
      if (
        !allowed() ||
        pendingPip ||
        pendingImports.length ||
        pendingBinImports.length ||
        timelineCandidates.length
      )
        return null;
      const owner = {};
      openLock = owner;
      const lock: ProjectOpenLock = {
        release() {
          if (openLock === owner) {
            openLock = null;
            changed();
          }
        },
        replace(prepared: PreparedProject): ProjectResult<void> {
          if (
            openLock !== owner ||
            options.editingLocked ||
            options.trimDraftOpen ||
            transaction
          )
            return projectFailure(
              'cancelled',
              'Open Project is no longer available.',
            );
          let adoption: ReturnType<typeof sources.adoptFrom> | undefined;
          let next: typeof history;
          let restored: ProjectContextRestore;
          try {
            const target = prepared.envelope;
            const issue =
              validateRestoration(target, prepared.sources, options.limits) ??
              validatePositioned(
                target,
                prepared.sources,
                target.projectContext.timingFps ?? undefined,
              );
            if (issue) return projectFailure('invalid', issue, 'edit');
            materializeSnapshot(target, prepared.sources);
            restoreContext(target, prepared.sources);
            next = commitProjectReplacement(history, target);
            adoption = sources.adoptFrom(prepared.sources);
            restored = restoreContext(next.present);
          } catch {
            adoption?.rollback();
            return projectFailure(
              'resource',
              'Could not prepare the opened project. Retry or cancel.',
            );
          }
          publishReplacement(next, restored);
          adoption.commit();
          return { ok: true, value: undefined };
        },
      };
      changed();
      return lock;
    },
    bindTransport(listener: TransportListener) {
      transport = listener;
      return () => {
        if (transport === listener) transport = null;
      };
    },
    get options() {
      return options;
    },
    configure(next: HistoryOptions) {
      options = next;
    },
    sources,
    get history() {
      return history;
    },
    get view() {
      return transaction?.preview ?? history.present;
    },
    get structuralRevision() {
      return revision;
    },
    get sourceRevision() {
      return sourceRevision;
    },
    get gestureActive() {
      return Boolean(transaction);
    },
    get pendingPip() {
      return pendingPip;
    },
    get pendingImports() {
      return pendingImports.map((v) => sources.get(v.sourceId)!.token);
    },
    get pendingBinImports() {
      return pendingBinImports;
    },
    get pendingTimelineSources() {
      return timelineCandidates;
    },
    get controls(): HistoryControls {
      return {
        canUndo: allowed() && history.past.length > 0,
        canRedo: allowed() && history.future.length > 0,
        shortcutsAllowed: allowed(),
        undo: () => navigate(false),
        redo: () => navigate(true),
      };
    },
    commit(
      action: HistoryAction,
      label: string,
      next: EditSnapshot,
      lineage: ReadonlyMap<string, string> = new Map(),
    ): boolean {
      if (openLock || api.options.editingLocked || transaction) return false;
      next = { ...next, projectContext: cloneProjectContext(context()) };
      const oldFps =
        resolveProjectFps(
          history.present.fpsSelection,
          sources.get(history.present.video1[0]?.sourceId)?.metadata?.fps,
        ) ??
        history.present.projectContext?.timingFps ??
        lastResolvedFps;
      const newFps =
        resolveProjectFps(
          next.fpsSelection,
          sources.get(next.video1[0]?.sourceId)?.metadata?.fps,
        ) ?? lastResolvedFps;
      if (oldFps && newFps && oldFps !== newFps) {
        const converted = convertPositionedFps(next, oldFps, newFps, sources);
        if ('error' in converted) {
          api.options.onError(converted.error.message);
          return false;
        }
        next = converted.value;
      }
      if (action.startsWith('video2-')) {
        const total = buildTimeline(
          materializeSnapshot(next, sources).clips,
          next.fpsSelection,
        ).totalFrames;
        if (
          action !== 'video2-ripple-delete' &&
          next.video2.some(
            (v) =>
              v.timelineStartFrame + placementLength(v) > total &&
              JSON.stringify(v) !==
                JSON.stringify(
                  history.present.video2.find((old) => old.id === v.id),
                ),
          )
        ) {
          api.options.onError('Replacement clips must fit within Video 1.');
          return false;
        }
      }
      if (
        api.options.editingLocked ||
        transaction ||
        (api.options.trimDraftOpen && action !== 'trim') ||
        !valid(next)
      )
        return false;
      const result = commitHistory(history, action, label, next);
      if (result === history) return false;
      if (action === 'pip-remove') pendingPip = null;
      if (
        action === 'video2-ripple-delete' ||
        action === 'music-remove' ||
        action === 'music-ripple-delete'
      )
        timelineCandidates = [];
      apply(result, action, lineage);
      return true;
    },
    setFpsSelection(selection: ProjectFpsSelection): boolean {
      return api.commit('fps', 'Change FPS', {
        ...history.present,
        fpsSelection: selection,
      });
    },
    commitVideo1(
      action: HistoryAction,
      label: string,
      nextVideo1: EditSnapshot['video1'],
      lineage: ReadonlyMap<string, string> = new Map(),
    ): boolean {
      return api.commit(
        action,
        label,
        {
          ...history.present,
          video1: nextVideo1,
        },
        lineage,
      );
    },
    importToBin(
      file: File,
      mediaType: 'video' | 'audio',
      placement?: Omit<PlacementDraft, 'token'>,
      replaceId?: string,
    ): SourceToken | null {
      if (!allowed()) return null;
      const pattern =
        mediaType === 'video'
          ? /\.(mp4|mov|webm|mkv)$/i
          : /\.(mp3|wav|aac|m4a)$/i;
      const limit =
        mediaType === 'video'
          ? api.options.limits.max_file_size_mb
          : (api.options.limits.max_audio_file_size_mb ?? 100);
      if (
        !pattern.test(file.name) ||
        !file.size ||
        file.size > limit * 1024 * 1024
      ) {
        api.options.onError(
          'Choose a nonempty supported media file within its size limit.',
        );
        return null;
      }
      const token = sources.register(file, mediaType);
      pendingBinImports = [
        ...pendingBinImports,
        {
          token,
          mediaType,
          placement: placement ? { ...placement, token } : undefined,
          replaceId,
        },
      ];
      publish();
      return token;
    },
    removeBinSource(sourceId: string): boolean {
      if (!allowed() || !history.present.binSourceIds.includes(sourceId))
        return false;
      return api.commit('bin-remove', 'Remove bin entry', {
        ...history.present,
        binSourceIds: history.present.binSourceIds.filter(
          (v) => v !== sourceId,
        ),
      });
    },
    cancelBinImport(token: SourceToken) {
      pendingBinImports = pendingBinImports.filter(
        (v) => v.token.sourceId !== token.sourceId,
      );
      publish();
    },
    commitDetach(target: AudioTarget): boolean {
      if (!allowed()) return false;
      const m = materializeSnapshot(history.present, sources);
      const projection = buildAdvancedTimeline(history.present, sources, {
        image: null,
        video: m.pip,
      });
      const next = detachAudio(
        history.present,
        sources,
        projection,
        target,
        () => crypto.randomUUID(),
      );
      if ('error' in next) {
        api.options.onError(next.error.message);
        return false;
      }
      return api.commit('detach-audio', 'Detach Audio', next.value);
    },
    commitAudioEdit(edit: AudioSegmentEdit): boolean {
      if (!allowed()) return false;
      const fps =
        resolveProjectFps(
          history.present.fpsSelection,
          sources.get(history.present.video1[0]?.sourceId)?.metadata?.fps,
        ) ?? lastResolvedFps;
      if (!fps) return false;
      const next = editIndependentAudio(
        history.present,
        edit,
        fps,
        sources,
        () => crypto.randomUUID(),
      );
      if ('error' in next) {
        api.options.onError(next.error.message);
        return false;
      }
      return api.commit(
        `independent-${edit.action}`,
        'Edit independent audio',
        next.value,
      );
    },
    commitPlacement(draft: PlacementDraft): boolean {
      if (!allowed()) return false;
      const result = validatePlacement(
        history.present,
        sources,
        draft,
        api.options.limits,
      );
      if ('error' in result) {
        api.options.onError(result.error.message);
        return false;
      }
      const action = {
        video1: 'overwrite',
        video2: 'video2-add',
        independent: 'independent-place',
        music: 'music-add',
      } as const;
      const before = history.present;
      if (!api.commit(action[draft.track], 'Place media', result.value))
        return false;
      const next = history.present;
      const id =
        draft.track === 'video1'
          ? buildTimeline(
              materializeSnapshot(next, sources).clips,
              next.fpsSelection,
            ).items.find((v) => v.startFrame === draft.timelineStartFrame)?.clip
              .id
          : draft.track === 'video2'
            ? next.video2.find(
                (v) => !before.video2.some((old) => old.id === v.id),
              )?.id
            : draft.track === 'music'
              ? next.music.find(
                  (v) => !before.music.some((old) => old.id === v.id),
                )?.id
              : next.independentAudio.find(
                  (v) =>
                    !before.independentAudio.some((old) => old.id === v.id),
                )?.id;
      if (id) api.options.onPlaced?.(draft.track, id);
      return true;
    },
    begin(
      action: Transaction['action'],
      targetId: string,
    ): GestureToken | null {
      if (
        !allowed() ||
        (action === 'trim' &&
          !history.present.video1.some((v) => v.id === targetId))
      )
        return null;
      const token = crypto.randomUUID();
      if (
        action.startsWith('independent-') &&
        !history.present.independentAudio.some((v) => v.id === targetId)
      )
        return null;
      transaction = { token, action, targetId, preview: history.present };
      publish();
      return token;
    },
    preview(token: GestureToken, next: EditSnapshot) {
      if (
        !transaction ||
        transaction.token !== token ||
        api.options.editingLocked
      )
        return;
      const t = transaction;
      t.preview =
        t.action === 'trim'
          ? {
              ...history.present,
              video1: history.present.video1.map((v) =>
                v.id === t.targetId
                  ? {
                      ...v,
                      trim:
                        next.video1.find((n) => n.id === v.id)?.trim ?? v.trim,
                      outputWindow: undefined,
                    }
                  : v,
              ),
            }
          : t.action.startsWith('independent-')
            ? {
                ...history.present,
                independentAudio: history.present.independentAudio.map((v) =>
                  v.id === t.targetId
                    ? (next.independentAudio.find((n) => n.id === v.id) ?? v)
                    : v,
                ),
              }
            : t.action !== 'audio-volume'
              ? {
                  ...history.present,
                  ...(t.action.startsWith('video2-')
                    ? {
                        video2: history.present.video2.map((v) =>
                          v.id === t.targetId
                            ? (next.video2.find((n) => n.id === v.id) ?? v)
                            : v,
                        ),
                      }
                    : {
                        music: history.present.music.map((v) =>
                          v.id === t.targetId
                            ? (next.music.find((n) => n.id === v.id) ?? v)
                            : v,
                        ),
                      }),
                }
              : {
                  ...history.present,
                  audio: {
                    ...history.present.audio,
                    [t.targetId]:
                      next.audio[
                        t.targetId as 'originalVolume' | 'musicVolume'
                      ],
                  },
                };
      changed();
    },
    finish(token: GestureToken, accept: boolean): boolean {
      const t = transaction;
      if (!t || t.token !== token) return false;
      transaction = null;
      if (
        !accept ||
        api.options.editingLocked ||
        snapshotsEqual(history.present, t.preview)
      ) {
        publish();
        return false;
      }
      const next =
        t.action === 'trim'
          ? {
              ...t.preview,
              video1: t.preview.video1.map((v) =>
                v.id === t.targetId ? { ...v, trimSaved: true } : v,
              ),
            }
          : t.preview;
      const total = buildTimeline(
        materializeSnapshot(next, sources).clips,
        next.fpsSelection,
      ).totalFrames;
      if (
        !valid(next) ||
        (t.action.startsWith('video2-') &&
          next.video2.some(
            (v) =>
              v.id === t.targetId &&
              v.timelineStartFrame + placementLength(v) > total,
          ))
      ) {
        publish();
        return false;
      }
      apply(
        commitHistory(
          history,
          t.action,
          t.action === 'audio-volume'
            ? 'Change audio volume'
            : 'Edit timeline clip',
          next,
        ),
        t.action,
      );
      return true;
    },
    importVideo1(files: File[]) {
      if (
        openLock ||
        api.options.editingLocked ||
        !files.length ||
        history.present.video1.length +
          history.present.video2.length +
          files.length >
          api.options.limits.max_clips
      )
        return;
      transaction = null;
      const additions = files.map((file) => ({
        id: crypto.randomUUID(),
        sourceId: sources.register(file, 'video1').sourceId,
        trim: null,
        trimSaved: false,
        speed: 1 as const,
      }));
      const retained = [
        history.present,
        ...history.past.flatMap((e) => [e.before, e.after]),
        ...history.future.flatMap((e) => [e.before, e.after]),
      ].filter(
        (s) => s.projectContext?.incarnationId === context().incarnationId,
      );
      if (
        retained.some(
          (s) =>
            !s.video1.length &&
            (s.video2.length || s.music.length || s.independentAudio.length),
        )
      ) {
        pendingImports = additions;
        publish();
        return;
      }
      apply(
        rebaseHistory(
          history,
          (s) => ({ ...s, video1: [...s.video1, ...additions] }),
          true,
        ),
      );
    },
    sourceReady(token: SourceToken, metadata: SourceMetadata): boolean {
      if (openLock) return false;
      if (!sources.markReady(token, metadata)) return false;
      if (sources.get(token.sourceId)?.restoredProjectSource) return true;
      sourceRevision++;
      if (pendingBinImports.some((v) => v.token.sourceId === token.sourceId)) {
        api.resumeBinImports();
        publish();
        return true;
      }
      if (pendingImports.some((v) => v.sourceId === token.sourceId)) {
        if (
          pendingImports.every(
            (v) => sources.get(v.sourceId)?.status === 'ready',
          )
        ) {
          const additions = pendingImports.map((v) => ({
            ...v,
            trim: {
              startFrame: 0,
              endFrame: sources.get(v.sourceId)!.metadata!.totalFrames - 1,
            },
          }));
          let failure: string | null = null;
          const candidate = rebaseHistory(
            history,
            (s) => {
              const oldF =
                resolveProjectFps(
                  s.fpsSelection,
                  sources.get(s.video1[0]?.sourceId)?.metadata?.fps,
                ) ?? lastResolvedFps;
              let next: EditSnapshot = {
                ...s,
                video1: [...s.video1, ...additions],
              };
              const newF = resolveProjectFps(
                next.fpsSelection,
                sources.get(next.video1[0]?.sourceId)?.metadata?.fps,
              );
              if (oldF && newF && oldF !== newF) {
                const converted = convertPositionedFps(
                  next,
                  oldF,
                  newF,
                  sources,
                );
                if ('error' in converted) failure = converted.error.message;
                else next = converted.value;
              }
              failure =
                validateRestoration(next, sources, api.options.limits) ??
                failure;
              return next;
            },
            true,
          );
          pendingImports = [];
          if (failure) api.options.onError(failure);
          else apply(candidate);
        }
        publish();
        return true;
      }
      const initialize = (s: EditSnapshot): EditSnapshot => ({
        ...s,
        video1: s.video1.map((v) =>
          v.sourceId === token.sourceId && !v.trim && metadata.clipMetadata
            ? {
                ...v,
                trim: {
                  startFrame: 0,
                  endFrame: metadata.clipMetadata.totalFrames - 1,
                },
              }
            : v,
        ),
      });
      history = rebaseHistory(history, initialize, false);
      lastResolvedFps =
        resolveProjectFps(
          history.present.fpsSelection,
          sources.get(history.present.video1[0]?.sourceId)?.metadata?.fps,
        ) ?? lastResolvedFps;
      if (transaction) transaction.preview = initialize(transaction.preview);
      publish();
      return true;
    },
    resumeBinImports() {
      if (!allowed()) return;
      const ready = pendingBinImports.filter(
        (v) => sources.get(v.token.sourceId)?.status === 'ready',
      );
      pendingBinImports = pendingBinImports.filter((v) => !ready.includes(v));
      for (const item of ready) {
        if (item.replaceId)
          api.commitAudioEdit({
            action: 'replace',
            id: item.replaceId,
            source: { kind: 'audio-file', sourceId: item.token.sourceId },
            sourceStartSample: 0,
          });
        else if (item.placement) api.commitPlacement(item.placement);
        else
          api.commit('bin-import', 'Import media to bin', {
            ...history.present,
            binSourceIds: [
              ...history.present.binSourceIds,
              item.token.sourceId,
            ],
          });
      }
    },
    sourceError(token: SourceToken): boolean {
      if (openLock) return false;
      if (!sources.markError(token)) return false;
      sourceRevision++;
      pendingBinImports = pendingBinImports.filter(
        (v) => v.token.sourceId !== token.sourceId,
      );
      if (pendingImports.some((v) => v.sourceId === token.sourceId))
        pendingImports = [];
      publish();
      return true;
    },
    rebaseSpeed(id: string, speed: ClipSpeed) {
      if (
        !allowed() ||
        history.present.video1.find((v) => v.id === id)?.speed === speed ||
        !history.present.video1.some((v) => v.id === id)
      )
        return;
      let failure: string | null = null;
      const next = rebaseHistory(
        history,
        (s) => {
          const target = s.video1.find((v) => v.id === id);
          if (!target?.trim) return s;
          const fps = resolveProjectFps(
            s.fpsSelection,
            sources.get(s.video1[0]?.sourceId)?.metadata?.fps,
          );
          if (!fps) {
            failure = 'Video 1 timing is unavailable.';
            return s;
          }
          const result = changeBaseSourceEdit(
            s,
            id,
            target.trim,
            speed,
            'speed',
            sources,
            fps,
          );
          if ('error' in result) {
            failure = result.error.message;
            return s;
          }
          return result.value;
        },
        true,
      );
      if (failure) api.options.onError(failure);
      else apply(next);
    },
    rebasePipRange(
      id: string,
      changes: Partial<
        Pick<NonNullable<EditSnapshot['pip']>, 'startFrame' | 'endFrame'>
      >,
    ) {
      if (
        !allowed() ||
        history.present.pip?.id !== id ||
        snapshotsEqual(history.present, {
          ...history.present,
          pip: { ...history.present.pip, ...changes },
        })
      )
        return;
      apply(
        rebaseHistory(
          history,
          (s) => ({
            ...s,
            pip: s.pip?.id === id ? { ...s.pip, ...changes } : s.pip,
          }),
          true,
        ),
      );
    },
    excludedUserEdit() {
      if (openLock || api.options.editingLocked || api.options.trimDraftOpen)
        return;
      transaction = null;
      history = { ...history, future: [] };
      publish();
    },
    notifyStructuralChange() {
      if (openLock) return;
      revision++;
      changed();
    },
    stagePip(file: File): SourceToken {
      const token = sources.register(file, 'pip');
      pendingPip = token;
      publish();
      return token;
    },
    stageTimelineSource(
      file: File,
      track: PositionedTrack,
      startFrame: number,
      targetId?: string,
    ): SourceToken | null {
      if (!allowed()) return null;
      const total = buildTimeline(
        materializeSnapshot(history.present, sources).clips,
        history.present.fpsSelection,
      ).totalFrames;
      if (!total || !Number.isSafeInteger(startFrame) || startFrame < 0) {
        api.options.onError(
          'Add ready Video 1 clips and choose a valid timeline start.',
        );
        return null;
      }
      const supported =
        track === 'music' ? /\.(mp3|wav|aac|m4a)$/i : /\.(mp4|mov|webm|mkv)$/i;
      const limit =
        track === 'music'
          ? (api.options.limits.max_audio_file_size_mb ?? 100)
          : api.options.limits.max_file_size_mb;
      if (
        !supported.test(file.name) ||
        !file.size ||
        file.size > limit * 1024 * 1024
      ) {
        api.options.onError(
          `Choose a nonempty supported ${track === 'music' ? 'music' : 'replacement video'} file within the ${limit} MB limit.`,
        );
        return null;
      }
      const token = sources.register(file, track);
      timelineCandidates = timelineCandidates.filter((v) => v.track !== track);
      timelineCandidates.push({ token, track, startFrame, targetId });
      publish();
      return token;
    },
    completeTimelineSource(
      token: SourceToken,
      metadata: SourceMetadata,
    ): boolean {
      if (
        api.options.editingLocked ||
        !timelineCandidates.some(
          (v) =>
            v.token.sourceId === token.sourceId &&
            v.token.session === token.session &&
            v.token.requestId === token.requestId,
        )
      )
        return false;
      const ready = sources.markReady(token, metadata);
      if (ready) {
        sourceRevision++;
        publish();
      }
      return ready;
    },
    acceptTimelineSource(
      token: SourceToken,
      draft: { timelineStartFrame: number; trim?: ClipTrim; speed?: Speed },
    ): boolean {
      const candidate = timelineCandidates.find(
        (v) =>
          v.token.sourceId === token.sourceId &&
          v.token.session === token.session &&
          v.token.requestId === token.requestId,
      );
      const source = sources.get(token.sourceId);
      if (!allowed() || !candidate || source?.status !== 'ready') return false;
      const fps = resolveProjectFps(
        history.present.fpsSelection,
        sources.get(history.present.video1[0]?.sourceId)?.metadata?.fps,
      );
      if (!fps) return false;
      let next: EditSnapshot;
      let action: HistoryAction;
      if (candidate.track === 'video2') {
        const metadata = source.metadata;
        if (!metadata) return false;
        if (
          candidate.targetId &&
          !history.present.video2.some((v) => v.id === candidate.targetId)
        ) {
          api.options.onError('Replacement target no longer exists.');
          return false;
        }
        const trim = draft.trim ?? {
            startFrame: 0,
            endFrame: metadata.totalFrames - 1,
          },
          speed = draft.speed ?? 1;
        const replacement = {
          id: candidate.targetId ?? crypto.randomUUID(),
          sourceId: token.sourceId,
          trim,
          trimSaved: Boolean(draft.trim),
          speed,
          timelineStartFrame: draft.timelineStartFrame,
          contentInFrame: 0,
          contentOutFrame: projectFrameCount(
            trim.endFrame - trim.startFrame + 1,
            metadata.fps,
            speed,
            fps,
          ),
          contentFullSource: true,
        };
        next = {
          ...history.present,
          video2: [
            ...history.present.video2.filter(
              (v) => v.id !== candidate.targetId,
            ),
            replacement,
          ],
        };
        action = candidate.targetId ? 'video2-replace' : 'video2-add';
      } else {
        if (!source.sampleCount) return false;
        const music = {
          id: crypto.randomUUID(),
          sourceId: token.sourceId,
          timelineStartFrame: draft.timelineStartFrame,
          sourceStartSample: 0,
          durationFrames: Math.ceil(source.sampleCount / (48000 / fps)),
        };
        next = {
          ...history.present,
          musicSourceId: token.sourceId,
          music: [music],
        };
        action = history.present.musicSourceId ? 'music-replace' : 'music-add';
      }
      if (
        !api.commit(
          action,
          candidate.track === 'video2'
            ? 'Add/replace Video 2'
            : 'Add/replace song',
          next,
        )
      )
        return false;
      timelineCandidates = timelineCandidates.filter(
        (v) => v.token.sourceId !== token.sourceId,
      );
      publish();
      return true;
    },
    failTimelineSource(token: SourceToken) {
      const candidate = timelineCandidates.find(
        (v) => v.token.sourceId === token.sourceId,
      );
      if (!candidate || !sources.markError(token)) return;
      timelineCandidates = timelineCandidates.filter(
        (v) => v.token.sourceId !== token.sourceId,
      );
      publish();
      api.options.onError(
        candidate.track === 'music'
          ? 'Could not read the background-audio metadata. Choose another file.'
          : 'Could not read replacement metadata. Choose another file.',
      );
    },
    cancelTimelineSources() {
      timelineCandidates = [];
      publish();
    },
    completePip(token: SourceToken, metadata: SourceMetadata): boolean {
      if (
        !pendingPip ||
        pendingPip.sourceId !== token.sourceId ||
        pendingPip.session !== token.session ||
        pendingPip.requestId !== token.requestId
      )
        return false;
      if (!sources.markReady(token, metadata)) return false;
      return api.resumePip();
    },
    resumePip(): boolean {
      if (!pendingPip || !allowed()) return false;
      const source = sources.get(pendingPip.sourceId);
      if (source?.status !== 'ready') return false;
      const total = buildTimeline(
        materializeSnapshot(history.present, sources).clips,
        history.present.fpsSelection,
      ).totalFrames;
      if (total < 1) return false;
      const previous = history.present.pip;
      const schedule =
        previous && !validateOverlaySchedule(previous, total)
          ? {
              startFrame: previous.startFrame,
              endFrame: previous.endFrame,
              position: previous.position,
              size: previous.size,
            }
          : defaultOverlaySchedule('video', total);
      const pip = {
        id: crypto.randomUUID(),
        sourceId: source.token.sourceId,
        ...schedule,
      };
      pendingPip = null;
      return api.commit(
        previous ? 'pip-replace' : 'pip-add',
        previous ? 'Replace PIP' : 'Add PIP',
        { ...history.present, pip },
      );
    },
    failPip(token: SourceToken) {
      if (pendingPip?.sourceId !== token.sourceId || !sources.markError(token))
        return;
      pendingPip = null;
      publish();
      api.options.onError(
        'Could not read the video overlay. Choose another file.',
      );
    },
    cancelPendingPip() {
      if (!pendingPip) return;
      pendingPip = null;
      publish();
    },
    clearProject() {
      openLock = null;
      transaction = null;
      pendingPip = null;
      pendingImports = [];
      timelineCandidates = [];
      pendingBinImports = [];
      sources.clear();
      history = createHistory(defaults());
      lastResolvedFps = null;
      sourceRevision++;
      revision++;
      changed();
    },
    cancelLockedGesture() {
      if (api.options.editingLocked && pendingBinImports.length) {
        pendingBinImports = [];
        publish();
      }
      if (
        api.options.editingLocked &&
        (timelineCandidates.length || pendingPip || pendingImports.length)
      ) {
        timelineCandidates = [];
        pendingPip = null;
        pendingImports = [];
        publish();
      }
      if (api.options.editingLocked && transaction) {
        transaction = null;
        publish();
      }
    },
    dispose() {
      openLock = null;
      transaction = null;
      pendingPip = null;
      pendingImports = [];
      timelineCandidates = [];
      pendingBinImports = [];
      sources.clear();
    },
  };
  return api;
}
export function useEditHistory(options: HistoryOptions) {
  const [, render] = useState(0);
  const [controller] = useState(() =>
    createController(options, () => render((n) => n + 1)),
  );
  controller.configure(options);
  useEffect(() => {
    controller.cancelLockedGesture();
  }, [controller, options.editingLocked]);
  const gestureActive = controller.gestureActive;
  const pendingPip = controller.pendingPip;
  useEffect(() => {
    controller.resumePip();
    controller.resumeBinImports();
  }, [
    controller,
    options.editingLocked,
    options.trimDraftOpen,
    gestureActive,
    pendingPip,
  ]);
  useEffect(() => () => controller.dispose(), [controller]);
  return controller;
}
export type EditHistoryController = ReturnType<typeof useEditHistory>;
