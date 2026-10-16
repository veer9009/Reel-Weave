import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from '../lib/advancedTimeline';
import { detachAudio } from '../lib/audioTimeline';
import { IndependentAudioTrack } from './IndependentAudioTrack';
it('independent_segment_has_its_own_selection_name_and_move_trim_gestures', () => {
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(f.snapshot, f.sources, {
      image: null,
      video: null,
    });
  const detached = detachAudio(
    f.snapshot,
    f.sources,
    projection,
    { track: 'video1', id: 'base' },
    () => crypto.randomUUID(),
  );
  if ('error' in detached) throw new Error(detached.error.message);
  const select = vi.fn(),
    edit = vi.fn(() => true);
  render(
    <IndependentAudioTrack
      snapshot={detached.value}
      sources={f.sources}
      projection={projection}
      selection={{ kind: 'none' }}
      disabled={false}
      onSelect={select}
      onEdit={edit}
    />,
  );
  const segment = screen.getByRole('button', {
    name: /Original\/Replacement Audio.*base.mp4.*start 0.*40 frames.*Detached/,
  });
  fireEvent.click(segment);
  expect(select).toHaveBeenCalledWith({
    kind: 'independent',
    id: detached.value.independentAudio[0].id,
  });
  expect(
    screen.getAllByRole('button', { name: /Trim start of independent audio/ }),
  ).toHaveLength(2);
});
