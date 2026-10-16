import { useEffect, useRef, useState } from 'react';
import type { ClipMetadata, ClipTrim, ClipSpeed } from '../lib/clips';
import type { ProjectFps } from '../lib/clips';
import type { SourceRecord } from '../lib/projectSources';
import type { PlacementDraft } from '../lib/placement';
import { timecodeFrame } from '../lib/placement';
import { formatTimestamp, resolveProjectFps } from '../lib/clips';

export function SourcePlacementDialog({
  source,
  fps,
  onSave,
  onCancel,
  disabled,
}: {
  source: SourceRecord;
  fps: ProjectFps | null;
  onSave: (draft: PlacementDraft) => boolean;
  onCancel: () => void;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [track, setTrack] = useState<PlacementDraft['track']>(
    source.mediaType === 'audio' ? 'independent' : 'video1',
  );
  const [start, setStart] = useState(0),
    [timecode, setTimecode] = useState<string | null>(null),
    [error, setError] = useState('');
  const [inPoint, setIn] = useState(0),
    [outPoint, setOut] = useState(
      source.mediaType === 'video'
        ? (source.metadata?.totalFrames ?? 1) - 1
        : (source.sampleCount ?? 0),
    ),
    [rangeEdited, setRangeEdited] = useState(false);
  const [speed, setSpeed] = useState<ClipSpeed>(1);
  const f = fps ?? resolveProjectFps('auto', source.metadata?.fps);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('select')?.focus();
    return () => prior?.focus();
  }, []);
  return (
    <div className="timeline-dialog-backdrop">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Place ${source.file.name}`}
        className="panel timeline-placement-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
          if (e.key === 'Tab') {
            const nodes = [
                ...dialog.current!.querySelectorAll<HTMLElement>(
                  'input:not(:disabled),select:not(:disabled),button:not(:disabled)',
                ),
              ],
              first = nodes[0],
              last = nodes.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2>Place media</h2>
        <p>{source.file.name}</p>
        <label>
          Track
          <select
            aria-label="Placement track"
            value={track}
            onChange={(e) =>
              setTrack(e.target.value as PlacementDraft['track'])
            }
          >
            {(source.mediaType === 'video'
              ? [
                  ['video1', 'Video 1'],
                  ['video2', 'Video 2'],
                ]
              : [
                  ['independent', 'Original/Replacement Audio'],
                  ['music', 'Background Music'],
                ]
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start frame
          <input
            aria-label="Placement start frame"
            type="number"
            min="0"
            step="1"
            value={start}
            onChange={(e) => {
              setStart(Number(e.target.value));
              setTimecode(null);
            }}
          />
        </label>
        <label>
          Start timecode
          <input
            aria-label="Placement start timecode"
            value={timecode ?? (f ? formatTimestamp(start / f) : '')}
            onChange={(e) => setTimecode(e.target.value)}
            placeholder="mm:ss.mmm or hh:mm:ss:ff"
          />
        </label>
        <label>
          {source.mediaType === 'video'
            ? 'Source start frame'
            : 'Source start sample'}
          <input
            aria-label="Placement source start"
            type="number"
            min="0"
            step="1"
            value={inPoint}
            onChange={(e) => {
              setIn(Number(e.target.value));
              setRangeEdited(true);
            }}
          />
        </label>
        <label>
          {source.mediaType === 'video'
            ? 'Source end frame (inclusive)'
            : 'Source end sample (exclusive)'}
          <input
            aria-label="Placement source end"
            type="number"
            min="0"
            step="1"
            value={outPoint}
            onChange={(e) => {
              setOut(Number(e.target.value));
              setRangeEdited(true);
            }}
          />
        </label>
        {source.mediaType === 'video' && (
          <label>
            Speed
            <select
              aria-label="Placement speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value) as ClipSpeed)}
            >
              <option value="1">Normal</option>
              <option value="0.75">0.75×</option>
              <option value="0.5">0.5×</option>
            </select>
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          disabled={disabled || source.status !== 'ready' || !f}
          onClick={() => {
            let position = start;
            if (timecode !== null && f) {
              const parsed = timecodeFrame(timecode, f);
              if ('error' in parsed) {
                setError(parsed.error.message);
                return;
              }
              position = parsed.value;
            }
            const draft: PlacementDraft = {
              token: source.token,
              track,
              timelineStartFrame: position,
            };
            if (source.mediaType === 'video') {
              if (rangeEdited)
                draft.trim = { startFrame: inPoint, endFrame: outPoint };
              if (speed !== 1) draft.speed = speed;
            } else if (rangeEdited && f) {
              if (
                !Number.isSafeInteger(inPoint) ||
                !Number.isSafeInteger(outPoint) ||
                inPoint < 0 ||
                outPoint <= inPoint ||
                outPoint > (source.sampleCount ?? 0)
              ) {
                setError('Choose a valid decoded source sample range.');
                return;
              }
              draft.sourceStartSample = inPoint;
              draft.durationFrames =
                outPoint === source.sampleCount
                  ? Math.ceil((outPoint - inPoint) / (48000 / f))
                  : Math.floor((outPoint - inPoint) / (48000 / f) + 0.5);
            }
            if (!onSave(draft))
              setError(
                'The placement could not be saved. Repair its range or overlap.',
              );
          }}
        >
          Place media
        </button>
        <button type="button" onClick={onCancel}>
          Cancel placement
        </button>
      </div>
    </div>
  );
}
export function TimelinePlacementDialog({
  name,
  metadata,
  startFrame,
  disabled,
  onSave,
  onCancel,
}: {
  name: string;
  metadata?: ClipMetadata;
  startFrame: number;
  disabled: boolean;
  onSave: (draft: {
    timelineStartFrame: number;
    trim?: ClipTrim;
    speed?: ClipSpeed;
  }) => boolean;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(startFrame),
    [trimDraft, setTrim] = useState<ClipTrim | null>(null),
    [error, setError] = useState('');
  const trim = trimDraft ?? {
    startFrame: 0,
    endFrame: (metadata?.totalFrames ?? 1) - 1,
  };
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current
      ?.querySelector<HTMLInputElement>('input:not(:disabled)')
      ?.focus();
    return () => {
      prior?.focus();
    };
  }, []);
  return (
    <div className="timeline-dialog-backdrop">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Place Video 2 replacement"
        className="panel timeline-placement-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
          if (event.key === 'Tab') {
            const nodes = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>(
                'input:not(:disabled),button:not(:disabled),select:not(:disabled)',
              ) ?? [],
            );
            const first = nodes[0],
              last = nodes.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2>Place full-screen replacement</h2>
        <p>{name}</p>
        <p>
          Video 2 replaces picture and original audio during its range. Trim an
          overlong take explicitly.
        </p>
        <label>
          Replacement start frame
          <input
            aria-label="Replacement start frame"
            type="number"
            min="0"
            step="1"
            disabled={disabled}
            value={start}
            onChange={(event) => setStart(Number(event.target.value))}
          />
        </label>
        {(['startFrame', 'endFrame'] as const).map((key) => (
          <label key={key}>
            Source {key === 'startFrame' ? 'start' : 'end'} frame
            <input
              aria-label={`Candidate source ${key === 'startFrame' ? 'start' : 'end'} frame`}
              type="number"
              min="0"
              step="1"
              disabled={disabled || !metadata}
              value={trim[key]}
              onChange={(event) =>
                setTrim({ ...trim, [key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
        {!metadata && <p role="status">Reading replacement metadata…</p>}
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || !metadata}
          onClick={() => {
            if (
              !onSave({
                timelineStartFrame: start,
                ...(trimDraft ? { trim: trimDraft } : {}),
              })
            )
              setError(
                'The replacement could not be saved. Correct its source range, start or overlap.',
              );
          }}
        >
          Save replacement
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel replacement
        </button>
      </div>
    </div>
  );
}
