import type { SourceToken } from '../lib/projectSources';
export function PipCandidateProbe({
  token,
  url,
  onReady,
  onError,
}: {
  token: SourceToken;
  url: string;
  onReady: (token: SourceToken, duration: number) => void;
  onError: (token: SourceToken) => void;
}) {
  return (
    <video
      src={url}
      muted
      preload="metadata"
      aria-label="Loading PIP candidate"
      onLoadedMetadata={(event) => {
        const duration = event.currentTarget.duration;
        if (Number.isFinite(duration) && duration > 0) onReady(token, duration);
        else onError(token);
      }}
      onError={() => onError(token)}
    />
  );
}
