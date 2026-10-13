import { useEffect, useRef, useState } from 'react';
import type { ClipMetadata, ClipTrim, ClipSpeed } from '../lib/clips';
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
