import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { usePreviewMedia } from '../hooks/usePreviewMedia';
import type { ProjectPlayback } from '../hooks/useProjectPlayback';
import type { ProjectSources } from '../lib/projectSources';
import type { TimelineProjection } from '../lib/timeline';
import type { OverlayState } from '../lib/overlays';
import type { AdvancedTimelineProjection } from '../lib/advancedTimeline';
import { resolveProgramFrame } from '../lib/advancedTimeline';
import { formatTimestamp } from '../lib/clips';

type Props = {
  audioPreview?: {
    status: string;
    message: string | null;
    resumeAudio: () => Promise<boolean>;
  };
  transport?: ProjectPlayback;
  sources?: ProjectSources;
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
  transport,
  sources,
  audioPreview,
}: Props) {
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
  const sourceFrame =
    frame !== null && transport && timeline.fps
      ? Math.min(
          timeline.totalFrames - 1,
          transport.captureAnchor().projectSeconds * timeline.fps,
        )
      : frame;
  const baseItem =
    sourceFrame === null
      ? undefined
      : timeline.items.find(
          (item) =>
            sourceFrame >= item.startFrame && sourceFrame < item.endFrame + 1,
        );
  const current =
    projection && sourceFrame !== null
      ? resolveProgramFrame(projection, sourceFrame)
      : baseItem && sourceFrame !== null && timeline.fps
        ? {
            clip: baseItem.clip,
            track: 'video1' as const,
            sourceTime:
              baseItem.clip.trim.startFrame / baseItem.clip.metadata.fps +
              ((sourceFrame -
                baseItem.startFrame +
                (baseItem.clip.outputWindow?.outputInFrame ?? 0)) /
                timeline.fps) *
                baseItem.clip.speed,
          }
        : null;
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
  const media = usePreviewMedia({
    current: replacementUnavailable ? null : current,
    projection,
    frame,
    projectSeconds:
      sourceFrame !== null && timeline.fps
        ? sourceFrame / timeline.fps
        : undefined,
    playing,
    generation: transport?.generation,
    positionRevision: transport?.positionRevision,
    sources,
    onPresented: transport?.observePicture,
    onSuspend: transport?.suspend,
    onReady: transport?.ready,
    onFailure: () => {
      if (!current) return;
      if (current.track === 'video2')
        setReplacementFailure({
          url: current.clip.url,
          id: current.clip.id,
          frame: frame ?? 0,
          mapping: mappingKey,
        });
      else setFailedSource(current.clip.url);
      transport?.fail();
    },
  });
  useEffect(() => {
    const element = pip.current;
    if (!element || !pipVisible) return;
    if (!playing || Math.abs(element.currentTime - pipTime) > 0.08)
      element.currentTime = pipTime;
    if (playing) void element.play().catch(() => undefined);
    else element.pause();
  }, [pipTime, pipVisible, playing]);
  useEffect(() => {
    const overlay = pip.current;
    return () => {
      overlay?.pause();
    };
  }, [pipVisible, overlays.video?.url]);
  return (
    <section className="program-monitor panel" aria-label="Program preview">
      <h2>Program</h2>
      {transport?.status === 'preparing' && (
        <p role="status">Preparing Preview</p>
      )}
      {transport?.status === 'failed' && (
        <p role="status">Picture preview stopped. Check the source media.</p>
      )}
      <div className="program-canvas">
        {media.slots.map((slot, index) => (
          <video
            key={index}
            ref={media.bind[index]}
            src={slot.url}
            muted
            playsInline
            preload="auto"
            hidden={
              !current ||
              Boolean(replacementUnavailable) ||
              media.active !== index
            }
            aria-label={
              current && !replacementUnavailable && media.active === index
                ? 'Uploaded clip preview'
                : `Upcoming picture ${index + 1}`
            }
            {...media.events[index]}
          />
        ))}
        {(!current || replacementUnavailable) && (
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
          title={
            transport?.playingIntent || playing
              ? 'Pause preview'
              : 'Play preview'
          }
          aria-label={
            transport?.playingIntent || playing
              ? 'Pause preview'
              : 'Play preview'
          }
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <output aria-label="Current time and frame" aria-live="off">
          {frame !== null && timeline.fps
            ? `${formatTimestamp(frame / timeline.fps)} · Frame ${frame} / ${timeline.totalFrames - 1}`
            : 'No current frame'}
        </output>
      </div>
      <p className="preview-note">
        {audioPreview
          ? audioPreview.status === 'ready'
            ? 'Browser picture and sound preview · approximate'
            : (audioPreview.message ?? 'Preparing sound preview')
          : 'Browser picture preview · approximate'}
      </p>
      {(audioPreview?.status === 'resume-required' ||
        audioPreview?.status === 'unsupported' ||
        audioPreview?.status === 'failed') && (
        <div role="status">
          <p>{audioPreview.message}</p>
          <button type="button" onClick={onToggle}>
            Resume Audio
          </button>
        </div>
      )}
    </section>
  );
}
