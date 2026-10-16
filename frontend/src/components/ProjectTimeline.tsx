import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AudioSettings,
  ClipTrim,
  ProjectFpsSelection,
} from '../lib/clips';
import { formatTimestamp } from '../lib/clips';
import { validateOverlaySchedule } from '../lib/overlays';
import type { OverlayState } from '../lib/overlays';
import type { TimelineProjection, TimelineSelection } from '../lib/timeline';
import type { BackgroundAudio } from './BackgroundAudioTrack';
import { TimelineTrimHandle } from './TimelineTrimHandle';
import type { TrimTransactions } from './TimelineTrimHandle';
import './ProjectTimeline.css';
import { PositionedTrack } from './PositionedTrack';
import type { PositionedActions } from './PositionedTrack';
import type { AdvancedTimelineProjection } from '../lib/advancedTimeline';
import { TimelineDropZone } from './MediaBin';
import type { SourcePlacementActions } from './MediaBin';
import { IndependentAudioTrack } from './IndependentAudioTrack';
import type { IndependentAudioActions } from './IndependentAudioTrack';
import type { AudioTarget } from '../lib/audioTimeline';
type Props = TrimTransactions & {
  audioActions?: IndependentAudioActions;
  onVideoContextMenu?: (target: AudioTarget, x: number, y: number) => void;
  placement?: SourcePlacementActions;
  videoToolbar?: ReactNode;
  videoToolbarHelp?: ReactNode;
  advanced?: AdvancedTimelineProjection;
  positionedActions?: PositionedActions;
  timeline: TimelineProjection;
  overlays: OverlayState;
  backgroundAudio: BackgroundAudio | null;
  audioSettings: AudioSettings;
  selection: TimelineSelection;
  frame: number | null;
  fpsSelection: ProjectFpsSelection;
  disabled: boolean;
  onFpsSelectionChange: (selection: ProjectFpsSelection) => void;
  onSeek: (frame: number) => void;
  onSelect: (selection: TimelineSelection) => void;
  onPipDrop?: (file: File) => void;
  onMove?: (from: number, to: number) => void;
  onTrim?: (id: string, trim: ClipTrim) => void;
};
export function ProjectTimeline({
  videoToolbar,
  videoToolbarHelp,
  advanced,
  positionedActions,
  placement,
  audioActions,
  onVideoContextMenu,
  timeline,
  overlays,
  backgroundAudio,
  audioSettings,
  selection,
  frame,
  fpsSelection,
  disabled,
  onFpsSelectionChange,
  onSeek,
  onSelect,
  onPipDrop,
  onMove,
  onTrim,
  onTrimBegin,
  onTrimPreview,
  onTrimEnd,
}: Props) {
  const [draggingPip, setDraggingPip] = useState(false);
  const [trimScaleFrames, setTrimScaleFrames] = useState<number | null>(null);
  const draggedClip = useRef<string | null>(null);
  const [clipDropTarget, setClipDropTarget] = useState<string | null>(null);
  const clipDragType = 'application/x-avstudio-clip';
  const total = timeline.totalFrames;
  const displayFrames = trimScaleFrames ?? advanced?.displayFrames ?? total;
  const projection: AdvancedTimelineProjection = advanced ?? {
    base: timeline,
    video2: [],
    music:
      backgroundAudio?.duration && timeline.fps
        ? [
            {
              id: 'legacy-music',
              sourceId: 'legacy-music',
              file: backgroundAudio.file,
              url: backgroundAudio.url,
              sampleCount: Math.round(backgroundAudio.duration * 48000),
              timelineStartFrame: 0,
              sourceStartSample: 0,
              durationFrames: Math.ceil(
                backgroundAudio.duration * timeline.fps,
              ),
            },
          ]
        : [],
    resolved: timeline.items.map((v) => ({
      startFrame: v.startFrame,
      endFrameExclusive: v.endFrame + 1,
      track: 'video1',
      occurrenceId: v.clip.id,
      sourceId: v.clip.id,
      contentStartFrame: 0,
    })),
    displayFrames: total,
    renderErrors: [],
  };
  const dropDisabled = disabled || total < 1 || !onPipDrop;
  const geometry = (start: number, count: number) => ({
    left: `${displayFrames ? (start / displayFrames) * 100 : 0}%`,
    width: `${displayFrames ? (count / displayFrames) * 100 : 0}%`,
  });
  const choose = (value: TimelineSelection, start?: number) => {
    onSelect(value);
    if (start !== undefined) onSeek(start);
  };
  const selected = (kind: 'image' | 'video') =>
    selection.kind === 'overlay' && selection.overlayKind === kind;
  return (
    <section className="project-timeline panel" aria-label="Sequence timeline">
      <div className="timeline-heading">
        <h2>Sequence 01</h2>
        <span>
          {timeline.items.length} clips ·{' '}
          {formatTimestamp(timeline.durationSeconds)}
        </span>
      </div>
      <div className="timeline-settings">
        <label>
          Timeline FPS{' '}
          <select
            aria-label="Timeline FPS"
            value={fpsSelection}
            disabled={disabled}
            onChange={(event) =>
              onFpsSelectionChange(event.target.value as ProjectFpsSelection)
            }
          >
            <option value="auto">Auto (first uploaded clip)</option>
            {[24, 25, 30, 50, 60].map((fps) => (
              <option key={fps} value={fps}>
                {fps} FPS
              </option>
            ))}
          </select>
        </label>
        <output aria-label="Effective timeline FPS">
          {timeline.fps === null
            ? 'Waiting for source FPS'
            : `${timeline.fps} FPS${fpsSelection === 'auto' && timeline.items[0]?.clip.metadata.source === 'browser' ? ' · estimated source' : ''}`}
        </output>
        <p>
          Source trims use source frames; overlay ranges use project frames.
        </p>
      </div>
      {timeline.status === 'unavailable' && (
        <p role="status">Timeline timing unavailable</p>
      )}
      {videoToolbarHelp && (
        <div className="timeline-tools-help">{videoToolbarHelp}</div>
      )}
      <div className={`timeline-workspace${videoToolbar ? ' has-tools' : ''}`}>
        {videoToolbar && (
          <div
            className="timeline-tools"
            role="toolbar"
            aria-label="Timeline Tools"
            aria-orientation="vertical"
          >
            <span className="timeline-tools-title" aria-hidden="true">
              Tools
            </span>
            {videoToolbar}
          </div>
        )}
        <div
          className="timeline-scroll"
          tabIndex={0}
          aria-label="Scrollable timeline"
        >
          <div className="timeline-inner">
            <div className="ruler-row">
              <span className="track-heading">Project frames</span>
              <div className="frame-ruler">
                {total > 0 &&
                  [
                    ...new Set(
                      Array.from({ length: Math.min(9, total) }, (_, i) =>
                        Math.floor(
                          (i * (total - 1)) /
                            Math.max(1, Math.min(9, total) - 1),
                        ),
                      ),
                    ),
                  ].map((tick) => (
                    <span
                      key={tick}
                      style={{ left: `${(tick / displayFrames) * 100}%` }}
                    >
                      {tick} f
                    </span>
                  ))}
                <input
                  aria-label="Timeline position"
                  type="range"
                  min={0}
                  max={Math.max(0, total - 1)}
                  step={1}
                  style={{
                    width: `${displayFrames ? (total / displayFrames) * 100 : 100}%`,
                  }}
                  value={frame ?? 0}
                  disabled={frame === null}
                  aria-valuetext={
                    frame !== null && timeline.fps
                      ? `Frame ${frame} of ${total}, ${formatTimestamp(frame / timeline.fps)}, ${timeline.fps} FPS`
                      : 'No current frame'
                  }
                  onChange={(event) => onSeek(Number(event.target.value))}
                />
              </div>
            </div>
            <div className="timeline-tracks">
              <div
                className="timeline-playhead"
                aria-hidden="true"
                style={{
                  left: `calc(120px + (100% - 120px) * ${displayFrames ? (frame ?? 0) / displayFrames : 0})`,
                }}
              />
              <section className="timeline-track" aria-label="Overlay/PIP">
                <h3>Overlay/PIP</h3>
                <div className="track-content overlay-lanes">
                  {(['video', 'image'] as const).map((kind) => {
                    const overlay = overlays[kind];
                    const error = overlay
                      ? validateOverlaySchedule(overlay, total)
                      : null;
                    return (
                      <div
                        className={`overlay-sublane ${kind === 'video' ? 'pip-drop-target' : ''} ${kind === 'video' && draggingPip && !dropDisabled ? 'dragging' : ''}`}
                        key={kind}
                        aria-label={
                          kind === 'video' ? 'PIP video drop target' : undefined
                        }
                        aria-disabled={
                          kind === 'video' ? dropDisabled : undefined
                        }
                        onDragEnter={(event) => {
                          if (
                            kind !== 'video' ||
                            !event.dataTransfer.types.includes('Files')
                          )
                            return;
                          event.preventDefault();
                          if (!dropDisabled) setDraggingPip(true);
                        }}
                        onDragOver={(event) => {
                          if (
                            kind !== 'video' ||
                            !event.dataTransfer.types.includes('Files')
                          )
                            return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = dropDisabled
                            ? 'none'
                            : 'copy';
                          if (!dropDisabled) setDraggingPip(true);
                        }}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node | null,
                            )
                          )
                            setDraggingPip(false);
                        }}
                        onDrop={(event) => {
                          if (
                            kind !== 'video' ||
                            !event.dataTransfer.types.includes('Files')
                          )
                            return;
                          event.preventDefault();
                          event.stopPropagation();
                          setDraggingPip(false);
                          if (dropDisabled) return;
                          if (event.dataTransfer.files.length !== 1) {
                            positionedActions?.onError(
                              'Drop one PIP video at a time.',
                            );
                            return;
                          }
                          const file = event.dataTransfer.files[0];
                          if (file) onPipDrop?.(file);
                        }}
                      >
                        {overlay && total > 0 ? (
                          <button
                            className={`timeline-block ${error ? 'invalid' : ''}`}
                            style={geometry(
                              Math.max(0, overlay.startFrame),
                              overlay.endFrame - overlay.startFrame + 1,
                            )}
                            aria-label={`Select ${kind === 'video' ? 'PIP' : 'image'} overlay: ${overlay.file.name}`}
                            aria-pressed={selected(kind)}
                            onClick={() =>
                              choose(
                                { kind: 'overlay', overlayKind: kind },
                                overlay.startFrame,
                              )
                            }
                            title={`${overlay.file.name} · Frames ${overlay.startFrame}–${overlay.endFrame}${error ? ` · ${error}` : ''}`}
                          >
                            {kind === 'video' ? 'PIP' : 'Image/logo'} ·{' '}
                            {overlay.file.name}
                            {error ? ' · Invalid range' : ''}
                          </button>
                        ) : (
                          <span>
                            {kind === 'video'
                              ? 'Drop PIP video here'
                              : 'No image/logo overlay'}
                          </span>
                        )}
                        {kind === 'video' &&
                          overlay &&
                          draggingPip &&
                          !dropDisabled && (
                            <span className="pip-replace-hint">
                              Replace PIP video
                            </span>
                          )}
                      </div>
                    );
                  })}
                </div>
              </section>
              <PositionedTrack
                placement={placement}
                onVideoContextMenu={onVideoContextMenu}
                track="video2"
                projection={{ ...projection, displayFrames }}
                selection={selection}
                disabled={disabled}
                onSelect={onSelect}
                onSeek={onSeek}
                onFileDrop={(file, start) =>
                  positionedActions?.onFileDrop('video2', file, start)
                }
                onMove={(id, start) =>
                  positionedActions?.onMove('video2', id, start)
                }
                onMoveBegin={positionedActions?.onMoveBegin}
                onMovePreview={positionedActions?.onMovePreview}
                onTrimBegin={positionedActions?.onTrimBegin}
                onTrimPreview={positionedActions?.onTrimPreview}
                onEnd={positionedActions?.onEnd}
                onError={(message) => positionedActions?.onError(message)}
              />
              <section className="timeline-track" aria-label="VIDEO 1">
                <h3 id="video1-header" tabIndex={-1}>
                  Video 1
                </h3>
                <TimelineDropZone
                  placement={placement}
                  track="video1"
                  displayFrames={displayFrames}
                  disabled={disabled}
                  label="Video 1 source drop target"
                >
                  {timeline.items.length ? (
                    timeline.items.map((item, index) => (
                      <div
                        key={item.clip.id}
                        className="timeline-video-card"
                        style={geometry(item.startFrame, item.frameCount)}
                      >
                        <button
                          id={`timeline-segment-${item.clip.id}`}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            onVideoContextMenu?.(
                              { track: 'video1', id: item.clip.id },
                              event.clientX,
                              event.clientY,
                            );
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === 'ContextMenu' ||
                              (event.shiftKey && event.key === 'F10')
                            ) {
                              event.preventDefault();
                              const r =
                                event.currentTarget.getBoundingClientRect();
                              onVideoContextMenu?.(
                                { track: 'video1', id: item.clip.id },
                                r.left,
                                r.bottom,
                              );
                            }
                          }}
                          className={`timeline-block video-block${clipDropTarget === item.clip.id && !disabled ? ' clip-drop-target' : ''}`}
                          draggable={!disabled && Boolean(onMove)}
                          onDragStart={(event) => {
                            if (disabled || !onMove) {
                              event.preventDefault();
                              return;
                            }
                            draggedClip.current = item.clip.id;
                            event.dataTransfer.setData(
                              clipDragType,
                              item.clip.id,
                            );
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(event) => {
                            if (
                              disabled ||
                              !onMove ||
                              !draggedClip.current ||
                              !event.dataTransfer.types.includes(clipDragType)
                            )
                              return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            if (draggedClip.current !== item.clip.id)
                              setClipDropTarget(item.clip.id);
                          }}
                          onDragLeave={() => setClipDropTarget(null)}
                          onDragEnd={() => {
                            draggedClip.current = null;
                            setClipDropTarget(null);
                          }}
                          onDrop={(event) => {
                            const sourceId = draggedClip.current;
                            draggedClip.current = null;
                            setClipDropTarget(null);
                            if (
                              disabled ||
                              !onMove ||
                              !sourceId ||
                              !event.dataTransfer.types.includes(clipDragType)
                            )
                              return;
                            event.preventDefault();
                            event.stopPropagation();
                            const from = timeline.items.findIndex(
                              (entry) => entry.clip.id === sourceId,
                            );
                            if (from >= 0 && from !== index)
                              onMove(from, index);
                          }}
                          aria-label={`Preview clip ${index + 1}: ${item.clip.file.name}`}
                          aria-pressed={
                            selection.kind === 'clip' &&
                            selection.id === item.clip.id
                          }
                          title={`${item.clip.file.name} · Frames ${item.startFrame}–${item.endFrame} · Source ${item.clip.metadata.fps} FPS`}
                          onClick={() =>
                            choose(
                              { kind: 'clip', id: item.clip.id },
                              item.startFrame,
                            )
                          }
                        >
                          {item.clip.file.name}
                          {item.clip.originalAudio === 'detached' && (
                            <small>Detached audio</small>
                          )}
                          <small>
                            Frames {item.startFrame}–{item.endFrame}
                          </small>
                        </button>
                        {(['startFrame', 'endFrame'] as const).map((edge) => (
                          <TimelineTrimHandle
                            key={edge}
                            clip={item.clip}
                            edge={edge}
                            fps={timeline.fps!}
                            totalFrames={displayFrames}
                            disabled={disabled}
                            onTrim={onTrim}
                            onTrimBegin={onTrimBegin}
                            onTrimPreview={onTrimPreview}
                            onTrimEnd={onTrimEnd}
                            onDragActive={(active) => {
                              setTrimScaleFrames(active ? displayFrames : null);
                              if (active) {
                                draggedClip.current = null;
                                setClipDropTarget(null);
                              }
                            }}
                          />
                        ))}
                      </div>
                    ))
                  ) : (
                    <span>Add ready video clips</span>
                  )}
                </TimelineDropZone>
              </section>
              {audioActions ? (
                <IndependentAudioTrack
                  snapshot={audioActions.snapshot}
                  sources={audioActions.sources}
                  projection={{ ...projection, displayFrames }}
                  selection={selection}
                  disabled={disabled}
                  onSelect={onSelect}
                  onEdit={audioActions.onEdit}
                  actions={audioActions}
                  placement={placement}
                />
              ) : (
                <section className="timeline-track" aria-label="AUDIO 1">
                  <h3>
                    Audio 1{audioSettings.originalMuted && <small>Muted</small>}
                  </h3>
                  <div className="track-content">
                    {projection.resolved.length ? (
                      projection.resolved.map((range) => {
                        const source =
                          range.track === 'video2'
                            ? projection.video2.find(
                                (v) => v.id === range.occurrenceId,
                              )?.clip
                            : timeline.items.find(
                                (v) => v.clip.id === range.occurrenceId,
                              )?.clip;
                        if (!source) return null;
                        const item = {
                          clip: source,
                          startFrame: range.startFrame,
                          frameCount:
                            range.endFrameExclusive - range.startFrame,
                        };
                        return (
                          <button
                            key={`${range.occurrenceId}:${range.startFrame}`}
                            className="timeline-block audio-block"
                            style={geometry(item.startFrame, item.frameCount)}
                            aria-label={`Original audio: ${item.clip.file.name}`}
                            aria-pressed={
                              selection.kind === 'audio' &&
                              selection.track === 'original'
                            }
                            onClick={() =>
                              choose({ kind: 'audio', track: 'original' })
                            }
                          >
                            Original audio<small>Sound presence unknown</small>
                          </button>
                        );
                      })
                    ) : (
                      <span>Original clip audio</span>
                    )}
                  </div>
                </section>
              )}
              <PositionedTrack
                track="music"
                placement={placement}
                projection={{ ...projection, displayFrames }}
                selection={selection}
                disabled={disabled}
                onSelect={onSelect}
                onSeek={onSeek}
                onFileDrop={(file, start) =>
                  positionedActions?.onFileDrop('music', file, start)
                }
                onMove={(id, start) =>
                  positionedActions?.onMove('music', id, start)
                }
                onMoveBegin={positionedActions?.onMoveBegin}
                onMovePreview={positionedActions?.onMovePreview}
                onTrimBegin={positionedActions?.onTrimBegin}
                onTrimPreview={positionedActions?.onTrimPreview}
                onEnd={positionedActions?.onEnd}
                onError={(message) => positionedActions?.onError(message)}
              />
            </div>
            <p className="duration-boundary">
              Export end: {total} f · Duration boundary:{' '}
              {formatTimestamp(timeline.durationSeconds)} · Final selectable
              frame: {total ? total - 1 : 'none'}
            </p>
            {projection.video2
              .filter(
                (v) =>
                  v.timelineStartFrame + v.contentOutFrame - v.contentInFrame >
                  total,
              )
              .map((v) => (
                <p key={v.id} className="invalid-range-message">
                  Video 2 {v.clip.file.name}: range outside Video 1.{' '}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onSelect({ kind: 'replacement', id: v.id })}
                  >
                    Review {v.clip.file.name} range
                  </button>
                </p>
              ))}
          </div>
        </div>
      </div>
    </section>
  );
}
