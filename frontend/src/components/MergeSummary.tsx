import {
  ArrowRight,
  FileVideo,
  Layers,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import { formatDuration, formatSize, outputDuration } from '../lib/clips';
import type { Clip } from '../lib/clips';
type Props = {
  clips: Clip[];
  disabled: boolean;
  busy: boolean;
  onMerge: () => void;
};
export function MergeSummary({ clips, disabled, busy, onMerge }: Props) {
  const duration =
    clips.length && clips.every((c) => c.metadata && c.trim && c.speed)
      ? clips.reduce(
          (n, c) => n + outputDuration(c.trim!, c.metadata!.fps, c.speed!),
          0,
        )
      : undefined;
  return (
    <aside>
      <section className="panel summary" aria-labelledby="summary-title">
        <div className="summary-title">
          <Layers aria-hidden="true" />
          <h2 id="summary-title">Bring it all together</h2>
        </div>
        <div className="output-format">
          <span className="format-icon">
            <FileVideo aria-hidden="true" />
          </span>
          <div>
            <strong>One seamless video</strong>
            <p>MP4 · H.264 + AAC</p>
          </div>
          <span className="format-tag">HD</span>
        </div>
        <dl>
          <div>
            <dt>Selected clips</dt>
            <dd>
              {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
            </dd>
          </div>
          <div>
            <dt>Total size</dt>
            <dd>
              {clips.length
                ? formatSize(clips.reduce((n, c) => n + c.file.size, 0))
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Estimated duration</dt>
            <dd>{duration === undefined ? '—' : formatDuration(duration)}</dd>
          </div>
          <div>
            <dt>Output quality</dt>
            <dd>720p · 30 fps</dd>
          </div>
        </dl>
        <hr className="summary-divider" />
        <p className="output-note">
          <Monitor aria-hidden="true" />
          Different sizes? No problem. Your clips keep their proportions, with
          padding where needed.
        </p>
        <button
          type="button"
          className="primary-button"
          disabled={disabled}
          onClick={onMerge}
        >
          {busy ? 'Merging your story…' : 'Merge clips'}
          <ArrowRight aria-hidden="true" />
        </button>
        <p className="merge-hint">
          {clips.length < 2
            ? 'Add at least 2 clips to get started.'
            : 'Clips merge in the order shown.'}
        </p>
      </section>
      <p className="privacy-note">
        <ShieldCheck aria-hidden="true" />
        <span>
          Your clips are processed on this backend.
          <br />
          Temporary files are automatically cleaned up.
        </span>
      </p>
    </aside>
  );
}
