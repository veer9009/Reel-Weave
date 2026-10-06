import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { buildTimeline } from '../lib/timeline';
import { clip, overlays } from '../test/fixtures';
import { ProgramMonitor } from './ProgramMonitor';
const timeline = buildTimeline([clip()], '25');
const props = {
  timeline,
  overlays,
  frame: 19,
  playing: false,
  onSeek: vi.fn(),
  onToggle: vi.fn(),
};
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
it('empty_monitor_no_video', () => {
  render(
    <ProgramMonitor
      {...props}
      timeline={buildTimeline([], 'auto')}
      frame={null}
    />,
  );
  expect(screen.getByText('Add video clips to begin')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Play preview' })).toBeDisabled();
});
it('pip_short_source_absent_at_eof_and_seek_back_restores', () => {
  const { rerender } = render(<ProgramMonitor {...props} />);
  expect(screen.getByLabelText('PIP overlay preview')).toBeVisible();
  rerender(<ProgramMonitor {...props} frame={20} />);
  expect(screen.queryByLabelText('PIP overlay preview')).toBeNull();
  expect(screen.getByLabelText('Image overlay preview')).toBeVisible();
  rerender(<ProgramMonitor {...props} frame={49} />);
  expect(screen.queryByLabelText('PIP overlay preview')).toBeNull();
  rerender(<ProgramMonitor {...props} frame={19} />);
  expect(screen.getByLabelText('PIP overlay preview')).toBeVisible();
});
it('image_inclusive_boundaries_and_pip_schedule_ends_before_source', () => {
  const longer = {
    ...overlays,
    video: { ...overlays.video!, duration: 10, endFrame: 19 },
  };
  const { rerender } = render(<ProgramMonitor {...props} overlays={longer} />);
  expect(screen.getByLabelText('PIP overlay preview')).toBeVisible();
  rerender(<ProgramMonitor {...props} overlays={longer} frame={20} />);
  expect(screen.queryByLabelText('PIP overlay preview')).toBeNull();
  rerender(<ProgramMonitor {...props} frame={49} />);
  expect(screen.getByLabelText('Image overlay preview')).toBeVisible();
  rerender(<ProgramMonitor {...props} frame={50} />);
  expect(screen.queryByLabelText('Image overlay preview')).toBeNull();
});
it('paused_metadata_load_seeks_trim_and_speed_maps_source_time', () => {
  const source = {
    ...clip('trim', 30, 0.5),
    metadata: { ...clip().metadata!, duration: 5, totalFrames: 150 },
    trim: { startFrame: 60, endFrame: 89 },
  };
  render(
    <ProgramMonitor
      {...props}
      timeline={buildTimeline([source], '25')}
      frame={25}
    />,
  );
  const video = screen.getByLabelText(
    'Uploaded clip preview',
  ) as HTMLVideoElement;
  Object.defineProperty(video, 'duration', { value: 5, configurable: true });
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(2.5);
  expect(video.playbackRate).toBe(0.5);
  expect(video.muted).toBe(true);
});
it('cross_clip_boundary_switches_source_and_reports_error', () => {
  const sequence = buildTimeline([clip('a'), clip('b')], '25');
  const { rerender } = render(
    <ProgramMonitor {...props} timeline={sequence} frame={49} />,
  );
  expect(screen.getByLabelText('Uploaded clip preview')).toHaveAttribute(
    'src',
    'blob:a',
  );
  rerender(<ProgramMonitor {...props} timeline={sequence} frame={50} />);
  const video = screen.getByLabelText('Uploaded clip preview');
  expect(video).toHaveAttribute('src', 'blob:b');
  fireEvent.error(video);
  expect(screen.getByText(/cannot play in this browser/)).toBeVisible();
});
it('actual_pip_ended_hides_last_frame_and_source_replacement_restores', () => {
  const { rerender, unmount } = render(<ProgramMonitor {...props} />);
  fireEvent.ended(screen.getByLabelText('PIP overlay preview'));
  expect(screen.queryByLabelText('PIP overlay preview')).toBeNull();
  rerender(
    <ProgramMonitor
      {...props}
      overlays={{
        ...overlays,
        video: { ...overlays.video!, url: 'blob:replacement' },
      }}
    />,
  );
  expect(screen.getByLabelText('PIP overlay preview')).toBeVisible();
  unmount();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});
it('actual_eof_latch_clears_after_backward_seek', () => {
  const { rerender } = render(<ProgramMonitor {...props} />);
  fireEvent.ended(screen.getByLabelText('PIP overlay preview'));
  rerender(<ProgramMonitor {...props} frame={18} />);
  expect(screen.getByLabelText('PIP overlay preview')).toBeVisible();
  rerender(<ProgramMonitor {...props} frame={19} />);
  expect(screen.getByLabelText('PIP overlay preview')).toBeVisible();
});
it('actual_eof_latch_reconciles_start_frame_and_fps_changes', () => {
  const { rerender } = render(<ProgramMonitor {...props} />);
  fireEvent.ended(screen.getByLabelText('PIP overlay preview'));
  const scheduled = {
    ...overlays,
    video: { ...overlays.video!, startFrame: 25, endFrame: 49 },
  };
  rerender(<ProgramMonitor {...props} overlays={scheduled} frame={25} />);
  expect(screen.getByLabelText('PIP overlay preview')).toBeVisible();
  fireEvent.ended(screen.getByLabelText('PIP overlay preview'));
  rerender(
    <ProgramMonitor
      {...props}
      overlays={scheduled}
      frame={25}
      timeline={buildTimeline([clip()], '50')}
    />,
  );
  expect(screen.getByLabelText('PIP overlay preview')).toBeVisible();
  rerender(
    <ProgramMonitor
      {...props}
      overlays={scheduled}
      frame={45}
      timeline={buildTimeline([clip()], '50')}
    />,
  );
  expect(screen.queryByLabelText('PIP overlay preview')).toBeNull();
});
