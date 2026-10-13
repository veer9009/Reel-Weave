import { useState } from 'react';
import type {
  Video2Occurrence,
  MusicOccurrence,
} from '../lib/advancedTimeline';
import type { PositionedTrack } from '../lib/positionedEdits';
import type { ClipTrim, ClipSpeed, ProjectFps } from '../lib/clips';
export function PositionedClipEditor({
  track,
  item,
  name,
  fps,
  disabled,
  onSave,
  onSourceEdit,
}: {
  track: PositionedTrack;
  item: Video2Occurrence | MusicOccurrence;
  name: string;
  fps: ProjectFps;
  disabled: boolean;
  onSave: (item: Video2Occurrence | MusicOccurrence) => boolean;
  onSourceEdit?: (
    trim: ClipTrim,
    speed: ClipSpeed,
    kind: 'trim' | 'speed',
  ) => boolean;
}) {
  const [draft, setDraft] = useState(item),
    [message, setMessage] = useState('');
  const [sourceTrim, setSourceTrim] = useState(
    'trim' in item ? item.trim : { startFrame: 0, endFrame: 0 },
  );
  const field = (
    label: string,
    key:
      | 'timelineStartFrame'
      | 'contentInFrame'
      | 'contentOutFrame'
      | 'sourceStartSample'
      | 'durationFrames',
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min="0"
        step="1"
        disabled={disabled}
        value={(draft as unknown as Record<string, number>)[key]}
        onChange={(event) =>
          setDraft({ ...draft, [key]: Number(event.target.value) })
        }
      />
    </label>
  );
  return (
    <section
      className="positioned-editor"
      aria-label={`${track === 'video2' ? 'Video 2' : 'Music'} range editor`}
    >
      <h3>{name}</h3>
      <p>
        Timeline ranges use {fps} project FPS. End/content out is exclusive.
      </p>
      {field('Timeline start frame', 'timelineStartFrame')}
      {'contentInFrame' in draft ? (
        <>
          {field('Content in frame', 'contentInFrame')}
          {field('Content out frame (exclusive)', 'contentOutFrame')}
        </>
      ) : (
        <>
          {field('Source start sample (48 kHz)', 'sourceStartSample')}
          {field('Music duration frames', 'durationFrames')}
        </>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={disabled}
        onClick={() => {
          const changed = onSave(
            'contentFullSource' in draft
              ? { ...draft, contentFullSource: false }
              : draft,
          );
          setMessage(
            changed
              ? 'Range saved.'
              : 'Range unchanged or invalid; review the visible error.',
          );
        }}
      >
        Save timeline range
      </button>
      {'trim' in item && (
        <fieldset disabled={disabled}>
          <legend>Replacement source trim and speed</legend>
          {(['startFrame', 'endFrame'] as const).map((key) => (
            <label key={key}>
              Source {key === 'startFrame' ? 'start' : 'end'} frame
              <input
                aria-label={`Replacement source ${key === 'startFrame' ? 'start' : 'end'} frame`}
                type="number"
                min="0"
                step="1"
                value={sourceTrim[key]}
                onChange={(event) =>
                  setSourceTrim({
                    ...sourceTrim,
                    [key]: Number(event.target.value),
                  })
                }
              />
            </label>
          ))}
          <button
            type="button"
            className="secondary-button"
            onClick={() => onSourceEdit?.(sourceTrim, item.speed, 'trim')}
          >
            Save source trim
          </button>
          <label>
            Replacement speed
            <select
              aria-label="Replacement speed"
              value={item.speed}
              onChange={(event) =>
                onSourceEdit?.(
                  item.trim,
                  Number(event.target.value) as ClipSpeed,
                  'speed',
                )
              }
            >
              <option value="1">1x</option>
              <option value="0.75">0.75x</option>
              <option value="0.5">0.5x</option>
            </select>
          </label>
        </fieldset>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
