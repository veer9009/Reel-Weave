import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Trash2,
  Play,
  MoveVertical,
} from 'lucide-react';
import {
  estimateFrameRate,
  formatDuration,
  formatSize,
  frameCountFromDuration,
  outputDuration,
} from '../lib/clips';
import type { Clip, ClipMetadata, ClipSpeed } from '../lib/clips';
type Props = {
  clips: Clip[];
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onMetadata: (id: string, metadata: ClipMetadata) => void;
  onMetadataError: (id: string) => void;
  onTrim: (id: string) => void;
  onSpeedChange: (id: string, speed: ClipSpeed) => void;
};

function detectFrameRate(video: HTMLVideoElement): Promise<number> {
  if (typeof video.requestVideoFrameCallback !== 'function')
    return Promise.resolve(30);
  return new Promise((resolve) => {
    const mediaTimes: number[] = [];
    const originalRate = video.playbackRate;
    let callbackId = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (typeof video.cancelVideoFrameCallback === 'function')
        video.cancelVideoFrameCallback(callbackId);
      video.pause();
      video.currentTime = 0;
      video.playbackRate = originalRate;
      resolve(estimateFrameRate(mediaTimes) ?? 30);
    };
    const capture: VideoFrameRequestCallback = (_now, metadata) => {
      if (mediaTimes.at(-1) !== metadata.mediaTime)
        mediaTimes.push(metadata.mediaTime);
      if (mediaTimes.length >= 6 || video.ended) finish();
      else callbackId = video.requestVideoFrameCallback(capture);
    };
    const timeout = setTimeout(finish, 2000);
    video.muted = true;
    video.playbackRate = 1;
    callbackId = video.requestVideoFrameCallback(capture);
    void video.play().catch(finish);
  });
}

export function ClipList({
  clips,
  disabled,
  onMove,
  onRemove,
  onMetadata,
  onMetadataError,
  onTrim,
  onSpeedChange,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    <section className="clip-section" aria-labelledby="clips-title">
      <div className="clip-heading">
        <h2 id="clips-title">
          Your clips <span className="count">{clips.length}</span>
        </h2>
        <p>
          <MoveVertical aria-hidden="true" />
          Arrange your story
        </p>
      </div>
      {!clips.length ? (
        <div className="empty-clips">
          <strong>Your story starts here</strong>
          <p>Add at least two clips, then put them in the perfect order.</p>
        </div>
      ) : (
        <ol className="clip-list" aria-label="Clip order">
          {clips.map((clip, index) => (
            <li
              key={clip.id}
              className={`clip-item ${dragId === clip.id ? 'is-dragging' : ''}`}
              draggable={!disabled}
              onDragStart={(e) => {
                if (disabled) return;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', clip.id);
                setDragId(clip.id);
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId && !disabled) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!disabled && dragId) {
                  const from = clips.findIndex((c) => c.id === dragId);
                  onMove(from, index);
                }
                setDragId(null);
              }}
            >
              <GripVertical className="grip" aria-hidden="true" />
              <span
                className="clip-position"
                aria-label={`Position ${index + 1}`}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="clip-thumbnail">
                <video
                  src={clip.url}
                  muted
                  playsInline
                  preload="metadata"
                  aria-hidden="true"
                  onLoadedMetadata={(e) => {
                    const video = e.currentTarget;
                    const duration = video.duration;
                    if (!Number.isFinite(duration) || duration <= 0) {
                      onMetadataError(clip.id);
                      return;
                    }
                    const commitMetadata = (fps: number) =>
                      onMetadata(clip.id, {
                        duration,
                        fps,
                        totalFrames: frameCountFromDuration(duration, fps),
                        width: video.videoWidth,
                        height: video.videoHeight,
                        source: 'browser',
                      });
                    if (typeof video.requestVideoFrameCallback !== 'function')
                      commitMetadata(30);
                    else void detectFrameRate(video).then(commitMetadata);
                  }}
                  onError={() => onMetadataError(clip.id)}
                />
                <Play aria-hidden="true" />
              </div>
              <div className="clip-details">
                <h3 title={clip.file.name}>{clip.file.name}</h3>
                <p>
                  <span>{formatSize(clip.file.size)}</span>
                  <span className="separator">·</span>
                  <span>
                    {formatDuration(
                      clip.metadata && clip.trim && clip.speed
                        ? outputDuration(
                            clip.trim,
                            clip.metadata.fps,
                            clip.speed,
                          )
                        : clip.duration,
                    )}
                  </span>
                </p>
                {clip.trim && (
                  <p className="frame-range">
                    Frames {clip.trim.startFrame}–{clip.trim.endFrame}
                  </p>
                )}
              </div>
              <div className="clip-edit-controls">
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`Trim ${clip.file.name}`}
                  disabled={disabled || clip.metadataStatus !== 'ready'}
                  onClick={() => onTrim(clip.id)}
                >
                  Trim
                </button>
                <label>
                  Speed<span className="sr-only"> for {clip.file.name}</span>
                  <select
                    aria-label={`Speed for ${clip.file.name}`}
                    value={clip.speed ?? 1}
                    disabled={disabled || clip.metadataStatus !== 'ready'}
                    onChange={(event) =>
                      onSpeedChange(
                        clip.id,
                        Number(event.target.value) as ClipSpeed,
                      )
                    }
                  >
                    <option value="1">1x Normal</option>
                    <option value="0.75">0.75x Slow</option>
                    <option value="0.5">0.5x Slow motion</option>
                  </select>
                </label>
              </div>
              <div className="clip-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${clip.file.name} up`}
                  disabled={disabled || index === 0}
                  onClick={() => onMove(index, index - 1)}
                >
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${clip.file.name} down`}
                  disabled={disabled || index === clips.length - 1}
                  onClick={() => onMove(index, index + 1)}
                >
                  <ArrowDown />
                </button>
                <button
                  type="button"
                  className="icon-button remove"
                  aria-label={`Remove ${clip.file.name}`}
                  disabled={disabled}
                  onClick={() => onRemove(clip.id)}
                >
                  <Trash2 />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
