import { useEffect, useRef } from 'react';
import { detectFrameRate } from '../lib/clips';
import { inspectVideoMetadata } from '../lib/videoMetadata';
import type { SourceToken, SourceMetadata } from '../lib/projectSources';
import type { PositionedTrack } from '../lib/positionedEdits';
export function TimelineSourceProbe({
  token,
  file,
  url,
  track,
  onReady,
  onError,
}: {
  token: SourceToken;
  file: File;
  url: string;
  track: PositionedTrack | 'bin-video' | 'bin-audio';
  onReady: (token: SourceToken, metadata: SourceMetadata) => void;
  onError: (token: SourceToken) => void;
}) {
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current = null;
    return () => request.current?.abort();
  }, [file, url, token.sourceId, token.session, token.requestId]);
  if (track === 'music' || track === 'bin-audio')
    return (
      <audio
        title={file.name}
        src={url}
        preload="metadata"
        aria-label={
          track === 'music'
            ? 'Loading music candidate'
            : 'Loading bin audio candidate'
        }
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          if (Number.isFinite(duration) && duration > 0)
            onReady(token, {
              duration,
              sampleCount: Math.floor(duration * 48000 + 0.5),
              metadataOrigin: 'browser',
            });
          else onError(token);
        }}
        onError={() => onError(token)}
      />
    );
  return (
    <video
      title={file.name}
      src={url}
      muted
      playsInline
      preload="metadata"
      style={{ display: 'none' }}
      aria-label={
        track === 'video2'
          ? 'Loading replacement candidate'
          : 'Loading bin video candidate'
      }
      onLoadedMetadata={(event) => {
        const video = event.currentTarget,
          duration = video.duration,
          width = video.videoWidth,
          height = video.videoHeight;
        if (
          !Number.isFinite(duration) ||
          duration <= 0 ||
          width <= 0 ||
          height <= 0
        ) {
          onError(token);
          return;
        }
        if (request.current) return;
        const controller = new AbortController();
        request.current = controller;
        void (async () => {
          try {
            // Browser duration can include an audio tail; frozen recipes need
            // the decoded video frame count used by export validation.
            let metadata = await inspectVideoMetadata(file, controller.signal);
            if (!metadata) {
              const fps = await detectFrameRate(video);
              metadata = {
                duration,
                fps,
                totalFrames: Math.max(1, Math.floor(duration * fps + 0.5)),
                width,
                height,
                source: 'browser',
              };
            }
            if (!controller.signal.aborted)
              onReady(token, { clipMetadata: metadata });
          } catch {
            if (!controller.signal.aborted) onError(token);
          }
        })();
      }}
      onError={() => onError(token)}
    />
  );
}
