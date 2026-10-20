import type {
  AudioSettings,
  ClipSpeed,
  ClipTrim,
  ProjectFpsSelection,
  OriginalAudioMode,
  OutputWindow,
} from './clips';
import type { IndependentAudioSegment } from './audioTimeline';
import type { OverlaySchedule } from './overlays';
import type { Video2Occurrence, MusicOccurrence } from './advancedTimeline';
import { cloneProjectContext } from './projectContext';
import type { ProjectContext, ProjectEnvelope } from './projectContext';
export type Video1Occurrence = {
  outputWindow?: OutputWindow;
  originalAudio?: OriginalAudioMode;
  id: string;
  sourceId: string;
  trim: ClipTrim | null;
  trimSaved: boolean;
  speed: ClipSpeed;
};
export type PipOccurrence = OverlaySchedule & { id: string; sourceId: string };
export type EditSnapshot = {
  projectContext?: ProjectContext;
  binSourceIds: readonly string[];
  independentAudio: readonly IndependentAudioSegment[];
  video1: readonly Video1Occurrence[];
  video2: readonly Video2Occurrence[];
  musicSourceId: string | null;
  music: readonly MusicOccurrence[];
  pip: PipOccurrence | null;
  audio: AudioSettings;
  fpsSelection: ProjectFpsSelection;
};
export type LegacyEditSnapshot = Omit<
  EditSnapshot,
  'binSourceIds' | 'independentAudio'
> &
  Partial<Pick<EditSnapshot, 'binSourceIds' | 'independentAudio'>>;
export type HistoryAction =
  | 'project-open'
  | 'bin-import'
  | 'bin-remove'
  | 'overwrite'
  | 'detach-audio'
  | `independent-${'place' | 'move' | 'trim' | 'split' | 'lift' | 'ripple-delete' | 'replace'}`
  | `video2-${'add' | 'replace' | 'move' | 'source-trim' | 'trim' | 'speed' | 'split' | 'ripple-delete'}`
  | `music-${'add' | 'replace' | 'move' | 'trim' | 'split' | 'ripple-delete' | 'remove'}`
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
export function normalizeSnapshot(
  s: EditSnapshot | LegacyEditSnapshot,
): EditSnapshot {
  return {
    ...(s.projectContext
      ? { projectContext: cloneProjectContext(s.projectContext) }
      : {}),
    binSourceIds: [...(s.binSourceIds ?? [])],
    independentAudio: (s.independentAudio ?? []).map((v) => ({
      ...v,
      source: { ...v.source },
      ...(v.detachedFrom ? { detachedFrom: { ...v.detachedFrom } } : {}),
    })),
    video2: (s.video2 ?? []).map((v) => ({
      ...v,
      originalAudio: v.originalAudio ?? 'linked',
      trim: { ...v.trim },
    })),
    musicSourceId: s.musicSourceId ?? null,
    music: (s.music ?? []).map((v) => ({ ...v })),
    video1: s.video1.map((v) => ({
      id: v.id,
      sourceId: v.sourceId,
      trim: v.trim
        ? { startFrame: v.trim.startFrame, endFrame: v.trim.endFrame }
        : null,
      trimSaved: v.trimSaved,
      speed: v.speed,
      originalAudio: v.originalAudio ?? 'linked',
      ...(v.outputWindow ? { outputWindow: { ...v.outputWindow } } : {}),
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
const copy = normalizeSnapshot;
export function snapshotsEqual(a: EditSnapshot, b: EditSnapshot): boolean {
  return (
    JSON.stringify({ ...copy(a), projectContext: undefined }) ===
    JSON.stringify({ ...copy(b), projectContext: undefined })
  );
}
export function commitProjectReplacement(
  h: EditHistory,
  next: ProjectEnvelope,
): EditHistory {
  const after = copy(next);
  return {
    past: [
      ...h.past,
      {
        action: 'project-open' as const,
        label: 'Open Project',
        before: h.present,
        after,
      },
    ].slice(-30),
    present: after,
    future: [],
  };
}
export function createHistory(
  initial: EditSnapshot | LegacyEditSnapshot,
): EditHistory {
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
  incarnationId?: string,
): EditHistory {
  const apply = (s: EditSnapshot) =>
    incarnationId && s.projectContext?.incarnationId !== incarnationId
      ? s
      : copy(rewrite(s));
  const rebase = (e: HistoryEntry) => ({
    ...e,
    before: apply(e.before),
    after: apply(e.after),
  });
  return {
    past: h.past.map(rebase),
    present: apply(h.present),
    future: userEdit ? [] : h.future.map(rebase),
  };
}
