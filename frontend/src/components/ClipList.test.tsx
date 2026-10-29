import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ClipList } from './ClipList';
import { clip } from '../test/fixtures';
it('uses decoded video frames rather than a longer audio/container duration', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            duration: 169 / 30,
            fps: 30,
            totalFrames: 169,
            width: 478,
            height: 850,
            source: 'backend',
          }),
        ),
    ),
  );
  const onMetadata = vi.fn();
  render(
    <ClipList
      clips={[
        {
          ...clip('portrait'),
          metadata: undefined,
          trim: undefined,
          metadataStatus: 'loading',
        },
      ]}
      disabled={false}
      onMove={vi.fn()}
      onRemove={vi.fn()}
      onMetadata={onMetadata}
      onMetadataError={vi.fn()}
      onTrim={vi.fn()}
      onSpeedChange={vi.fn()}
    />,
  );
  const video = document.querySelector<HTMLVideoElement>(
    '.clip-thumbnail video',
  )!;
  Object.defineProperties(video, {
    duration: { configurable: true, value: 5.8 },
    videoWidth: { configurable: true, value: 478 },
    videoHeight: { configurable: true, value: 850 },
  });
  fireEvent.loadedMetadata(video);
  await waitFor(() =>
    expect(onMetadata).toHaveBeenCalledWith(
      'portrait',
      expect.objectContaining({ totalFrames: 169, fps: 30, source: 'backend' }),
    ),
  );
});
it('button_reordering_only_and_removal_focuses_nearest_clip', () => {
  const clips = [clip('a'), clip('b')];
  const props = {
    clips,
    disabled: false,
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onMetadata: vi.fn(),
    onMetadataError: vi.fn(),
    onTrim: vi.fn(),
    onSpeedChange: vi.fn(),
  };
  const { rerender } = render(<ClipList {...props} />);
  expect(screen.getAllByRole('listitem').every((item) => !item.draggable)).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Move b.mp4 up' }));
  expect(props.onMove).toHaveBeenLastCalledWith(1, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Move a.mp4 down' }));
  expect(props.onMove).toHaveBeenLastCalledWith(0, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Remove a.mp4' }));
  rerender(<ClipList {...props} clips={[clips[1]]} />);
  expect(screen.getByRole('button', { name: 'Trim b.mp4' })).toHaveFocus();
});
it('shows_per_clip_metadata_readiness', () => {
  render(
    <ClipList
      clips={[
        {
          ...clip(),
          metadata: undefined,
          trim: undefined,
          metadataStatus: 'loading',
        },
      ]}
      disabled={false}
      onMove={vi.fn()}
      onRemove={vi.fn()}
      onMetadata={vi.fn()}
      onMetadataError={vi.fn()}
      onTrim={vi.fn()}
      onSpeedChange={vi.fn()}
    />,
  );
  expect(screen.getByText('Reading metadata…')).toBeVisible();
});
it('keeps ready source metadata when a derived clip thumbnail loads again', () => {
  const onMetadata = vi.fn();
  render(
    <ClipList
      clips={[clip('derived', 60)]}
      disabled={false}
      onMove={vi.fn()}
      onRemove={vi.fn()}
      onMetadata={onMetadata}
      onMetadataError={vi.fn()}
      onTrim={vi.fn()}
      onSpeedChange={vi.fn()}
    />,
  );
  const video = document.querySelector<HTMLVideoElement>(
    '.clip-thumbnail video',
  )!;
  Object.defineProperty(video, 'duration', { configurable: true, value: 2 });
  fireEvent.loadedMetadata(video);
  expect(onMetadata).not.toHaveBeenCalled();
});
