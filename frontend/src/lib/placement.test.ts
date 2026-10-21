import { expect, it } from 'vitest';
import * as placement from './placement';
import { advancedFixture } from '../test/historyFixtures';
const limits = { max_clips: 20, max_file_size_mb: 200 };
it('scroll_coordinates_round_half_up_once_and_reject_outside_content', () => {
  expect(placement.dropFrame(25, -80, 2)).toEqual({ value: 53 });
  for (const args of [
    [-1, 0, 2],
    [0, 0, 0],
    [NaN, 0, 2],
    [2, Infinity, 1],
  ])
    expect(
      placement.dropFrame(...(args as [number, number, number])),
    ).toHaveProperty('error');
});
it('source_drag_roundtrips_only_token_and_draft_and_rejects_stale_or_malformed_data', () => {
  const f = advancedFixture(),
    draft = { token: f.base, track: 'video1' as const, timelineStartFrame: 0 };
  const raw = placement.sourceDragData({
    ...draft,
    url: 'blob:private',
    path: 'private',
  } as typeof draft);
  expect(raw).not.toMatch(/private|blob:|path|url/);
  expect(placement.parseSourceDragData(raw, f.sources)).toEqual({
    value: draft,
  });
  expect(placement.parseSourceDragData('{broken', f.sources)).toHaveProperty(
    'error',
  );
  expect(
    placement.parseSourceDragData(
      JSON.stringify({
        version: 1,
        draft: { ...draft, token: { ...f.base, session: 99 } },
      }),
      f.sources,
    ),
  ).toHaveProperty('error');
});
it('placement_video2_touching_edges_is_valid_overlap_and_outside_are_atomic', () => {
  const f = advancedFixture(),
    draft = {
      token: f.take,
      track: 'video2' as const,
      timelineStartFrame: 100,
      trim: { startFrame: 0, endFrame: 49 },
    };
  expect(
    placement.validatePlacement(f.snapshot, f.sources, draft, limits),
  ).toHaveProperty('value');
  expect(
    placement.validatePlacement(
      f.snapshot,
      f.sources,
      { ...draft, timelineStartFrame: 99 },
      limits,
    ),
  ).toMatchObject({ error: { code: 'invalid_overlap' } });
  expect(
    placement.validatePlacement(
      f.snapshot,
      f.sources,
      { ...draft, timelineStartFrame: 101 },
      limits,
    ),
  ).toMatchObject({
    error: { message: 'Replacement clips must fit within Video 1.' },
  });
  expect(f.snapshot.video2[0].timelineStartFrame).toBe(40);
});
it('video_into_audio_requires_explicit_detach_and_music_pieces_keep_independent_sources', () => {
  const f = advancedFixture();
  expect(
    placement.validatePlacement(
      f.snapshot,
      f.sources,
      { token: f.base, track: 'independent', timelineStartFrame: 0 },
      limits,
    ),
  ).toHaveProperty('error');
  const a = f.sources.register(new File(['a'], 'a.wav'), 'audio'),
    b = f.sources.register(new File(['b'], 'b.wav'), 'audio');
  f.sources.markReady(a, { duration: 3, sampleCount: 144000 });
  f.sources.markReady(b, { duration: 3, sampleCount: 144000 });
  const snapshot = {
    ...f.snapshot,

    music: [
      {
        id: 'song',
        sourceId: a.sourceId,
        timelineStartFrame: 0,
        durationFrames: 10,
        sourceStartSample: 0,
      },
    ],
  };
  expect(
    placement.validatePlacement(
      snapshot,
      f.sources,
      { token: a, track: 'music', timelineStartFrame: 20, durationFrames: 10 },
      limits,
    ),
  ).toHaveProperty('value');
  const mixed = placement.validatePlacement(
    snapshot,
    f.sources,
    { token: b, track: 'music', timelineStartFrame: 20, durationFrames: 10 },
    limits,
  );
  expect(mixed).toHaveProperty('value');
  if (!('value' in mixed)) throw new Error(mixed.error.message);
  expect(
    mixed.value.music.map((v) => [
      v.sourceId,
      v.timelineStartFrame,
      v.durationFrames,
    ]),
  ).toEqual([
    [a.sourceId, 0, 10],
    [b.sourceId, 20, 10],
  ]);
  expect(mixed.value.video1).toEqual(snapshot.video1);
  expect(snapshot.music).toHaveLength(1);
});
it('keyboard_timecodes_share_half_up_project_frame_mapping', () => {
  expect(placement.timecodeFrame('00:01.600', 25)).toEqual({ value: 40 });
  expect(placement.timecodeFrame('00:00:01:15', 25)).toEqual({ value: 40 });
  expect(placement.timecodeFrame('00:00:01:25', 25)).toHaveProperty('error');
});
it('invalid_draft_speed_and_sample_ranges_do_not_commit', () => {
  const f = advancedFixture();
  expect(
    placement.validatePlacement(
      f.snapshot,
      f.sources,
      {
        token: f.base,
        track: 'video1',
        timelineStartFrame: 0,
        speed: 2 as never,
      },
      limits,
    ),
  ).toHaveProperty('error');
  expect(
    placement.validatePlacement(
      f.snapshot,
      f.sources,
      {
        token: f.base,
        track: 'video2',
        timelineStartFrame: 0,
        trim: { startFrame: 0.5, endFrame: 10 },
      },
      limits,
    ),
  ).toHaveProperty('error');
});
