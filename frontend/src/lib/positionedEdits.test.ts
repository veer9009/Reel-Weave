import { expect, it } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import {
  splitPositioned,
  rippleDeletePositioned,
  trimPositioned,
  movePositioned,
  convertPositionedFps,
  changeReplacementSourceEdit,
  validatePositioned,
} from './positionedEdits';
import type { EditSnapshot } from './editHistory';
it('overlap_errors_name_the_eligible_lane_and_repair', () => {
  const f = advancedFixture();
  expect(
    validatePositioned({
      ...f.snapshot,
      video2: [
        ...f.snapshot.video2,
        { ...f.snapshot.video2[0], id: 'other', timelineStartFrame: 0 },
      ],
    }),
  ).toBe(
    'This range overlaps another clip on Video 2. Move it to a free range.',
  );
});
it('fps_conversion_rescales_base_and_audio_windows_but_freezes_recipe_and_sample_offset', () => {
  const f = advancedFixture();
  const recipe = {
    kind: 'video-edit' as const,
    sourceId: f.base.sourceId,
    sourceStartFrame: 0,
    sourceEndFrame: 149,
    speed: 1 as const,
    normalizationFps: 25 as const,
  };
  const snapshot: EditSnapshot = {
    ...f.snapshot,
    video2: [],
    video1: [
      {
        ...f.snapshot.video1[0],
        outputWindow: { outputInFrame: 40, outputOutFrame: 60 },
      },
    ],
    independentAudio: [
      {
        id: 'sound',
        timelineStartFrame: 10,
        durationFrames: 20,
        sourceStartSample: 19200,
        source: recipe,
      },
    ],
  };
  const converted = value(convertPositionedFps(snapshot, 25, 60, f.sources));
  expect(converted.video1[0].outputWindow).toEqual({
    outputInFrame: 96,
    outputOutFrame: 144,
  });
  expect(converted.independentAudio[0]).toMatchObject({
    timelineStartFrame: 24,
    durationFrames: 48,
    sourceStartSample: 19200,
    source: { normalizationFps: 25 },
  });
});
it('fps_conversion_rejects_collapsed_or_colliding_independent_audio_atomically', () => {
  const f = advancedFixture();
  const source = {
    kind: 'video-edit' as const,
    sourceId: f.base.sourceId,
    sourceStartFrame: 0,
    sourceEndFrame: 149,
    speed: 1 as const,
    normalizationFps: 25 as const,
  };
  const snapshot = {
    ...f.snapshot,
    independentAudio: [
      {
        id: 'sound',
        timelineStartFrame: 1,
        durationFrames: 1,
        sourceStartSample: 0,
        source,
      },
    ],
  };
  expect(convertPositionedFps(snapshot, 60, 24, f.sources)).toHaveProperty(
    'error',
  );
  expect(snapshot.independentAudio[0].durationFrames).toBe(1);
});
it('fps_conversion_rejects_rounding_overlap_and_exact_sample_EOF_padding_threshold', () => {
  const f = advancedFixture();
  const source = {
    kind: 'video-edit' as const,
    sourceId: f.base.sourceId,
    sourceStartFrame: 0,
    sourceEndFrame: 149,
    speed: 1 as const,
    normalizationFps: 25 as const,
  };
  const collision = {
    ...f.snapshot,
    independentAudio: [
      {
        id: 'a',
        timelineStartFrame: 12,
        durationFrames: 12,
        sourceStartSample: 0,
        source,
      },
      {
        id: 'b',
        timelineStartFrame: 24,
        durationFrames: 12,
        sourceStartSample: 0,
        source,
      },
    ],
  };
  expect(convertPositionedFps(collision, 25, 24, f.sources)).toHaveProperty(
    'error',
  );
  const token = f.sources.register(new File(['pcm'], 'short.wav'), 'audio');
  f.sources.markReady(token, { duration: 2000 / 48000, sampleCount: 2000 });
  const eof = {
    ...f.snapshot,
    independentAudio: [
      {
        id: 'eof',
        timelineStartFrame: 0,
        durationFrames: 2,
        sourceStartSample: 0,
        source: { kind: 'audio-file' as const, sourceId: token.sourceId },
      },
    ],
  };
  expect(convertPositionedFps(eof, 25, 24, f.sources)).toHaveProperty('error');
  expect(eof.independentAudio[0].sourceStartSample).toBe(0);
});
function value(r: { value: EditSnapshot } | { error: { message: string } }) {
  if ('error' in r) throw new Error(r.error.message);
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
