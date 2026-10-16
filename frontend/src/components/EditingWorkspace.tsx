import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { Scissors, Undo2, Redo2, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  AudioSettings,
  Clip,
  ClipTrim,
  ProjectFpsSelection,
} from '../lib/clips';
import { isEditableClip } from '../lib/clips';
import type { OverlayState } from '../lib/overlays';
import { validateOverlaySchedule } from '../lib/overlays';
import type { TimelineProjection, TimelineSelection } from '../lib/timeline';
import { planClipSplit, planWindowedSplit } from '../lib/timeline';
import { useProjectPlayback } from '../hooks/useProjectPlayback';
import { useProjectAudio } from '../hooks/useProjectAudio';
import type { BackgroundAudio } from './BackgroundAudioTrack';
import { Inspector } from './Inspector';
import { ProgramMonitor } from './ProgramMonitor';
import { PositionedClipEditor } from './PositionedClipEditor';
import type { PositionedActions } from './PositionedTrack';
import type {
  AdvancedTimelineProjection,
  Video2Occurrence,
  MusicOccurrence,
} from '../lib/advancedTimeline';
import { placementLength } from '../lib/advancedTimeline';
import type { PositionedTrack } from '../lib/positionedEdits';
import { ProjectTimeline } from './ProjectTimeline';
import './EditingWorkspace.css';
import type { HistoryControls } from '../lib/editHistory';
import type { TrimTransactions } from './TimelineTrimHandle';
import { useHistoryShortcuts } from '../hooks/useHistoryShortcuts';
import type { SourcePlacementActions } from './MediaBin';
import { IndependentAudioEditor } from './IndependentAudioTrack';
import type { IndependentAudioActions } from './IndependentAudioTrack';
import { canDetach } from '../lib/audioTimeline';
import type { AudioTarget } from '../lib/audioTimeline';
import type { EditHistoryController } from '../hooks/useEditHistory';
type Props = TrimTransactions & {
  transportController?: EditHistoryController;
  audioActions?: IndependentAudioActions;
  placement?: SourcePlacementActions;
  selectionRequest?: {
    serial: number;
    selection: TimelineSelection;
    focusId?: string;
  };
  historyControls?: HistoryControls;
  advanced?: AdvancedTimelineProjection;
  positionedActions?: PositionedActions;
  onAddReplacement?: (
    file: File,
    startFrame: number,
    targetId?: string,
  ) => void;
  onDeletePositioned?: (track: PositionedTrack, id: string) => void;
  onSplitPositioned?: (
    track: PositionedTrack,
    id: string,
    frame: number,
  ) => string | void;
  onSavePositioned?: (
    track: PositionedTrack,
    item: Video2Occurrence | MusicOccurrence,
  ) => boolean;
  onSourceEditPositioned?: (
    id: string,
    trim: ClipTrim,
    speed: 1 | 0.75 | 0.5,
    kind: 'trim' | 'speed',
  ) => boolean;
  gestureActive?: boolean;
  clips: Clip[];
  timeline: TimelineProjection;
  overlays: OverlayState;
  backgroundAudio: BackgroundAudio | null;
  audioSettings: AudioSettings;
  fpsSelection: ProjectFpsSelection;
  structuralRevision: number;
  editingLocked: boolean;
  maxClips?: number;
  onFpsSelectionChange: (fps: ProjectFpsSelection) => void;
  onPipDrop?: (file: File) => void;
  onMove?: (from: number, to: number) => void;
  onTrim?: (id: string, trim: ClipTrim) => void;
  onDeleteClip?: (id: string) => void;
  onSplitAtPlayhead?: (targetId: string, frame: number) => string | void;
  onReplaceAfterPlayhead?: (
    targetId: string,
    sourceId: string,
    frame: number,
  ) => number | void;
  mediaContent: ReactNode;
  clipContent: ReactNode;
  overlayContent: ReactNode;
  audioContent: ReactNode;
  deliveryContent: ReactNode;
  resultContent: ReactNode;
};
export function EditingWorkspace(props: Props) {
  useHistoryShortcuts(
    props.historyControls ?? {
      canUndo: false,
      canRedo: false,
      shortcutsAllowed: false,
      undo: () => false,
      redo: () => false,
    },
  );
  const {
    clips,
    timeline,
    overlays,
    backgroundAudio,
    audioSettings,
    fpsSelection,
    structuralRevision,
    editingLocked,
    onFpsSelectionChange,
  } = props;
  const [selection, setSelection] = useState<TimelineSelection>({
    kind: 'none',
  });
  const [observedRequest, setObservedRequest] = useState(
    props.selectionRequest,
  );
  if (props.selectionRequest !== observedRequest) {
    setObservedRequest(props.selectionRequest);
    if (props.selectionRequest) setSelection(props.selectionRequest.selection);
  }
  useEffect(() => {
    if (!props.selectionRequest) return;
    const value = props.selectionRequest.selection;
    document
      .getElementById(
        props.selectionRequest.focusId ??
          ('id' in value ? `timeline-segment-${value.id}` : ''),
      )
      ?.focus();
  }, [props.selectionRequest]);
  const [version2Id, setVersion2Id] = useState('');
  const replacementFrame = useRef<number | null>(null);
  const playback = useProjectPlayback(
    timeline,
    structuralRevision,
    props.advanced,
  );
  const audioPreview = useProjectAudio({
    snapshot: props.audioActions?.snapshot,
    sources: props.audioActions?.sources,
    projection: props.advanced,
    transport: playback,
  });
  const { captureAnchor, applyEdit, resetPlayback, pause, seek } = playback;
  useEffect(
    () =>
      props.transportController?.bindTransport({
        capture: captureAnchor,
        apply: (anchor, edit) => applyEdit(edit, anchor),
        cancel: resetPlayback,
      }),
    [props.transportController, captureAnchor, applyEdit, resetPlayback],
  );
  useEffect(() => {
    if (editingLocked) pause();
  }, [editingLocked, pause]);
  useLayoutEffect(() => {
    if (replacementFrame.current !== null) {
      const frame = replacementFrame.current;
      replacementFrame.current = null;
      seek(frame);
    }
  });
  const advanced = props.advanced;
  const selectedIndependent =
    selection.kind === 'independent'
      ? props.audioActions?.snapshot.independentAudio.find(
          (v) => v.id === selection.id,
        )
      : undefined;
  const detachTarget: AudioTarget | null =
    selection.kind === 'clip'
      ? { track: 'video1', id: selection.id }
      : selection.kind === 'replacement'
        ? { track: 'video2', id: selection.id }
        : null;
  const detachEligibility =
    detachTarget && props.audioActions && advanced
      ? canDetach(detachTarget, props.audioActions.snapshot, advanced)
      : null;
  const canDetachSelected = Boolean(
    detachEligibility &&
    'value' in detachEligibility &&
    !editingLocked &&
    !props.gestureActive &&
    props.historyControls?.shortcutsAllowed !== false,
  );
  const detachSelected = () => {
    if (canDetachSelected && detachTarget)
      props.audioActions?.onDetach(detachTarget);
  };
  const [context, setContext] = useState<{
    target: AudioTarget;
    x: number;
    y: number;
  } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (context)
      menu.current
        ?.querySelector<HTMLElement>('button:not(:disabled)')
        ?.focus();
  }, [context]);
  const closeContext = () => {
    const id = context?.target.id;
    setContext(null);
    if (id) document.getElementById(`timeline-segment-${id}`)?.focus();
  };
  useEffect(() => {
    const detachKey = (event: KeyboardEvent) => {
      if (
        !canDetachSelected ||
        !event.ctrlKey ||
        !event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'l' ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]',
          ))
      )
        return;
      event.preventDefault();
      detachSelected();
    };
    document.addEventListener('keydown', detachKey);
    return () => document.removeEventListener('keydown', detachKey);
  });
  const selectedTrack: PositionedTrack | null =
    selection.kind === 'replacement'
      ? 'video2'
      : selection.kind === 'music'
        ? 'music'
        : null;
  const selectedPositioned =
    (selection.kind === 'replacement'
      ? advanced?.video2.find((v) => v.id === selection.id)
      : selection.kind === 'music'
        ? advanced?.music.find((v) => v.id === selection.id)
        : null) ?? null;
  const invalid =
    selection.kind === 'independent'
      ? !selectedIndependent
      : selection.kind === 'clip'
        ? !clips.some((v) => v.id === selection.id)
        : selection.kind === 'overlay'
          ? !overlays[selection.overlayKind]
          : selectedTrack
            ? !selectedPositioned
            : selection.kind === 'audio' && selection.track === 'music'
              ? !backgroundAudio
              : false;
  if (invalid) setSelection({ kind: 'none' });
  const focusAfterDelete = useRef<string | null>(null);
  useEffect(() => {
    if (focusAfterDelete.current) {
      const id = focusAfterDelete.current;
      focusAfterDelete.current = null;
      document.getElementById(id)?.focus();
    }
  }, [timeline, advanced]);
  const selectedClip =
    selection.kind === 'clip'
      ? clips.find((clip) => clip.id === selection.id)
      : null;
  const selectedItem = timeline.items.find(
    (item) => item.clip.id === selectedClip?.id,
  );
  const selectedClipId =
    selectedClip && isEditableClip(selectedClip) ? selectedClip.id : null;
  const onDeleteClip = props.onDeleteClip;
  const deleteSelected = () => {
    if (editingLocked || props.gestureActive) return;
    if (selectedIndependent) {
      props.audioActions?.onEdit({
        action: 'lift',
        id: selectedIndependent.id,
      });
      return;
    }
    const values =
      selectedTrack === 'video2'
        ? advanced?.video2
        : selectedTrack === 'music'
          ? advanced?.music
          : timeline.items.map((v) => ({ id: v.clip.id }));
    const index =
      values?.findIndex(
        (v) => v.id === (selectedPositioned?.id ?? selectedClipId),
      ) ?? -1;
    const neighbor = values?.[index + 1] ?? values?.[index - 1];
    focusAfterDelete.current = neighbor
      ? `timeline-segment-${neighbor.id}`
      : selectedTrack === 'video2'
        ? 'video2-header'
        : selectedTrack === 'music'
          ? 'music-header'
          : 'video1-header';
    if (selectedTrack && selectedPositioned)
      props.onDeletePositioned?.(selectedTrack, selectedPositioned.id);
    else if (selectedClipId) onDeleteClip?.(selectedClipId);
  };
  useEffect(() => {
    const deleteKey = (event: KeyboardEvent) => {
      if (
        editingLocked ||
        props.gestureActive ||
        (!selectedClipId && !selectedPositioned && !selectedIndependent) ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== 'Delete' && event.key !== 'Backspace') ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]',
          ))
      )
        return;
      event.preventDefault();
      deleteSelected();
    };
    document.addEventListener('keydown', deleteKey);
    return () => document.removeEventListener('keydown', deleteKey);
  });
  const splitPlan = (
    selectedClip?.outputWindow ? planWindowedSplit : planClipSplit
  )(timeline, selectedClip?.id ?? '', playback.frame ?? -1);
  const splitReason =
    editingLocked || props.gestureActive
      ? 'Split is unavailable while rendering or after completion. Start a New Project to edit again.'
      : selectedIndependent
        ? playback.frame === null ||
          playback.frame <= selectedIndependent.timelineStartFrame ||
          playback.frame >=
            selectedIndependent.timelineStartFrame +
              selectedIndependent.durationFrames
          ? 'Move the playhead strictly inside the selected audio segment.'
          : null
        : selectedPositioned
          ? !playback.frame ||
            playback.frame <= selectedPositioned.timelineStartFrame ||
            playback.frame >=
              selectedPositioned.timelineStartFrame +
                placementLength(selectedPositioned)
            ? 'Move the playhead strictly inside the selected clip.'
            : (selectedTrack === 'music' &&
                  (advanced?.music.length ?? 0) >=
                    10 * (props.maxClips ?? Infinity)) ||
                (selectedTrack === 'video2' &&
                  clips.length + (advanced?.video2.length ?? 0) >=
                    (props.maxClips ?? Infinity))
              ? 'Clip limit reached.'
              : null
          : clips.length + (advanced?.video2.length ?? 0) >=
              (props.maxClips ?? Infinity)
            ? 'Clip limit reached. Remove a clip before splitting.'
            : 'error' in splitPlan
              ? typeof splitPlan.error === 'string'
                ? splitPlan.error
                : splitPlan.error.message
              : null;
  const canSplit = Boolean(
    (selectedIndependent
      ? props.audioActions
      : selectedPositioned
        ? props.onSplitPositioned
        : props.onSplitAtPlayhead) && !splitReason,
  );
  const version2Sources = clips.filter(isEditableClip);
  const version2 = version2Sources.find((clip) => clip.id === version2Id);
  const canReplace =
    !editingLocked &&
    Boolean(
      props.onReplaceAfterPlayhead &&
      selectedItem &&
      version2 &&
      playback.frame !== null &&
      playback.frame > selectedItem.startFrame &&
      playback.frame < selectedItem.endFrame,
    );
  const positionedInspection = (
    <>
      <label>
        Inspect replacement or music
        <select
          aria-label="Inspect positioned clip"
          value={selectedPositioned?.id ?? ''}
          onChange={(event) => {
            const id = event.target.value;
            if (advanced?.video2.some((v) => v.id === id))
              setSelection({ kind: 'replacement', id });
            else if (advanced?.music.some((v) => v.id === id))
              setSelection({ kind: 'music', id });
            else setSelection({ kind: 'none' });
          }}
        >
          <option value="">Choose a positioned clip</option>
          {advanced?.video2.map((v) => (
            <option key={v.id} value={v.id}>
              Video 2: {v.clip.file.name} · {v.timelineStartFrame} f
            </option>
          ))}
          {advanced?.music.map((v) => (
            <option key={v.id} value={v.id}>
              Music: {v.file.name} · {v.timelineStartFrame} f
            </option>
          ))}
        </select>
      </label>
      {selectedPositioned && selectedTrack && timeline.fps ? (
        <>
          <PositionedClipEditor
            key={JSON.stringify(selectedPositioned)}
            track={selectedTrack}
            item={selectedPositioned}
            name={
              'clip' in selectedPositioned
                ? selectedPositioned.clip.file.name
                : selectedPositioned.file.name
            }
            fps={timeline.fps}
            disabled={editingLocked || props.gestureActive === true}
            onSave={(item) =>
              props.onSavePositioned?.(selectedTrack, item) ?? false
            }
            onSourceEdit={(trim, speed, kind) =>
              props.onSourceEditPositioned?.(
                selectedPositioned.id,
                trim,
                speed,
                kind,
              ) ?? false
            }
          />
          <button
            type="button"
            className="secondary-button"
            disabled={
              editingLocked || selectedPositioned.timelineStartFrame === 0
            }
            onClick={() =>
              props.positionedActions?.onMove(
                selectedTrack,
                selectedPositioned.id,
                selectedPositioned.timelineStartFrame - 1,
              )
            }
          >
            Move earlier one frame
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={editingLocked}
            onClick={() =>
              props.positionedActions?.onMove(
                selectedTrack,
                selectedPositioned.id,
                selectedPositioned.timelineStartFrame + 1,
              )
            }
          >
            Move later one frame
          </button>
          {selectedTrack === 'video2' && (
            <label>
              Replace Video 2 source
              <input
                aria-label="Replace Video 2 source"
                type="file"
                accept=".mp4,.mov,.webm,.mkv"
                disabled={editingLocked || timeline.status !== 'ready'}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    props.onAddReplacement?.(
                      file,
                      selectedPositioned.timelineStartFrame,
                      selectedPositioned.id,
                    );
                  event.target.value = '';
                }}
              />
            </label>
          )}
        </>
      ) : (
        <p>Select a Video 2 or music segment to edit its range.</p>
      )}
    </>
  );
  const detachAction = (
    <>
      <button
        type="button"
        disabled={!canDetachSelected}
        title={
          detachEligibility && 'error' in detachEligibility
            ? detachEligibility.error.message
            : 'Detach exposed original audio (Ctrl+Alt+L)'
        }
        aria-keyshortcuts="Control+Alt+L"
        onClick={detachSelected}
      >
        Detach Audio
      </button>
      {detachEligibility && 'error' in detachEligibility && (
        <p>{detachEligibility.error.message}</p>
      )}
    </>
  );
  return (
    <main className="editing-workspace" aria-label="Editing workspace">
      {context && (
        <div
          ref={menu}
          role="menu"
          aria-label="Video clip actions"
          className="clip-context-menu panel"
          style={{
            left: `min(${context.x}px, calc(100vw - 220px))`,
            top: `min(${context.y}px, calc(100dvh - 100px))`,
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              event.preventDefault();
              closeContext();
            }
          }}
        >
          <button
            role="menuitem"
            type="button"
            disabled={!canDetachSelected}
            onClick={() => {
              setContext(null);
              detachSelected();
            }}
          >
            Detach Audio
          </button>
          <button role="menuitem" type="button" onClick={closeContext}>
            Close clip actions
          </button>
        </div>
      )}
      <h1>Sequence 01</h1>
      {(['image', 'video'] as const).map(
        (kind) =>
          overlays[kind] &&
          validateOverlaySchedule(overlays[kind], timeline.totalFrames) && (
            <div className="workspace-validation" role="alert" key={kind}>
              <p>
                {kind === 'image' ? 'Image' : 'Video'} overlay needs attention.
              </p>
              <button
                type="button"
                onClick={() =>
                  setSelection({ kind: 'overlay', overlayKind: kind })
                }
              >
                Review {kind} overlay
              </button>
            </div>
          ),
      )}
      <div className="workspace-panels">
        <section className="media-panel" aria-label="Media">
          {props.mediaContent}
          {props.onAddReplacement && (
            <label className="replacement-upload">
              Add replacement video
              <input
                aria-label="Choose replacement video"
                type="file"
                accept=".mp4,.mov,.webm,.mkv"
                disabled={editingLocked || timeline.status !== 'ready'}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) props.onAddReplacement?.(file, playback.frame ?? 0);
                  event.target.value = '';
                }}
              />
            </label>
          )}
        </section>
        <ProgramMonitor
          audioPreview={props.audioActions ? audioPreview : undefined}
          transport={playback}
          sources={props.transportController?.sources}
          timeline={timeline}
          projection={props.advanced}
          overlays={overlays}
          frame={playback.frame}
          playing={playback.playing}
          onSeek={playback.seek}
          onToggle={() => {
            if (!playback.playingIntent && props.audioActions)
              void audioPreview.resumeAudio();
            playback.toggle();
          }}
        />
        <Inspector
          selection={selection}
          replacementContent={
            selectedTrack === 'music' ? (
              <p>Select a Video 2 replacement to edit it.</p>
            ) : (
              <>
                {positionedInspection}
                {selection.kind === 'replacement' && detachAction}
              </>
            )
          }
          clipContent={
            <>
              {selection.kind === 'clip' && detachAction}
              <label>
                Inspect clip
                <select
                  aria-label="Inspect clip"
                  value={selection.kind === 'clip' ? selection.id : ''}
                  onChange={(event) =>
                    setSelection(
                      event.target.value
                        ? { kind: 'clip', id: event.target.value }
                        : { kind: 'none' },
                    )
                  }
                >
                  <option value="">Choose a clip</option>
                  {clips.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.file.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedClip ? (
                <>
                  <p>Selected: {selectedClip.file.name}</p>
                  {selectedClip.metadata && (
                    <p>
                      Source: {selectedClip.metadata.width} ×{' '}
                      {selectedClip.metadata.height} ·{' '}
                      {selectedClip.metadata.fps} FPS
                      {selectedClip.metadata.source === 'browser'
                        ? ' (browser estimate)'
                        : ''}
                    </p>
                  )}
                  {selectedClip.trim && (
                    <p>
                      Source frames {selectedClip.trim.startFrame}–
                      {selectedClip.trim.endFrame} · Speed{' '}
                      {selectedClip.speed ?? 1}x
                    </p>
                  )}
                </>
              ) : (
                <p>Select a timeline clip to inspect it.</p>
              )}
              {props.clipContent}
              <div aria-label="Video 1 version replacement">
                <label>
                  Version 2 source
                  <select
                    aria-label="Version 2 source"
                    value={version2?.id ?? ''}
                    disabled={editingLocked || !selectedItem}
                    onChange={(event) => setVersion2Id(event.target.value)}
                  >
                    <option value="">Choose an uploaded Video 1 source</option>
                    {version2Sources.map((clip, index) => (
                      <option key={clip.id} value={clip.id}>
                        {clip.file.name} (source {index + 1})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canReplace}
                  onClick={() => {
                    if (
                      canReplace &&
                      selectedClip &&
                      version2 &&
                      playback.frame !== null
                    ) {
                      const nextFrame = props.onReplaceAfterPlayhead?.(
                        selectedClip.id,
                        version2.id,
                        playback.frame,
                      );
                      if (
                        typeof nextFrame === 'number' &&
                        !props.transportController
                      )
                        replacementFrame.current = nextFrame;
                    }
                  }}
                >
                  Replace after playhead
                </button>
                <p>
                  Select a Video 1 clip and place the playhead strictly inside
                  it. The target keeps the cut frame and the donor Video 1
                  occurrence supplies the matching source time. The donor is
                  consumed; other Video 1 clips keep their order.
                </p>
              </div>
            </>
          }
          overlayContent={props.overlayContent}
          audioContent={
            <>
              {selectedIndependent && props.audioActions && (
                <IndependentAudioEditor
                  key={JSON.stringify(selectedIndependent)}
                  segment={selectedIndependent}
                  actions={props.audioActions}
                  disabled={editingLocked || Boolean(props.gestureActive)}
                />
              )}
              {selectedTrack === 'music' && positionedInspection}
              {props.audioContent}
            </>
          }
          deliveryContent={props.deliveryContent}
        />
      </div>
      <ProjectTimeline
        audioActions={
          props.audioActions
            ? {
                ...props.audioActions,
                onBegin: (id, edge) => {
                  playback.pause();
                  return props.audioActions!.onBegin(id, edge);
                },
              }
            : undefined
        }
        onVideoContextMenu={(target, x, y) => {
          setSelection({
            kind: target.track === 'video1' ? 'clip' : 'replacement',
            id: target.id,
          });
          setContext({ target, x, y });
        }}
        placement={props.placement}
        videoToolbar={
          <>
            <button
              type="button"
              className="secondary-button"
              aria-keyshortcuts="Control+Z"
              title="Undo (Ctrl+Z)"
              disabled={!props.historyControls?.canUndo}
              onClick={() => props.historyControls?.undo()}
            >
              <Undo2 size={16} aria-hidden="true" />
              <span className="sr-only">Undo</span>
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-keyshortcuts="Control+Y Control+Shift+Z"
              title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
              disabled={!props.historyControls?.canRedo}
              onClick={() => props.historyControls?.redo()}
            >
              <Redo2 size={16} aria-hidden="true" />
              <span className="sr-only">Redo</span>
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!canSplit}
              title={splitReason ?? 'Split at playhead'}
              aria-describedby={!canSplit ? 'split-reason' : undefined}
              onClick={() => {
                if (!canSplit || playback.frame === null) return;
                if (selectedIndependent) {
                  props.audioActions?.onEdit({
                    action: 'split',
                    id: selectedIndependent.id,
                    frame: playback.frame,
                  });
                  return;
                }
                if (selectedPositioned && selectedTrack) {
                  const right = props.onSplitPositioned?.(
                    selectedTrack,
                    selectedPositioned.id,
                    playback.frame,
                  );
                  if (right)
                    setSelection({
                      kind:
                        selectedTrack === 'video2' ? 'replacement' : 'music',
                      id: right,
                    });
                  return;
                }
                if (!selectedClip) return;
                const rightId = props.onSplitAtPlayhead?.(
                  selectedClip.id,
                  playback.frame,
                );
                if (rightId) {
                  setSelection({ kind: 'clip', id: rightId });
                }
              }}
            >
              <Scissors size={16} aria-hidden="true" />
              <span className="sr-only">Split at playhead</span>
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={
                editingLocked ||
                props.gestureActive ||
                (!selectedClipId && !selectedPositioned && !selectedIndependent)
              }
              onClick={() => {
                if (selectedIndependent)
                  props.audioActions?.onEdit({
                    action: 'ripple-delete',
                    id: selectedIndependent.id,
                  });
                else deleteSelected();
              }}
              title={
                selectedIndependent
                  ? 'Ripple Delete on Original/Replacement Audio only'
                  : 'Ripple Delete selected (Delete or Backspace)'
              }
            >
              <Trash2 size={16} aria-hidden="true" />
              <span className="sr-only">Ripple Delete selected</span>
            </button>
          </>
        }
        videoToolbarHelp={
          <>
            <small>Ctrl+Z · Ctrl+Y / Ctrl+Shift+Z</small>
            {!canSplit && (
              <p id="split-reason">
                Select a Video 1 clip, then click inside it to choose the cut
                point.
              </p>
            )}
          </>
        }
        timeline={timeline}
        advanced={props.advanced}
        positionedActions={
          props.positionedActions
            ? {
                ...props.positionedActions,
                onMoveBegin: (track, id) => {
                  playback.pause();
                  return props.positionedActions!.onMoveBegin(track, id);
                },
                onTrimBegin: (track, id) => {
                  playback.pause();
                  return props.positionedActions!.onTrimBegin(track, id);
                },
              }
            : undefined
        }
        overlays={overlays}
        backgroundAudio={backgroundAudio}
        audioSettings={audioSettings}
        selection={selection}
        frame={playback.frame}
        fpsSelection={fpsSelection}
        disabled={editingLocked}
        onFpsSelectionChange={onFpsSelectionChange}
        onSeek={playback.seek}
        onSelect={setSelection}
        onPipDrop={props.onPipDrop}
        onMove={props.onMove}
        onTrim={props.onTrim}
        onTrimBegin={props.onTrimBegin}
        onTrimPreview={props.onTrimPreview}
        onTrimEnd={props.onTrimEnd}
      />
      <section className="render-region" aria-label="Render result">
        {props.resultContent}
      </section>
    </main>
  );
}
