import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EditSnapshot, GestureToken } from '../lib/editHistory';
import type { ProjectSources } from '../lib/projectSources';
import type { AdvancedTimelineProjection } from '../lib/advancedTimeline';
import type { TimelineSelection } from '../lib/timeline';
import type {
  AudioSegmentEdit,
  AudioTarget,
  IndependentAudioSegment,
} from '../lib/audioTimeline';
import { resolveAudioOwnership } from '../lib/audioTimeline';
import type { AudioSplitTarget } from '../lib/audioSplit';
import type { EditResult } from '../lib/positionedEdits';
import { TimelineDropZone } from './MediaBin';
import type { SourcePlacementActions } from './MediaBin';

export type IndependentAudioActions = {
  onSplit?: (
    target: AudioSplitTarget,
    frame: number,
  ) => EditResult<{ leftId: string; rightId: string }>;
  onReplaceMusicFile?: (id: string, file: File) => void;
  onLiftMusic?: (id: string) => void;
  snapshot: EditSnapshot;
  sources: ProjectSources;
  onEdit: (edit: AudioSegmentEdit) => boolean;
  onSave: (segment: IndependentAudioSegment) => boolean;
  onDetach: (target: AudioTarget) => boolean;
  onReplaceFile: (id: string, file: File) => void;
  onBegin: (id: string, edge: 'start' | 'end' | null) => GestureToken | null;
  onPreview: (token: GestureToken, edit: AudioSegmentEdit) => boolean;
  onEnd: (token: GestureToken, accept: boolean) => void;
  onError: (message: string) => void;
};
type Props = {
  snapshot: EditSnapshot;
  sources: ProjectSources;
  projection: AdvancedTimelineProjection;
  selection: TimelineSelection;
  disabled: boolean;
  onSelect: (value: TimelineSelection) => void;
  onEdit: (edit: AudioSegmentEdit) => boolean;
  placement?: SourcePlacementActions;
  actions?: IndependentAudioActions;
};
export function IndependentAudioTrack(props: Props) {
  const { snapshot, sources, projection, disabled, selection } = props;
  const lane = useRef<HTMLDivElement>(null),
    drag = useRef<{
      id: string;
      pointer: number;
      x: number;
      scale: number;
      start: number;
      edge: 'start' | 'end' | null;
      token: GestureToken;
      valid: boolean;
      delta: number;
    } | null>(null);
  const end = useRef(props.actions?.onEnd);
  useLayoutEffect(() => {
    end.current = props.actions?.onEnd;
  }, [props.actions?.onEnd]);
  const [ghost, setGhost] = useState<{
    id: string;
    delta: number;
    valid: boolean;
  } | null>(null);
  const cancel = () => {
    if (drag.current) end.current?.(drag.current.token, false);
    drag.current = null;
    setGhost(null);
  };
  useEffect(() => {
    if (disabled && drag.current) {
      end.current?.(drag.current.token, false);
      drag.current = null;
      setGhost(null);
    }
  }, [disabled]);
  useEffect(
    () => () => {
      if (drag.current) end.current?.(drag.current.token, false);
      drag.current = null;
    },
    [],
  );
  const begin = (
    e: ReactPointerEvent<HTMLButtonElement>,
    v: IndependentAudioSegment,
    edge: 'start' | 'end' | null,
  ) => {
    if (disabled || e.button !== 0 || drag.current || !props.actions) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus();
    const width = lane.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0 || !projection.displayFrames) return;
    const token = props.actions.onBegin(v.id, edge);
    if (!token) return;
    drag.current = {
      id: v.id,
      pointer: e.pointerId,
      x: e.clientX,
      scale: projection.displayFrames / width,
      start: v.timelineStartFrame,
      edge,
      token,
      valid: true,
      delta: 0,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const events = {
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointer) return;
      const delta = Math.round((e.clientX - d.x) * d.scale);
      d.delta = delta;
      d.valid =
        props.actions?.onPreview(
          d.token,
          d.edge
            ? { action: 'trim', id: d.id, edge: d.edge, deltaFrames: delta }
            : { action: 'move', id: d.id, startFrame: d.start + delta },
        ) ?? false;
      setGhost({ id: d.id, delta, valid: d.valid });
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointer) return;
      drag.current = null;
      setGhost(null);
      end.current?.(d.token, d.valid && !disabled);
      if (!d.valid)
        props.actions?.onError(
          'The audio gesture was cancelled. Repair its source range or overlap.',
        );
      if (e.currentTarget.hasPointerCapture?.(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: () => {
      if (drag.current) cancel();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape' && drag.current) {
        e.preventDefault();
        cancel();
      }
    },
  };
  const geometry = (start: number, length: number) => ({
    left: `${(start / Math.max(1, projection.displayFrames)) * 100}%`,
    width: `${(length / Math.max(1, projection.displayFrames)) * 100}%`,
  });
  const linked = resolveAudioOwnership(snapshot, projection).filter(
    (v) =>
      v.source && !snapshot.independentAudio.some((s) => s.id === v.ownerId),
  );
  return (
    <section className="timeline-track" aria-label="AUDIO 1">
      <h3 id="independent-audio-header" tabIndex={-1}>
        Original/Replacement Audio
      </h3>
      <TimelineDropZone
        laneRef={lane}
        placement={props.placement}
        track="independent"
        label="Original/Replacement Audio drop target"
        displayFrames={projection.displayFrames}
        disabled={disabled}
        className="track-content positioned-lane"
      >
        {linked.map((v) => (
          <button
            key={`${v.ownerId}:${v.startFrame}`}
            type="button"
            className="timeline-block audio-block"
            style={geometry(v.startFrame, v.endFrameExclusive - v.startFrame)}
            aria-label={`Original audio: ${sources.get(v.source!.sourceId)?.file.name ?? 'unavailable source'}`}
            aria-pressed={
              selection.kind === 'audio' && selection.track === 'original'
            }
            onClick={() => props.onSelect({ kind: 'audio', track: 'original' })}
          >
            Linked audio<small>Sound presence unknown</small>
          </button>
        ))}
        {snapshot.independentAudio.map((v) => {
          const name =
              sources.get(v.source.sourceId)?.file.name ?? 'Missing source',
            status = v.detachedFrom ? 'Detached' : 'Replacement';
          return (
            <div
              key={v.id}
              className="timeline-video-card positioned-card independent-audio-card"
              style={geometry(v.timelineStartFrame, v.durationFrames)}
            >
              <button
                type="button"
                id={`timeline-segment-${v.id}`}
                className="timeline-block audio-block"
                aria-label={`Original/Replacement Audio ${name}: start ${v.timelineStartFrame}, ${v.durationFrames} frames, ${status}`}
                aria-pressed={
                  selection.kind === 'independent' && selection.id === v.id
                }
                onClick={() =>
                  props.onSelect({ kind: 'independent', id: v.id })
                }
                onPointerDown={(e) => begin(e, v, null)}
                {...events}
              >
                {name}
                <small>
                  {status} · {v.timelineStartFrame} f · {v.durationFrames}{' '}
                  frames
                </small>
              </button>
              {(['start', 'end'] as const).map((edge) => (
                <button
                  key={edge}
                  type="button"
                  disabled={disabled || !props.actions}
                  className={`timeline-trim-handle ${edge === 'start' ? 'trim-left' : 'trim-right'}`}
                  aria-label={`Trim ${edge} of independent audio ${name}`}
                  onPointerDown={(e) => begin(e, v, edge)}
                  {...events}
                />
              ))}
              {ghost?.id === v.id && (
                <span
                  role="status"
                  className={`position-ghost${ghost.valid ? '' : ' invalid'}`}
                >
                  {ghost.valid ? 'Preview' : 'Invalid range'} {ghost.delta} f
                </span>
              )}
            </div>
          );
        })}
        {!linked.length && !snapshot.independentAudio.length && (
          <span>No independent or linked original audio</span>
        )}
      </TimelineDropZone>
    </section>
  );
}

