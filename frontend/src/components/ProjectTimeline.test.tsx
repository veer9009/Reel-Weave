import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { buildTimeline } from '../lib/timeline';
import { clip, overlays } from '../test/fixtures';
import { ProjectTimeline } from './ProjectTimeline';
const props = {
  timeline: buildTimeline([clip('a'), clip('b')], '25'),
  overlays,
  backgroundAudio: null,
  audioSettings: {
    originalVolume: 1,
    originalMuted: false,
    musicVolume: 0.3,
    musicMuted: false,
  },
  selection: { kind: 'none' } as const,
  frame: 0,
  fpsSelection: '25' as const,
  disabled: false,
  onFpsSelectionChange: vi.fn(),
  onSeek: vi.fn(),
  onSelect: vi.fn(),
};
it('exact_real_lane_counts_audio_alignment_and_music_presence', () => {
  render(<ProjectTimeline {...props} />);
  expect(
    within(screen.getByRole('region', { name: 'VIDEO 1' })).getAllByRole(
      'button',
    ),
  ).toHaveLength(2);
  expect(
    within(screen.getByRole('region', { name: 'AUDIO 1' })).getAllByRole(
      'button',
    ),
  ).toHaveLength(2);
  expect(
    within(screen.getByRole('region', { name: 'AUDIO 2' })).queryAllByRole(
      'button',
    ),
  ).toHaveLength(0);
  expect(screen.getByLabelText('Timeline position')).toHaveAttribute(
    'max',
    '99',
  );
  expect(screen.getByLabelText('Timeline position')).toHaveAttribute(
    'step',
    '1',
  );
});
it('overlay_sublanes_select_and_seek_without_editing', () => {
  render(<ProjectTimeline {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Select PIP/ }));
  expect(props.onSeek).toHaveBeenCalledWith(10);
  expect(props.onSelect).toHaveBeenCalledWith({
    kind: 'overlay',
    overlayKind: 'video',
  });
});
it('empty_lanes_have_no_samples_or_timing', () => {
  render(
    <ProjectTimeline
      {...props}
      timeline={buildTimeline([], 'auto')}
      frame={null}
    />,
  );
  expect(screen.getByText('Waiting for source FPS')).toBeVisible();
  expect(screen.getByLabelText('Timeline position')).toBeDisabled();
  expect(
    within(screen.getByRole('region', { name: 'VIDEO 1' })).queryAllByRole(
      'button',
    ),
  ).toHaveLength(0);
});
it.each(['queued', 'rendering', 'completed'])(
  'rejects PIP drops while %s editing is locked',
  () => {
    const onPipDrop = vi.fn();
    const view = render(
      <ProjectTimeline {...props} disabled onPipDrop={onPipDrop} />,
    );
    const target = screen.getByLabelText('PIP video drop target');
    fireEvent.dragOver(target, { dataTransfer: { types: ['Files'] } });
    expect(target).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('Replace PIP video')).toBeNull();
    fireEvent.drop(target, {
      dataTransfer: {
        types: ['Files'],
        files: [new File(['pip'], 'locked.mp4')],
      },
    });
    expect(onPipDrop).not.toHaveBeenCalled();
    view.rerender(<ProjectTimeline {...props} onPipDrop={onPipDrop} />);
    fireEvent.drop(target, {
      dataTransfer: {
        types: ['Files'],
        files: [new File(['pip'], 'ready.mp4')],
      },
    });
    expect(onPipDrop).toHaveBeenCalledOnce();
  },
);
it('rejects PIP drops without ready Video 1 timing and ignores text drags', () => {
  const onPipDrop = vi.fn();
  render(
    <ProjectTimeline
      {...props}
      timeline={buildTimeline([], 'auto')}
      onPipDrop={onPipDrop}
    />,
  );
  const target = screen.getByLabelText('PIP video drop target');
  fireEvent.drop(target, {
    dataTransfer: { types: ['Files'], files: [new File(['pip'], 'pip.mp4')] },
  });
  fireEvent.drop(target, {
    dataTransfer: { types: ['text/plain'], files: [] },
  });
  expect(onPipDrop).not.toHaveBeenCalled();
});
