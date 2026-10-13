import { expect, it } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import {
  splitPositioned,
  rippleDeletePositioned,
  trimPositioned,
  movePositioned,
  convertPositionedFps,
  changeReplacementSourceEdit,
} from './positionedEdits';
import type { EditSnapshot } from './editHistory';
function value(r: { value: EditSnapshot } | { error: string }) {
  if ('error' in r) throw new Error(r.error);
  return r.value;
}
it('music_middle_ripple_preserves_source_gap', () => {
  const f = advancedFixture();
  const song = f.sources.register(new File(['a'], 'song.wav'), 'music');
  f.sources.markReady(song, { duration: 8 });
  let s: EditSnapshot = {
    ...f.snapshot,
    musicSourceId: song.sourceId,
    music: [
      {
        id: 'song',
        sourceId: song.sourceId,
        timelineStartFrame: 25,
        sourceStartSample: 0,
        durationFrames: 200,
      },
    ],
  };
  s = value(
    splitPositioned(s, 'music', 'song', 75, { left: 'a', right: 'b' }, 25),
  );
  s = value(
    splitPositioned(s, 'music', 'b', 100, { left: 'middle', right: 'c' }, 25),
  );
  s = value(rippleDeletePositioned(s, 'music', 'middle'));
  expect(
    s.music.map((v) => [
      v.timelineStartFrame,
      v.durationFrames,
      v.sourceStartSample,
    ]),
  ).toEqual([
    [25, 50, 0],
    [75, 125, 144000],
  ]);
  expect(s.video2).toEqual(f.snapshot.video2);
});
it('replacement_split_preserves_normalized_windows', () => {
  const f = advancedFixture();
  f.snapshot.video2[0].contentInFrame = 10;
  const s = value(
    splitPositioned(
      f.snapshot,
      'video2',
      'take',
      60,
      { left: 'a', right: 'b' },
      25,
    ),
  );
  expect(
    s.video2.map((v) => [
      v.timelineStartFrame,
      v.contentInFrame,
      v.contentOutFrame,
      v.contentFullSource,
    ]),
  ).toEqual([
    [40, 10, 30, false],
    [60, 30, 60, false],
  ]);
  expect(
    value(rippleDeletePositioned(s, 'video2', 'a')).video2[0]
      .timelineStartFrame,
  ).toBe(40);
});
it('trim_move_rejects_collision_negative_and_source_exhaustion', () => {
  const f = advancedFixture();
  f.snapshot.video2.push({
    ...f.snapshot.video2[0],
    id: 'other',
    timelineStartFrame: 100,
    contentOutFrame: 20,
  });
  expect(movePositioned(f.snapshot, 'video2', 'take', 90)).toHaveProperty(
    'error',
  );
  expect(movePositioned(f.snapshot, 'video2', 'take', -1)).toHaveProperty(
    'error',
  );
  expect(
    trimPositioned(f.snapshot, 'video2', 'take', 'end', 1, 25, f.sources),
  ).toHaveProperty('error');
  const s = value(
    trimPositioned(f.snapshot, 'video2', 'take', 'start', 5, 25, f.sources),
  );
  expect(s.video2[0].timelineStartFrame).toBe(45);
  expect(s.video2[0].contentInFrame).toBe(5);
  expect(
    splitPositioned(s, 'video2', 'take', 45, { left: 'a', right: 'b' }, 25),
  ).toHaveProperty('error');
});
it('full_source_window_recomputes_L_and_speed_maps_explicit_content', () => {
  const f = advancedFixture();
  f.snapshot.video2[0].contentFullSource = true;
  expect(
    value(convertPositionedFps(f.snapshot, 25, 50, f.sources)).video2[0]
      .contentOutFrame,
  ).toBe(120);
  f.snapshot.video2[0].contentFullSource = false;
  f.snapshot.video2[0].contentInFrame = 10;
  expect(
    value(
      changeReplacementSourceEdit(
        f.snapshot,
        'take',
        f.snapshot.video2[0].trim,
        0.5,
        f.sources,
        25,
        'speed',
      ),
    ).video2[0].contentInFrame,
  ).toBe(20);
});
it('fps_conversion_rejects_empty_quantized_window', () => {
  const f = advancedFixture();
  f.snapshot.video2[0].contentInFrame = 2;
  f.snapshot.video2[0].contentOutFrame = 3;
  expect(convertPositionedFps(f.snapshot, 60, 24, f.sources)).toHaveProperty(
    'error',
  );
});
