import type {
  AudioSettings,
  ClipSpeed,
  ClipTrim,
  ProjectFpsSelection,
} from './clips';
import type { OverlaySchedule } from './overlays';
export type Video1Occurrence = {
  id: string;
  sourceId: string;
  trim: ClipTrim | null;
  trimSaved: boolean;
  speed: ClipSpeed;
};
export type PipOccurrence = OverlaySchedule & { id: string; sourceId: string };
export type EditSnapshot = {
  video1: readonly Video1Occurrence[];
  pip: PipOccurrence | null;
  audio: AudioSettings;
  fpsSelection: ProjectFpsSelection;
};
export type HistoryAction =
  | 'reorder'
  | 'trim'
  | 'split'
  | 'ripple-delete'
  | 'version-replace'
  | 'pip-add'
  | 'pip-replace'
  | 'pip-remove'
  | 'pip-position'
  | 'pip-size'
  | 'audio-volume'
  | 'audio-mute'
  | 'fps';
export type HistoryEntry = {
  action: HistoryAction;
  label: string;
  before: EditSnapshot;
  after: EditSnapshot;
};
export type EditHistory = {
  past: readonly HistoryEntry[];
  present: EditSnapshot;
  future: readonly HistoryEntry[];
};
export type GestureToken = string;
export type HistoryControls = {
  canUndo: boolean;
  canRedo: boolean;
  shortcutsAllowed: boolean;
  undo: () => boolean;
  redo: () => boolean;
};
function copy(s: EditSnapshot): EditSnapshot {
  return {
    video1: s.video1.map((v) => ({
      id: v.id,
      sourceId: v.sourceId,
      trim: v.trim
        ? { startFrame: v.trim.startFrame, endFrame: v.trim.endFrame }
        : null,
      trimSaved: v.trimSaved,
      speed: v.speed,
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
}
export function snapshotsEqual(a: EditSnapshot, b: EditSnapshot): boolean {
  return JSON.stringify(copy(a)) === JSON.stringify(copy(b));
}
export function createHistory(initial: EditSnapshot): EditHistory {
  return { past: [], present: copy(initial), future: [] };
}
export function commitHistory(
  h: EditHistory,
  action: HistoryAction,
  label: string,
  next: EditSnapshot,
): EditHistory {
  if (snapshotsEqual(h.present, next)) return h;
  const after = copy(next);
  return {
    past: [...h.past, { action, label, before: h.present, after }].slice(-30),
    present: after,
    future: [],
  };
}
export function undoHistory(h: EditHistory): EditHistory {
  const entry = h.past.at(-1);
  return entry
    ? {
        past: h.past.slice(0, -1),
        present: entry.before,
        future: [...h.future, entry],
      }
    : h;
}
export function redoHistory(h: EditHistory): EditHistory {
  const entry = h.future.at(-1);
  return entry
    ? {
        past: [...h.past, entry],
        present: entry.after,
        future: h.future.slice(0, -1),
      }
    : h;
}
export function rebaseHistory(
  h: EditHistory,
  rewrite: (s: EditSnapshot) => EditSnapshot,
  userEdit: boolean,
): EditHistory {
  const rebase = (e: HistoryEntry) => ({
    ...e,
    before: copy(rewrite(e.before)),
    after: copy(rewrite(e.after)),
  });
  return {
    past: h.past.map(rebase),
    present: copy(rewrite(h.present)),
    future: userEdit ? [] : h.future.map(rebase),
  };
}
