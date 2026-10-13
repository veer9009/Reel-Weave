import { useEffect, useState, useRef } from 'react';
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
import { planClipSplit } from '../lib/timeline';
import { useProjectPlayback } from '../hooks/useProjectPlayback';
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
type Props = TrimTransactions & {
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
  const [version2Id, setVersion2Id] = useState('');
  const [replacementFrame, setReplacementFrame] = useState<number | null>(null);
  const playback = useProjectPlayback(timeline, structuralRevision);
  if (replacementFrame !== null) {
    playback.seek(replacementFrame);
    setReplacementFrame(null);
  }
  const advanced = props.advanced;
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
    selection.kind === 'clip'
      ? !clips.some((v) => v.id === selection.id)
      : selection.kind === 'overlay'
        ? !overlays[selection.overlayKind]
        : selectedTrack
          ? !selectedPositioned
          : selection.kind === 'audio' && selection.track === 'music'
            ? !backgroundAudio
            : false;
  if (invalid) setSelection({ kind: 'none' });
  const focusAfterDelete = useRef(false);
  useEffect(() => {
    if (focusAfterDelete.current) {
      focusAfterDelete.current = false;
      document
        .querySelector<HTMLButtonElement>(
          'button[title="Undo (Ctrl+Z)"]:not(:disabled)',
        )
        ?.focus();
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
    focusAfterDelete.current = true;
    if (selectedTrack && selectedPositioned)
      props.onDeletePositioned?.(selectedTrack, selectedPositioned.id);
    else if (selectedClipId) onDeleteClip?.(selectedClipId);
  };
  useEffect(() => {
    const deleteKey = (event: KeyboardEvent) => {
      if (
        editingLocked ||
        props.gestureActive ||
        (!selectedClipId && !selectedPositioned) ||
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
  const splitPlan = planClipSplit(
    timeline,
    selectedClip?.id ?? '',
    playback.frame ?? -1,
  );
  const splitReason =
    editingLocked || props.gestureActive
      ? 'Split is unavailable while rendering or after completion. Start a New Project to edit again.'
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
            ? splitPlan.error
            : null;
  const canSplit = Boolean(
    (selectedPositioned ? props.onSplitPositioned : props.onSplitAtPlayhead) &&
    !splitReason,
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
  return (
    <main className="editing-workspace" aria-label="Editing workspace">
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
          timeline={timeline}
          projection={props.advanced}
          overlays={overlays}
          frame={playback.frame}
          playing={playback.playing}
          onSeek={playback.seek}
          onToggle={playback.toggle}
        />
        <Inspector
          selection={selection}
          replacementContent={
            selectedTrack === 'music' ? (
              <p>Select a Video 2 replacement to edit it.</p>
            ) : (
              positionedInspection
            )
          }
          clipContent={
            <>
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
                      if (typeof nextFrame === 'number')
                        setReplacementFrame(nextFrame);
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
              {selectedTrack === 'music' && positionedInspection}
              {props.audioContent}
            </>
          }
          deliveryContent={props.deliveryContent}
        />
      </div>
      <ProjectTimeline
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
                  playback.pause();
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
                (!selectedClipId && !selectedPositioned)
              }
              onClick={deleteSelected}
              title="Ripple Delete selected (Delete or Backspace)"
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
