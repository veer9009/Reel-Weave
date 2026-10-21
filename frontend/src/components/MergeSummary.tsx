import { formatTimestamp } from '../lib/clips';
import type { Clip } from '../lib/clips';
import type { TimelineProjection } from '../lib/timeline';
type Props = {
  clips: Clip[];
  timeline: TimelineProjection;
  disabled: boolean;
  busy: boolean;
  onMerge: () => void;
  showAction?: boolean;
};
export function RenderAction({
  disabled,
  busy,
  onMerge,
}: Pick<Props, 'disabled' | 'busy' | 'onMerge'>) {
  return (
    <button
      type="button"
      className="primary-button"
      disabled={disabled}
      aria-describedby="render-hint"
      onClick={onMerge}
      title={
        disabled
          ? 'Review Delivery settings before rendering.'
          : 'Render the selected formats (MP4 included)'
      }
    >
      {busy ? 'Rendering MP4' : 'Render MP4'}
    </button>
  );
}
export function MergeSummary({
  clips,
  timeline,
  disabled,
  busy,
  onMerge,
  showAction = true,
}: Props) {
  const hint =
    clips.length < 1
      ? 'Add at least one video clip to render'
      : disabled
        ? 'Resolve metadata, overlay ranges or backend availability before rendering.'
        : 'Ready to render the current timeline.';
  return (
    <section className="summary" aria-label="MP4 delivery">
      <h2>MP4</h2>
      <p>1280 × 720 · H.264 + AAC</p>
      <dl>
        <div>
          <dt>Selected clips</dt>
          <dd>{clips.length} clips</dd>
        </div>
        <div>
          <dt>Project duration</dt>
          <dd>
            {timeline.status === 'ready'
              ? formatTimestamp(timeline.durationSeconds)
              : 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt>Project FPS</dt>
          <dd>{timeline.fps ?? 'Waiting for source FPS'}</dd>
        </div>
      </dl>
      <p>Includes active overlays and configured original/background audio.</p>
      {showAction && (
        <RenderAction disabled={disabled} busy={busy} onMerge={onMerge} />
      )}
      <p id="render-hint">{hint}</p>
    </section>
  );
}
