import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineProjection } from '../lib/timeline';
import type { OverlayState } from '../lib/overlays';
import type { AdvancedTimelineProjection } from '../lib/advancedTimeline';
import { resolveProgramFrame } from '../lib/advancedTimeline';
import { formatTimestamp } from '../lib/clips';

type Props = {
  timeline: TimelineProjection;
  projection?: AdvancedTimelineProjection;
  overlays: OverlayState;
  frame: number | null;
  playing: boolean;
  onSeek: (frame: number) => void;
  onToggle: () => void;
};
export function ProgramMonitor({
  timeline,
  projection,
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
  const baseItem =
    frame === null
      ? undefined
      : timeline.items.find(
          (item) => frame >= item.startFrame && frame <= item.endFrame,
        );
  const current =
    projection && frame !== null
      ? resolveProgramFrame(projection, frame)
      : baseItem && frame !== null && timeline.fps
        ? {
            clip: baseItem.clip,
            track: 'video1' as const,
            sourceTime:
              baseItem.clip.trim.startFrame / baseItem.clip.metadata.fps +
              ((frame - baseItem.startFrame) / timeline.fps) *
                baseItem.clip.speed,
          }
        : null;
  const sourceTime = current?.sourceTime ?? 0;
  const currentClip = current?.clip;
  const currentTrack = current?.track;
  const mappingKey =
    current?.track === 'video2'
      ? JSON.stringify(projection?.video2.find((v) => v.id === current.clip.id))
      : JSON.stringify([
          current?.clip.id,
          current?.clip.trim,
          current?.clip.speed,
        ]);
  const [replacementFailure, setReplacementFailure] = useState<{
    url: string;
    id: string;
    frame: number;
    mapping: string;
  } | null>(null);
  if (
    replacementFailure &&
    (current?.clip.url !== replacementFailure.url ||
      current.clip.id !== replacementFailure.id ||
      mappingKey !== replacementFailure.mapping ||
      (frame !== null && frame < replacementFailure.frame))
  )
    setReplacementFailure(null);
  const replacementUnavailable =
    current?.track === 'video2' &&
    replacementFailure?.url === current.clip.url &&
    replacementFailure.mapping === mappingKey &&
    frame !== null &&
    frame >= replacementFailure.frame;
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
    if (!element || !currentClip) return;
    if (Number.isFinite(element.duration)) {
      if (currentTrack === 'video2' && sourceTime >= element.duration) {
        element.pause();
        setReplacementFailure({
          url: currentClip.url,
          id: currentClip.id,
          frame: frame ?? 0,
          mapping: mappingKey,
        });
        return;
      }
      if (!playing || Math.abs(element.currentTime - sourceTime) > 0.25)
        element.currentTime = Math.min(sourceTime, element.duration);
      element.playbackRate = currentClip.speed;
    }
    if (playing)
      void element.play().catch(() => setFailedSource(currentClip.url));
    else element.pause();
  }, [currentClip, currentTrack, sourceTime, playing, mappingKey, frame]);
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
  }, [
    current?.clip.url,
    current?.clip.id,
    mappingKey,
    pipVisible,
    overlays.video?.url,
  ]);
  return (
    <section className="program-monitor panel" aria-label="Program preview">
      <h2>Program preview</h2>
      <div className="program-canvas">
        {current && !replacementUnavailable ? (
          <video
            key={`${current.clip.id}:${mappingKey}`}
            ref={video}
            src={current.clip.url}
            muted
            playsInline
            preload="metadata"
            aria-label="Uploaded clip preview"
            onLoadedMetadata={syncSource}
            onEnded={() => {
              if (current.track === 'video2')
                setReplacementFailure({
                  url: current.clip.url,
                  id: current.clip.id,
                  frame: frame ?? 0,
                  mapping: mappingKey,
                });
            }}
            onError={() => {
              if (current.track === 'video2')
                setReplacementFailure({
                  url: current.clip.url,
                  id: current.clip.id,
                  frame: frame ?? 0,
                  mapping: mappingKey,
                });
              else setFailedSource(current.clip.url);
            }}
          />
        ) : (
          <p>
            {replacementUnavailable
              ? 'Replacement preview is unavailable at source EOF or after a decode error. Re-trim or replace this take.'
              : timeline.status === 'unavailable'
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
