import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineProjection } from '../lib/timeline';
import type { OverlayState } from '../lib/overlays';
import { formatTimestamp } from '../lib/clips';

type Props = {
  timeline: TimelineProjection;
  overlays: OverlayState;
  frame: number | null;
  playing: boolean;
  onSeek: (frame: number) => void;
  onToggle: () => void;
};
export function ProgramMonitor({
  timeline,
  overlays,
  frame,
  playing,
  onToggle,
}: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const pip = useRef<HTMLVideoElement>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [eof, setEof] = useState<{
    url: string;
    frame: number;
    startFrame: number;
    fps: number | null;
    duration: number | undefined;
  } | null>(null);
  if (
    eof &&
    (eof.url !== overlays.video?.url ||
      eof.startFrame !== overlays.video?.startFrame ||
      eof.fps !== timeline.fps ||
      eof.duration !== overlays.video?.duration ||
      (frame !== null && frame < eof.frame))
  )
    setEof(null);
  const current =
    frame === null
      ? undefined
      : timeline.items.find(
          (item) => frame >= item.startFrame && frame <= item.endFrame,
        );
  const sourceTime =
    current && frame !== null && timeline.fps
      ? current.clip.trim.startFrame / current.clip.metadata.fps +
        ((frame - current.startFrame) / timeline.fps) * current.clip.speed
      : 0;
  const pipTime =
    frame !== null && timeline.fps && overlays.video
      ? (frame - overlays.video.startFrame) / timeline.fps
      : -1;
  const inRange = (overlay: NonNullable<OverlayState['image' | 'video']>) =>
    overlay.metadataStatus === 'ready' &&
    frame !== null &&
    frame >= overlay.startFrame &&
    frame <= overlay.endFrame;
  const imageVisible = overlays.image && inRange(overlays.image);
  const pipVisible =
    overlays.video &&
    inRange(overlays.video) &&
    pipTime >= 0 &&
    pipTime < (overlays.video.duration ?? 0) &&
    !(eof?.url === overlays.video.url && frame !== null && frame >= eof.frame);
  const syncSource = useCallback(() => {
    const element = video.current;
    if (!element || !current) return;
    if (Number.isFinite(element.duration)) {
      if (!playing || Math.abs(element.currentTime - sourceTime) > 0.25)
        element.currentTime = Math.min(sourceTime, element.duration);
      element.playbackRate = current.clip.speed;
    }
    if (playing)
      void element.play().catch(() => setFailedSource(current.clip.url));
    else element.pause();
  }, [current, sourceTime, playing]);
  useEffect(() => syncSource(), [syncSource]);
  useEffect(() => {
    const element = pip.current;
    if (!element || !pipVisible) return;
    if (!playing || Math.abs(element.currentTime - pipTime) > 0.08)
      element.currentTime = pipTime;
    if (playing) void element.play().catch(() => undefined);
    else element.pause();
  }, [pipTime, pipVisible, playing]);
  useEffect(() => {
    const source = video.current;
    const overlay = pip.current;
    return () => {
      source?.pause();
      overlay?.pause();
    };
  }, [current?.clip.url, pipVisible, overlays.video?.url]);
  return (
    <section className="program-monitor panel" aria-label="Program preview">
      <h2>Program preview</h2>
      <div className="program-canvas">
        {current ? (
          <video
            key={current.clip.id}
            ref={video}
            src={current.clip.url}
            muted
            playsInline
            preload="metadata"
            aria-label="Uploaded clip preview"
            onLoadedMetadata={syncSource}
            onError={() => setFailedSource(current.clip.url)}
          />
        ) : (
          <p>
            {timeline.status === 'unavailable'
              ? 'Timeline timing unavailable'
              : 'Add video clips to begin'}
          </p>
        )}
        {pipVisible && overlays.video && (
          <video
            ref={pip}
            src={overlays.video.url}
            muted
            playsInline
            preload="metadata"
            aria-label="PIP overlay preview"
            className={`program-overlay overlay-${overlays.video.position} overlay-${overlays.video.size}`}
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = pipTime;
            }}
            onEnded={() =>
              setEof({
                url: overlays.video!.url,
                frame: frame!,
                startFrame: overlays.video!.startFrame,
                fps: timeline.fps,
                duration: overlays.video!.duration,
              })
            }
          />
        )}
        {imageVisible && overlays.image && (
          <img
            src={overlays.image.url}
            alt="Image overlay preview"
            aria-label="Image overlay preview"
            className={`program-overlay overlay-${overlays.image.position} overlay-${overlays.image.size}`}
          />
        )}
      </div>
      {current && failedSource === current.clip.url && (
        <p role="status">
          This clip cannot play in this browser. You can still render a valid
          project.
        </p>
      )}
      <div className="program-transport">
        <button
          type="button"
          onClick={onToggle}
          disabled={frame === null}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <output aria-label="Current time and frame" aria-live="off">
          {frame !== null && timeline.fps
            ? `${formatTimestamp(frame / timeline.fps)} · Frame ${frame} / ${timeline.totalFrames - 1}`
            : 'No current frame'}
        </output>
      </div>
      <p className="preview-note">Silent browser preview · approximate</p>
    </section>
  );
}
