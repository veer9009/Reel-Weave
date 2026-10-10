import { useEffect, useState } from 'react';
import type { ClipSpeed, Limits } from '../lib/clips';
import {
  createHistory,
  commitHistory,
  undoHistory,
  redoHistory,
  rebaseHistory,
  snapshotsEqual,
} from '../lib/editHistory';
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
import {
  defaultOverlaySchedule,
  validateOverlaySchedule,
} from '../lib/overlays';
export type HistoryOptions = {
  limits: Limits;
  editingLocked: boolean;
  trimDraftOpen: boolean;
  onError: (message: string) => void;
  onAnnouncement: (message: string) => void;
};
const defaults = (): EditSnapshot => ({
  video1: [],
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
  action: 'trim' | 'audio-volume';
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
  let pendingPip: SourceToken | null = null;
  const sources = createProjectSources();
  const allowed = () =>
    !api.options.editingLocked && !api.options.trimDraftOpen && !transaction;
  const reconcile = () =>
    sources.reconcileUrls(
      collectReachableSources(
        history,
        transaction?.preview ?? null,
        pendingPip ? [pendingPip] : [],
        sources.externalOwners,
      ),
    );
  const publish = () => {
    reconcile();
    changed();
  };
  const apply = (next: typeof history) => {
    if (structural(history.present, next.present)) revision++;
    history = next;
    publish();
  };
  const valid = (snapshot: EditSnapshot) => {
    const error = validateRestoration(snapshot, sources, api.options.limits);
    if (error) api.options.onError(error);
    return !error;
  };
  const navigate = (redo: boolean) => {
    if (!allowed()) return false;
    const entry = (redo ? history.future : history.past).at(-1);
    if (!entry || !valid(redo ? entry.after : entry.before)) return false;
    try {
      materializeSnapshot(redo ? entry.after : entry.before, sources);
    } catch (error) {
      api.options.onError(
        error instanceof Error
          ? error.message
          : 'Could not restore preview resources.',
      );
      return false;
    }
    pendingPip = null;
    apply(redo ? redoHistory(history) : undoHistory(history));
    api.options.onAnnouncement(`${redo ? 'Redid' : 'Undid'} ${entry.label}.`);
    return true;
  };
  const api = {
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
    get controls(): HistoryControls {
      return {
        canUndo: allowed() && history.past.length > 0,
        canRedo: allowed() && history.future.length > 0,
        shortcutsAllowed: allowed(),
        undo: () => navigate(false),
        redo: () => navigate(true),
      };
    },
    commit(action: HistoryAction, label: string, next: EditSnapshot): boolean {
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
      apply(result);
      return true;
    },
    begin(
      action: 'trim' | 'audio-volume',
      targetId: string,
    ): GestureToken | null {
      if (
        !allowed() ||
        (action === 'trim' &&
          !history.present.video1.some((v) => v.id === targetId))
      )
        return null;
      const token = crypto.randomUUID();
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
                    }
                  : v,
              ),
            }
          : {
              ...history.present,
              audio: {
                ...history.present.audio,
                [t.targetId]:
                  next.audio[t.targetId as 'originalVolume' | 'musicVolume'],
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
      if (!valid(next)) {
        publish();
        return false;
      }
      apply(
        commitHistory(
          history,
          t.action,
          t.action === 'trim' ? 'Trim clip' : 'Change audio volume',
          next,
        ),
      );
      return true;
    },
    importVideo1(files: File[]) {
      if (
        api.options.editingLocked ||
        !files.length ||
        history.present.video1.length + files.length >
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
      apply(
        rebaseHistory(
          history,
          (s) => ({ ...s, video1: [...s.video1, ...additions] }),
          true,
        ),
      );
    },
    sourceReady(token: SourceToken, metadata: SourceMetadata): boolean {
      if (!sources.markReady(token, metadata)) return false;
      sourceRevision++;
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
      if (transaction) transaction.preview = initialize(transaction.preview);
      publish();
      return true;
    },
    sourceError(token: SourceToken): boolean {
      if (!sources.markError(token)) return false;
      sourceRevision++;
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
      apply(
        rebaseHistory(
          history,
          (s) => ({
            ...s,
            video1: s.video1.map((v) => (v.id === id ? { ...v, speed } : v)),
          }),
          true,
        ),
      );
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
      if (api.options.editingLocked || api.options.trimDraftOpen) return;
      transaction = null;
      history = { ...history, future: [] };
      publish();
    },
    notifyStructuralChange() {
      revision++;
      changed();
    },
    stagePip(file: File): SourceToken {
      const token = sources.register(file, 'pip');
      pendingPip = token;
      publish();
      return token;
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
      transaction = null;
      pendingPip = null;
      sources.clear();
      history = createHistory(defaults());
      sourceRevision++;
      revision++;
      changed();
    },
    cancelLockedGesture() {
      if (api.options.editingLocked && transaction) {
        transaction = null;
        publish();
      }
    },
    dispose() {
      transaction = null;
      pendingPip = null;
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
