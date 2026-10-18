import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { buildTimeline } from '../lib/timeline';
import { clip, overlays } from '../test/fixtures';
import { ProgramMonitor } from './ProgramMonitor';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from '../lib/advancedTimeline';
const timeline = buildTimeline([clip()], '25');
const props = {
  timeline,
  overlays,
  frame: 19,
  playing: false,
  onSeek: vi.fn(),
  onToggle: vi.fn(),
};
it('compact_program_keeps_transport_and_truthful_state_copy', () => {
  const toggle = vi.fn();
  const audioPreview = {
    status: 'resume-required',
    message: 'Resume sound to audition this source.',
    resumeAudio: async () => true,
  };
  const view = render(
    <ProgramMonitor {...props} onToggle={toggle} audioPreview={audioPreview} />,
  );
  expect(screen.getByRole('heading', { name: 'Program' })).toBeVisible();
  expect(screen.getByLabelText('Current time and frame')).toHaveAttribute(
    'aria-live',
    'off',
  );
  expect(screen.getByRole('button', { name: 'Play preview' })).toHaveAttribute(
    'title',
    'Play preview',
  );
  expect(screen.getAllByText(audioPreview.message).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Resume Audio' }));
  expect(toggle).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  expect(toggle).toHaveBeenCalledTimes(2);
  view.rerender(
    <ProgramMonitor
      {...props}
      playing
      audioPreview={{ ...audioPreview, status: 'ready', message: null }}
    />,
  );
  expect(screen.getByRole('button', { name: 'Pause preview' })).toBeVisible();
  expect(
    screen.getByText('Browser picture and sound preview · approximate'),
  ).toBeVisible();
});
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
it('same_source_split_retains_element_and_does_not_pause_or_seek', () => {
  const a = clip(),
    p = {
      ...props,
      overlays: { image: null, video: null },
      timeline: buildTimeline([a], '25'),
      frame: 19,
      playing: true,
    };
  const view = render(<ProgramMonitor {...p} />);
  const video = screen.getByLabelText(
    'Uploaded clip preview',
  ) as HTMLVideoElement;
  Object.defineProperty(video, 'duration', { value: 2, configurable: true });
  video.currentTime = 19 / 25;
  fireEvent.loadedMetadata(video);
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
  const time = vi.spyOn(video, 'currentTime', 'set');
  view.rerender(
    <ProgramMonitor
      {...p}
      timeline={buildTimeline(
        [
          { ...a, id: 'left', trim: { startFrame: 0, endFrame: 19 } },
          { ...a, id: 'right', trim: { startFrame: 20, endFrame: 59 } },
        ],
        '25',
      )}
    />,
  );
  expect(screen.getByLabelText('Uploaded clip preview')).toBe(video);
  expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  expect(time).not.toHaveBeenCalled();
});
it('preview_switches_at_40_and_returns_at_100', () => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (blob) => `blob:${(blob as File).name}`,
  );
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(f.snapshot, f.sources, {
      image: null,
      video: null,
    });
  const p = {
    ...props,
    timeline: projection.base,
    projection,
    overlays: { image: null, video: null },
    frame: 39,
  };
  const view = render(<ProgramMonitor {...p} />);
  expect(screen.getByLabelText('Uploaded clip preview')).toHaveAttribute(
    'src',
    'blob:base.mp4',
  );
  view.rerender(<ProgramMonitor {...p} frame={40} />);
  expect(screen.getByLabelText('Uploaded clip preview')).toHaveAttribute(
    'src',
    'blob:take.mp4',
  );
  view.rerender(<ProgramMonitor {...p} frame={99} />);
  expect(screen.getByLabelText('Uploaded clip preview')).toHaveAttribute(
    'src',
    'blob:take.mp4',
  );
  view.rerender(<ProgramMonitor {...p} frame={100} />);
  const video = screen.getByLabelText('Uploaded clip preview');
  Object.defineProperty(video, 'duration', { value: 6 });
  fireEvent.loadedMetadata(video);
  expect((video as HTMLVideoElement).currentTime).toBe(4);
});
it('replacement_eof_shows_error_without_frozen_frame_and_backward_seek_recovers', () => {
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(f.snapshot, f.sources, {
      image: null,
      video: null,
    });
  const p = {
    ...props,
    timeline: projection.base,
    projection,
    overlays: { image: null, video: null },
    frame: 99,
  };
  const view = render(<ProgramMonitor {...p} />);
  fireEvent.ended(screen.getByLabelText('Uploaded clip preview'));
  expect(screen.queryByLabelText('Uploaded clip preview')).toBeNull();
  expect(screen.getByText(/replacement.*EOF/i)).toBeVisible();
  view.rerender(<ProgramMonitor {...p} frame={40} />);
  expect(screen.getByLabelText('Uploaded clip preview')).toBeInTheDocument();
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
