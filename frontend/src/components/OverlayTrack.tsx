import {
  Image as ImageIcon,
  PictureInPicture,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  OverlayKind,
  OverlaySchedule,
  OverlayState,
} from '../lib/overlays';
import { validateOverlaySchedule } from '../lib/overlays';

type Props = {
  overlays: OverlayState;
  totalProjectFrames: number;
  imageLimitMb: number;
  videoLimitMb: number;
  disabled: boolean;
  onSelect: (kind: OverlayKind, file: File) => void;
  onMetadata: (kind: OverlayKind, duration?: number) => void;
  onMetadataError: (kind: OverlayKind) => void;
  onScheduleChange: (
    kind: OverlayKind,
    changes: Partial<OverlaySchedule>,
  ) => void;
  onRemove: (kind: OverlayKind) => void;
};

const POSITIONS: OverlaySchedule['position'][] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'centre',
];
const SIZES: OverlaySchedule['size'][] = ['small', 'medium', 'large'];

export function OverlayTrack({
  overlays,
  totalProjectFrames,
  imageLimitMb,
  videoLimitMb,
  disabled,
  onSelect,
  onMetadata,
  onMetadataError,
  onScheduleChange,
  onRemove,
}: Props) {
  const timelineUnavailable = totalProjectFrames < 1;

  const slot = (kind: OverlayKind) => {
    const overlay = overlays[kind];
    const title = kind === 'image' ? 'Image / logo' : 'Video / PIP';
    const inputLabel =
      kind === 'image' ? 'Choose image overlay' : 'Choose video overlay';
    const accept =
      kind === 'image' ? '.png,.jpg,.jpeg' : '.mp4,.mov,.webm,.mkv';
    const limit = kind === 'image' ? imageLimitMb : videoLimitMb;
    const error = overlay
      ? validateOverlaySchedule(overlay, totalProjectFrames)
      : null;

    return (
      <article className="overlay-slot" aria-label={`${title} overlay slot`}>
        <div className="overlay-slot-heading">
          <span className="overlay-kind-icon">
            {kind === 'image' ? (
              <ImageIcon aria-hidden="true" />
            ) : (
              <PictureInPicture aria-hidden="true" />
            )}
          </span>
          <div>
            <strong>{title}</strong>
            <small>
              One {kind} at a time · up to {limit} MB
            </small>
          </div>
        </div>
        {!overlay ? (
          <label className="overlay-upload">
            <Upload aria-hidden="true" />
            <span>{inputLabel}</span>
            <input
              aria-label={inputLabel}
              type="file"
              accept={accept}
              disabled={disabled || timelineUnavailable}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onSelect(kind, file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        ) : (
          <div className="overlay-editor">
            {kind === 'image' ? (
              <img
                src={overlay.url}
                alt=""
                onLoad={() => onMetadata(kind)}
                onError={() => onMetadataError(kind)}
              />
            ) : (
              <video
                src={overlay.url}
                muted
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  if (Number.isFinite(duration) && duration > 0)
                    onMetadata(kind, duration);
                  else onMetadataError(kind);
                }}
                onError={() => onMetadataError(kind)}
              />
            )}
            <div className="overlay-file">
              <strong>{overlay.file.name}</strong>
              <span>
                {overlay.metadataStatus === 'ready'
                  ? 'Ready'
                  : overlay.metadataStatus === 'error'
                    ? 'Could not read media'
                    : 'Reading media…'}
              </span>
              <label className="overlay-replace">
                Replace
                <input
                  aria-label={`Replace ${kind} overlay`}
                  type="file"
                  accept={accept}
                  disabled={disabled}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onSelect(kind, file);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
            <button
              type="button"
              className="icon-button remove"
              aria-label={`Remove ${overlay.file.name}`}
              disabled={disabled}
              onClick={() => onRemove(kind)}
            >
              <Trash2 />
            </button>
            <div className="overlay-settings">
              <label>
                Start frame
                <input
                  aria-label={`${kind === 'image' ? 'Image' : 'Video'} overlay start frame`}
                  type="number"
                  min="0"
                  step="1"
                  value={overlay.startFrame}
                  disabled={disabled}
                  onChange={(event) =>
                    onScheduleChange(kind, {
                      startFrame: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                End frame
                <input
                  aria-label={`${kind === 'image' ? 'Image' : 'Video'} overlay end frame`}
                  type="number"
                  min="0"
                  step="1"
                  value={overlay.endFrame}
                  disabled={disabled}
                  onChange={(event) =>
                    onScheduleChange(kind, {
                      endFrame: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Position
                <select
                  aria-label={`${kind === 'image' ? 'Image' : 'Video'} overlay position`}
                  value={overlay.position}
                  disabled={disabled}
                  onChange={(event) =>
                    onScheduleChange(kind, {
                      position: event.target
                        .value as OverlaySchedule['position'],
                    })
                  }
                >
                  {POSITIONS.map((position) => (
                    <option key={position} value={position}>
                      {position.replace('-', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Size
                <select
                  aria-label={`${kind === 'image' ? 'Image' : 'Video'} overlay size`}
                  value={overlay.size}
                  disabled={disabled}
                  onChange={(event) =>
                    onScheduleChange(kind, {
                      size: event.target.value as OverlaySchedule['size'],
                    })
                  }
                >
                  {SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error && <p className="overlay-error">{error}</p>}
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="overlay-track panel" aria-labelledby="overlay-title">
      <div className="overlay-track-heading">
        <div>
          <span className="eyebrow">VIDEO 2</span>
          <h2 id="overlay-title">Overlays</h2>
        </div>
        <span>Rendered into MP4</span>
      </div>
      {timelineUnavailable && (
        <p className="overlay-guidance">
          Add ready Video 1 clips to enable overlays.
        </p>
      )}
      <div className="overlay-slots">
        {slot('image')}
        {slot('video')}
      </div>
    </section>
  );
}
