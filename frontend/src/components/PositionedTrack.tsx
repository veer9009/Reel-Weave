import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AdvancedTimelineProjection } from '../lib/advancedTimeline';
import { placementLength } from '../lib/advancedTimeline';
import type { PositionedTrack as Track } from '../lib/positionedEdits';
import type { TimelineSelection } from '../lib/timeline';
import type { GestureToken } from '../lib/editHistory';
import { TimelineDropZone } from './MediaBin';
import type { SourcePlacementActions } from './MediaBin';
import type { AudioTarget } from '../lib/audioTimeline';

export type PositionedActions = {
  onFileDrop: (track: Track, file: File, startFrame: number) => void;
  onMove: (track: Track, id: string, startFrame: number) => void;
  onMoveBegin: (track: Track, id: string) => GestureToken | null;
  onMovePreview: (
    token: GestureToken,
    track: Track,
    id: string,
    startFrame: number,
  ) => boolean;
  onTrimBegin: (track: Track, id: string) => GestureToken | null;
  onTrimPreview: (
    token: GestureToken,
    track: Track,
    id: string,
    edge: 'start' | 'end',
    delta: number,
  ) => boolean;
  onEnd: (token: GestureToken, accept: boolean) => void;
  onError: (message: string) => void;
};
export type PositionedTrackProps = {
  onVideoContextMenu?: (target: AudioTarget, x: number, y: number) => void;
  placement?: SourcePlacementActions;
  track: Track;
  projection: AdvancedTimelineProjection;
  selection: TimelineSelection;
  disabled: boolean;
  onSelect: (selection: TimelineSelection) => void;
  onSeek: (frame: number) => void;
  onFileDrop: (file: File, startFrame: number) => void;
  onMove: (id: string, startFrame: number) => void;
  onError: (message: string) => void;
  onMoveBegin?: (track: Track, id: string) => GestureToken | null;
  onMovePreview?: PositionedActions['onMovePreview'];
  onTrimBegin?: PositionedActions['onTrimBegin'];
  onTrimPreview?: PositionedActions['onTrimPreview'];
  onEnd?: PositionedActions['onEnd'];
};
type Drag = {
  id: string;
  pointerId: number;
  x: number;
  scale: number;
  start: number;
  token: GestureToken | null;
  edge: 'start' | 'end' | null;
  delta: number;
  valid: boolean;
};
export function PositionedTrack(props: PositionedTrackProps) {
  const { track, projection, selection, disabled } = props;
  const lane = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{
    id: string;
    delta: number;
    valid: boolean;
    edge: 'start' | 'end' | null;
  } | null>(null);
  const endRef = useRef(props.onEnd);
  useEffect(() => {
    endRef.current = props.onEnd;
  });
  const cancel = () => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (d?.token) props.onEnd?.(d.token, false);
  };
  useEffect(() => {
    if (disabled && drag.current) {
      const d = drag.current;
      drag.current = null;
      setGhost(null);
      if (d.token) endRef.current?.(d.token, false);
    }
  }, [disabled]);
  useEffect(
    () => () => {
      const d = drag.current;
      if (d?.token) endRef.current?.(d.token, false);
      drag.current = null;
    },
    [],
  );
  const items = track === 'video2' ? projection.video2 : projection.music;
  const label = track === 'video2' ? 'Video 2' : 'Background music';
  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    position: number,
    edge: Drag['edge'],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || event.button !== 0 || drag.current) return;
    event.currentTarget.focus();
    const width = lane.current?.getBoundingClientRect().width ?? 0;
    if (!width || !projection.displayFrames) return;
    const begin = edge ? props.onTrimBegin : props.onMoveBegin;
    const token = begin?.(track, id) ?? null;
    if (begin && !token) return;
    drag.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      scale: projection.displayFrames / width,
      start: position,
      token,
      edge,
      delta: 0,
      valid: true,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId || disabled) return;
    d.delta = Math.round((event.clientX - d.x) * d.scale);
    d.valid = d.edge !== null || d.start + d.delta >= 0;
    if (d.token) {
      const accepted = d.edge
        ? props.onTrimPreview?.(d.token, track, d.id, d.edge, d.delta)
        : props.onMovePreview?.(d.token, track, d.id, d.start + d.delta);
      if (accepted === false) d.valid = false;
    }
    setGhost({ id: d.id, delta: d.delta, valid: d.valid, edge: d.edge });
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = null;
    setGhost(null);
    suppressClick.current = d.delta !== 0;
    if (d.token) props.onEnd?.(d.token, d.valid && !disabled);
    else if (!d.edge && d.delta && d.valid && !disabled)
      props.onMove(d.id, d.start + d.delta);
    if (!d.valid)
      props.onError(
        'Invalid range: clips cannot overlap or extend beyond their source/project. The gesture was cancelled.',
      );
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const events = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onLostPointerCapture: () => {
      if (drag.current) cancel();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (
        track === 'video2' &&
        (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      ) {
        event.preventDefault();
        const r = event.currentTarget.getBoundingClientRect(),
          id = event.currentTarget.dataset.occurrenceId;
        if (id)
          props.onVideoContextMenu?.({ track: 'video2', id }, r.left, r.bottom);
      }
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        cancel();
      }
    },
  };
  return (
    <section
      className="timeline-track"
      aria-label={track === 'video2' ? 'VIDEO 2' : 'AUDIO 2'}
    >
      <h3 id={`${track}-header`} tabIndex={-1}>
        {track === 'video2' ? 'Video 2 — Replacement' : 'Background music'}
      </h3>
      <TimelineDropZone
        placement={props.placement}
        track={track}
        displayFrames={projection.displayFrames}
        disabled={disabled}
        laneRef={lane}
        className="track-content positioned-lane"
        label={
          track === 'video2'
            ? 'Video 2 replacement drop target'
            : 'Background music drop target'
        }
        onLegacyDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (disabled) return;
          if (!event.dataTransfer.types.includes('Files')) {
            props.onError(
              'Moving occurrences between tracks is not supported.',
            );
            return;
          }
          const files = Array.from(event.dataTransfer.files);
          if (files.length !== 1) {
            props.onError(`Drop one ${label} file at a time.`);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const point = Number.isFinite(event.clientX)
            ? Math.floor(
                ((event.clientX - rect.left) / Math.max(1, rect.width)) *
                  projection.displayFrames +
                  0.5,
              )
            : 0;
          if (point < 0) {
            props.onError('Choose a nonnegative timeline start.');
            return;
          }
          props.onFileDrop(files[0], point);
        }}
      >
        {projection.displayFrames > projection.base.totalFrames && (
          <div
            className="export-tail"
            aria-hidden="true"
            style={{
              left: `${(projection.base.totalFrames / projection.displayFrames) * 100}%`,
            }}
          />
        )}
        {!items.length && (
          <span>
            {track === 'video2'
              ? 'Drop alternate/corrected take here'
              : 'No background music'}
          </span>
        )}
        {items.map((v) => {
          const name = 'clip' in v ? v.clip.file.name : v.file.name;
          const length = placementLength(v),
            end = v.timelineStartFrame + length - 1;
          const invalid =
            track === 'video2' && end >= projection.base.totalFrames;
          const kind = track === 'video2' ? 'replacement' : 'music';
          return (
            <div
              key={v.id}
              data-positioned-id={v.id}
              className={`timeline-video-card positioned-card ${invalid ? 'invalid' : ''}`}
              style={{
                left: `${(v.timelineStartFrame / Math.max(1, projection.displayFrames)) * 100}%`,
                width: `${(length / Math.max(1, projection.displayFrames)) * 100}%`,
              }}
            >
              <button
                id={`timeline-segment-${v.id}`}
                data-occurrence-id={v.id}
                onContextMenu={(event) => {
                  if (track === 'video2') {
                    event.preventDefault();
                    props.onVideoContextMenu?.(
                      { track: 'video2', id: v.id },
                      event.clientX,
                      event.clientY,
                    );
                  }
                }}
                type="button"
                className="timeline-block video-block"
                aria-label={`Select ${label} ${name}: frames ${v.timelineStartFrame}–${end}${invalid ? ' — Invalid range' : ''}`}
                aria-pressed={selection.kind === kind && selection.id === v.id}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  props.onSelect({ kind, id: v.id });
                  if (projection.base.totalFrames)
                    props.onSeek(
                      Math.min(
                        v.timelineStartFrame,
                        projection.base.totalFrames - 1,
                      ),
                    );
                }}
                onPointerDown={(event) =>
                  start(event, v.id, v.timelineStartFrame, null)
                }
                {...events}
              >
                {name}
                {'originalAudio' in v && v.originalAudio === 'detached' && (
                  <small>Detached audio</small>
                )}
                <small>
                  Frames {v.timelineStartFrame}–{end}
                  {invalid ? ' · Invalid range' : ''}
                </small>
              </button>
              {(['start', 'end'] as const).map((edge) => (
                <button
                  key={edge}
                  type="button"
                  className={`timeline-trim-handle ${edge === 'start' ? 'trim-left' : 'trim-right'}`}
                  aria-label={`Trim ${edge} of ${label} ${name}`}
                  disabled={disabled || !props.onTrimBegin}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) =>
                    start(event, v.id, v.timelineStartFrame, edge)
                  }
                  {...events}
                />
              ))}
              {ghost?.id === v.id && (
                <span
                  className={`position-ghost ${ghost.valid ? '' : 'invalid'}`}
                  aria-hidden="true"
                >
                  {ghost.valid ? 'Preview' : 'Invalid range'}{' '}
                  {ghost.delta > 0 ? '+' : ''}
                  {ghost.delta} f
                </span>
              )}
            </div>
          );
        })}
      </TimelineDropZone>
    </section>
  );
}
