import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ClipList } from './ClipList';
import { clip } from '../test/fixtures';
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
