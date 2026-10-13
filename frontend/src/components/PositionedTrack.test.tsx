import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from '../lib/advancedTimeline';
import { movePositioned } from '../lib/positionedEdits';
import { PositionedTrack } from './PositionedTrack';
it('positioned_drag_commits_on_release_and_cancel_preserves_position', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 150,
    left: 0,
  } as DOMRect);
  function Harness() {
    const [f] = useState(advancedFixture),
      [s, set] = useState(f.snapshot);
    return (
      <PositionedTrack
        track="video2"
        projection={buildAdvancedTimeline(s, f.sources, {
          image: null,
          video: null,
        })}
        selection={{ kind: 'none' }}
        disabled={false}
        onSelect={() => {}}
        onSeek={() => {}}
        onError={() => {}}
        onFileDrop={() => {}}
        onMove={(id, start) => {
          const next = movePositioned(s, 'video2', id, start);
          if ('value' in next) set(next.value as typeof s);
        }}
      />
    );
  }
  render(<Harness />);
  const button = screen.getByRole('button', { name: /Select Video 2/ });
  fireEvent.pointerDown(button, { button: 0, clientX: 40 });
  fireEvent.pointerMove(button, { clientX: 50 });
  expect(document.activeElement).toBe(button);
  expect(button).toHaveAccessibleName(/40.*99/);
  fireEvent.pointerCancel(button);
  expect(button).toHaveAccessibleName(/40.*99/);
  fireEvent.pointerDown(button, { button: 0, clientX: 40 });
  fireEvent.pointerMove(button, { clientX: 50 });
  fireEvent.pointerUp(button);
  expect(
    screen.getByRole('button', { name: /Select Video 2/ }),
  ).toHaveAccessibleName(/50.*109/);
});
it('cross_track_and_multifile_drop_rejected', () => {
  const f = advancedFixture();
  const error = vi.fn(),
    drop = vi.fn();
  render(
    <PositionedTrack
      track="video2"
      projection={buildAdvancedTimeline(f.snapshot, f.sources, {
        image: null,
        video: null,
      })}
      selection={{ kind: 'none' }}
      disabled={false}
      onSelect={() => {}}
      onSeek={() => {}}
      onError={error}
      onFileDrop={drop}
      onMove={() => {}}
    />,
  );
  const lane = screen.getByLabelText('Video 2 replacement drop target');
  fireEvent.drop(lane, {
    dataTransfer: {
      types: ['Files'],
      files: [new File(['a'], 'a.mp4'), new File(['b'], 'b.mp4')],
    },
  });
  expect(drop).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalled();
});
