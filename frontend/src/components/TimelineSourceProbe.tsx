import { detectFrameRate } from '../lib/clips';
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
        void detectFrameRate(video).then((fps) =>
          onReady(token, {
            clipMetadata: {
              duration,
              fps,
              totalFrames: Math.max(1, Math.floor(duration * fps + 0.5)),
              width,
              height,
              source: 'browser',
            },
          }),
        );
      }}
      onError={() => onError(token)}
    />
  );
}
