import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { MediaBin, TimelineDropZone } from './MediaBin';
import { SOURCE_DRAG_MIME, sourceDragData } from '../lib/placement';
it('Import Media dispatches mixed video and audio files to their existing import handlers', () => {
  const onImport = vi.fn();
  render(
    <MediaBin
      sources={[]}
      disabled={false}
      fps={null}
      onImport={onImport}
      onRemove={() => {}}
      onPlace={() => false}
    />,
  );
  const video = new File(['video'], 'Take.MOV', { type: 'video/quicktime' });
  const audio = new File(['audio'], 'Music.wav', { type: 'audio/wav' });
  fireEvent.change(screen.getByLabelText('Import Media'), {
    target: { files: [video, audio] },
  });
  expect(onImport.mock.calls).toEqual([
    [video, 'video'],
    [audio, 'audio'],
  ]);
});
it('compact_bin_keeps_source_specific_actions_and_loading_errors', () => {
  const f = advancedFixture();
  const source = f.sources.get(f.base.sourceId)!;
  const props = {
    sources: [source],
    disabled: false,
    fps: 25 as const,
    onImport: () => {},
    onRemove: () => {},
    onPlace: () => false,
    onPip: () => {},
  };
  const view = render(<MediaBin {...props} />);
  expect(screen.getByRole('heading', { name: 'Media Bin' })).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Use base.mp4 as PIP' }),
  ).toHaveTextContent('Use as PIP');
  expect(
    screen.getByRole('button', { name: 'Place base.mp4 on track' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Remove base.mp4 from bin' }),
  ).toBeEnabled();
  expect(screen.getByLabelText('Import video to bin')).toHaveAttribute(
    'accept',
    '.mp4,.mov,.webm,.mkv',
  );
  expect(screen.getByLabelText('Import audio to bin')).toHaveAttribute(
    'accept',
    '.mp3,.wav,.aac,.m4a',
  );
  view.rerender(
    <MediaBin {...props} sources={[{ ...source, status: 'loading' }]} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    /Reading metadata.*base.mp4/,
  );
  expect(
    screen.getByRole('button', { name: 'Place base.mp4 on track' }),
  ).toBeDisabled();
  view.rerender(
    <MediaBin {...props} sources={[{ ...source, status: 'error' }]} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Metadata unavailable. Re-import this source.',
  );
});
it('ready_bin_source_has_keyboard_placement_with_track_and_frame_without_removing_source', () => {
  const f = advancedFixture(),
    place = vi.fn(() => true);
  render(
    <MediaBin
      sources={[f.sources.get(f.base.sourceId)!]}
      disabled={false}
      fps={25}
      onImport={() => {}}
      onRemove={() => {}}
      onPlace={place}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Place base.mp4 on track' }),
  );
  fireEvent.change(screen.getByLabelText('Placement start frame'), {
    target: { value: '40' },
  });
  fireEvent.change(screen.getByLabelText('Placement track'), {
    target: { value: 'video2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Place media' }));
  expect(place).toHaveBeenCalledWith(
    expect.objectContaining({
      token: f.base,
      track: 'video2',
      timelineStartFrame: 40,
    }),
  );
  expect(
    screen.getByRole('button', { name: 'Place base.mp4 on track' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('pending_bin_source_is_named_loading_and_cannot_be_placed', () => {
  const f = advancedFixture(),
    source = { ...f.sources.get(f.base.sourceId)!, status: 'loading' as const };
  render(
    <MediaBin
      sources={[source]}
      disabled={false}
      fps={25}
      onImport={() => {}}
      onRemove={() => {}}
      onPlace={() => false}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(/Reading.*base.mp4/);
  expect(
    screen.getByRole('button', { name: 'Place base.mp4 on track' }),
  ).toBeDisabled();
});
it('scrolled_drop_indicator_and_commit_use_the_same_frame', () => {
  vi.stubGlobal('DragEvent', MouseEvent);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: -80,
    width: 300,
  } as DOMRect);
  const f = advancedFixture(),
    commit = vi.fn(() => true),
    draft = { token: f.base, track: 'video1' as const, timelineStartFrame: 0 };
  render(
    <TimelineDropZone
      track="video1"
      label="Video 1 source drop target"
      displayFrames={150}
      disabled={false}
      placement={{
        snapshot: f.snapshot,
        sources: f.sources,
        limits: { max_clips: 20, max_file_size_mb: 200 },
        activeDraft: draft,
        onCommit: commit,
        onExternal: () => {},
        onError: () => {},
      }}
    >
      Clip lane
    </TimelineDropZone>,
  );
  const lane = screen.getByLabelText('Video 1 source drop target'),
    dataTransfer = {
      types: [SOURCE_DRAG_MIME],
      getData: () => sourceDragData(draft),
      dropEffect: 'copy',
    };
  fireEvent.dragOver(lane, { clientX: 25, dataTransfer });
  expect(screen.getByRole('status')).toHaveTextContent('Frame 53');
  fireEvent.drop(lane, { clientX: 25, dataTransfer });
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({ timelineStartFrame: 53 }),
  );
});