export function IndependentAudioEditor({
  segment,
  actions,
  disabled,
}: {
  segment: IndependentAudioSegment;
  actions: IndependentAudioActions;
  disabled: boolean;
}) {
  const [start, setStart] = useState(segment.timelineStartFrame),
    [duration, setDuration] = useState(segment.durationFrames),
    [offset, setOffset] = useState(segment.sourceStartSample),
    [error, setError] = useState('');
  return (
    <div className="positioned-editor" aria-label="Independent audio editor">
      <p>
        {actions.sources.get(segment.source.sourceId)?.file.name} ·{' '}
        {segment.detachedFrom ? 'Detached' : 'Replacement'} audio
      </p>
      {(
        [
          ['Audio timeline start frame', start, setStart],
          ['Audio duration frames', duration, setDuration],
          ['Audio source start sample', offset, setOffset],
        ] as const
      ).map(([label, value, setter]) => (
        <label key={label}>
          {label}
          <input
            aria-label={label}
            type="number"
            min={label === 'Audio duration frames' ? 1 : 0}
            step="1"
            disabled={disabled}
            value={value}
            onChange={(e) => setter(Number(e.target.value))}
          />
        </label>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (
            !actions.onSave({
              ...segment,
              timelineStartFrame: start,
              durationFrames: duration,
              sourceStartSample: offset,
            })
          )
            setError('Repair the audio range or overlap before saving.');
        }}
      >
        Save audio range
      </button>
      <button
        type="button"
        disabled={disabled || segment.timelineStartFrame < 1}
        onClick={() =>
          actions.onEdit({
            action: 'move',
            id: segment.id,
            startFrame: segment.timelineStartFrame - 1,
          })
        }
      >
        Move audio earlier one frame
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          actions.onEdit({
            action: 'move',
            id: segment.id,
            startFrame: segment.timelineStartFrame + 1,
          })
        }
      >
        Move audio later one frame
      </button>
      <label>
        Replace Audio
        <input
          type="file"
          aria-label="Replace Audio"
          accept=".wav,.mp3,.aac,.m4a"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) actions.onReplaceFile(segment.id, file);
            e.target.value = '';
          }}
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => actions.onEdit({ action: 'lift', id: segment.id })}
      >
        Lift selected audio
      </button>
      <button
        type="button"
        disabled={disabled}
        title="Ripple Delete on Original/Replacement Audio only"
        onClick={() =>
          actions.onEdit({ action: 'ripple-delete', id: segment.id })
        }
      >
        Ripple Delete audio lane
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
