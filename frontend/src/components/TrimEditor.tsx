import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatTimestamp, frameToSeconds, validateTrim } from '../lib/clips';
import type { ClipEdit, ClipTrim } from '../lib/clips';

type Props = {
  clip: ClipEdit;
  disabled: boolean;
  onSave: (clipId: string, trim: ClipTrim) => void;
  onCancel: () => void;
};

export function TrimEditor({ clip, disabled, onSave, onCancel }: Props) {
  const [trim, setTrim] = useState(clip.trim);
  const [playhead, setPlayhead] = useState(clip.trim.startFrame);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const max = clip.metadata.totalFrames - 1;
  const error = validateTrim(trim, clip.metadata.totalFrames);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (video.current) {
      video.current.currentTime = frameToSeconds(playhead, clip.metadata.fps);
      video.current.playbackRate = clip.speed;
    }
  }, [playhead, clip.metadata.fps, clip.speed]);

  useEffect(() => {
    let cancelled = false;
    const source = document.createElement('video');
    source.muted = true;
    source.preload = 'auto';
    source.src = clip.url;
    source.onloadedmetadata = async () => {
      const frames: string[] = [];
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext('2d');
      if (!context) return;
      for (let index = 0; index < 8 && !cancelled; index += 1) {
        source.currentTime = (clip.metadata.duration * index) / 8;
        await new Promise<void>((resolve) => {
          source.onseeked = () => resolve();
        });
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.65));
      }
      if (!cancelled) setThumbnails(frames);
    };
    source.load();
    return () => {
      cancelled = true;
      source.removeAttribute('src');
      source.load();
    };
  }, [clip.metadata.duration, clip.url]);

  const setStart = (value: number) => {
    setTrim((current) => ({ ...current, startFrame: value }));
    setPlayhead(value);
  };
  const setEnd = (value: number) => {
    setTrim((current) => ({ ...current, endFrame: value }));
    setPlayhead(value);
  };

  return (
    <div className="trim-backdrop" role="presentation">
      <section
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Tab') {
            const controls = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), video[controls]',
              ) ?? [],
            ).sort((a, b) =>
              a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
                ? -1
                : 1,
            );
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
        className="trim-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Trim ${clip.file.name}`}
      >
        <header>
          <div>
            <span className="eyebrow">FRAME-ACCURATE TRIM</span>
            <h2>{clip.file.name}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel trim"
            onClick={onCancel}
          >
            <X />
          </button>
        </header>
        <video
          ref={video}
          className="trim-preview"
          src={clip.url}
          controls
          muted
          playsInline
          preload="auto"
          onPlay={(event) => {
            event.currentTarget.playbackRate = clip.speed;
            const frame = Math.round(
              event.currentTarget.currentTime * clip.metadata.fps,
            );
            if (frame < trim.startFrame || frame > trim.endFrame) {
              event.currentTarget.currentTime = frameToSeconds(
                trim.startFrame,
                clip.metadata.fps,
              );
              setPlayhead(trim.startFrame);
            }
          }}
          onTimeUpdate={(event) => {
            const frame = Math.round(
              event.currentTarget.currentTime * clip.metadata.fps,
            );
            if (frame >= trim.endFrame) {
              event.currentTarget.pause();
              event.currentTarget.currentTime = frameToSeconds(
                trim.endFrame,
                clip.metadata.fps,
              );
              setPlayhead(trim.endFrame);
            } else {
              setPlayhead(Math.max(trim.startFrame, frame));
            }
          }}
        />
        <div className="frame-readouts">
          <div>
            <span>Trim start</span>
            <strong>Frame {trim.startFrame}</strong>
            <small>
              {formatTimestamp(
                frameToSeconds(trim.startFrame, clip.metadata.fps),
              )}
            </small>
          </div>
          <div data-readout="playhead">
            <span>Playhead</span>
            <strong>Frame {playhead}</strong>
            <small>
              {formatTimestamp(frameToSeconds(playhead, clip.metadata.fps))}
            </small>
          </div>
          <div>
            <span>Trim end</span>
            <strong>Frame {trim.endFrame}</strong>
            <small>
              {formatTimestamp(
                frameToSeconds(trim.endFrame, clip.metadata.fps),
              )}
            </small>
          </div>
        </div>
        <div className="thumbnail-timeline" aria-label="Thumbnail timeline">
          {thumbnails.length ? (
            thumbnails.map((thumbnail, index) => (
              <span
                key={index}
                style={{ backgroundImage: `url(${thumbnail})` }}
              />
            ))
          ) : (
            <span className="thumbnail-fallback">
              Generating frame thumbnails… Use the preview and frame controls if
              browser capture is unavailable.
            </span>
          )}
        </div>
        <div className="timeline-controls">
          <label>
            Trim start frame
            <input
              aria-label="Trim start frame"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'trim-error' : undefined}
              type="range"
              min="0"
              max={max}
              value={trim.startFrame}
              onChange={(event) => setStart(Number(event.target.value))}
            />
          </label>
          <label>
            Playhead
            <input
              aria-label="Playhead frame"
              type="range"
              min={trim.startFrame}
              max={trim.endFrame}
              value={playhead}
              onChange={(event) => setPlayhead(Number(event.target.value))}
            />
          </label>
          <label>
            Trim end frame
            <input
              aria-label="Trim end frame"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'trim-error' : undefined}
              type="range"
              min="0"
              max={max}
              value={trim.endFrame}
              onChange={(event) => setEnd(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="frame-stepper">
          <button
            type="button"
            disabled={playhead <= trim.startFrame}
            onClick={() => {
              video.current?.pause();
              setPlayhead((frame) => Math.max(trim.startFrame, frame - 1));
            }}
          >
            <ChevronLeft /> Previous Frame
          </button>
          <button
            type="button"
            disabled={playhead >= trim.endFrame}
            onClick={() => {
              video.current?.pause();
              setPlayhead((frame) => Math.min(trim.endFrame, frame + 1));
            }}
          >
            Next Frame <ChevronRight />
          </button>
        </div>
        {error && (
          <p id="trim-error" className="trim-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={disabled || Boolean(error)}
            onClick={() => onSave(clip.id, trim)}
          >
            Save trim
          </button>
        </footer>
      </section>
    </div>
  );
}
