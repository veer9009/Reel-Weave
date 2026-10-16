import { expect, it } from 'vitest';
import * as timeline from './timeline';
import { clip } from '../test/fixtures';
it('windowed_version_replacement_matches_visible_source_interval_and_never_hidden_tail', () => {
  const target = {
    ...clip('fragment', 25),
    outputWindow: { outputInFrame: 40, outputOutFrame: 55 },
    originalAudio: 'detached' as const,
  };
  const donor = clip('donor', 25);
  const result = timeline.planVersionReplacement(
    timeline.buildTimeline([target, donor], '25'),
    'fragment',
    donor,
    6,
  );
  expect(result).toMatchObject({
    leftWindow: { outputInFrame: 40, outputOutFrame: 47 },
    rightTrim: { startFrame: 47, endFrame: 54 },
    rightWindow: { outputInFrame: 0, outputOutFrame: 8 },
  });
  const short = {
    ...donor,
    metadata: { ...donor.metadata!, totalFrames: 50 },
    trim: { startFrame: 0, endFrame: 49 },
  };
  expect(
    timeline.planVersionReplacement(
      timeline.buildTimeline([target, short], '25'),
      'fragment',
      short,
      6,
    ),
  ).toHaveProperty('error');
});

it('version replacement maps the boundary after the inclusive cut by source time across different FPS', () => {
  expect(timeline.planVersionReplacement).toBeTypeOf('function');
  const v1 = {
    ...clip('v1', 30, 0.5),
    metadata: { ...clip().metadata!, totalFrames: 120, duration: 4 },
    trim: { startFrame: 30, endFrame: 89 },
  };
  const v2 = {
    ...clip('v2', 60, 0.75),
    metadata: { ...clip('v2', 60).metadata!, totalFrames: 240, duration: 4 },
    trim: { startFrame: 5, endFrame: 6 },
  };
  const result = timeline.planVersionReplacement(
    timeline.buildTimeline([v1, v2], '30'),
    'v1',
    v2,
    59,
  );
  expect(result).toEqual({
    leftTrim: { startFrame: 30, endFrame: 59 },
    rightTrim: { startFrame: 120, endFrame: 179 },
  });
  if ('error' in result) throw new Error(result.error);
  expect(result.rightTrim.startFrame / v2.metadata.fps).toBe(2);
  expect((result.rightTrim.endFrame + 1) / v2.metadata.fps).toBe(3);
});

it('version replacement rejects boundaries and short V2 without changing any clips', () => {
  expect(timeline.planVersionReplacement).toBeTypeOf('function');
  const v1 = clip('v1');
  const v2 = {
    ...clip('v2'),
    metadata: { ...clip().metadata!, totalFrames: 30, duration: 1 },
    trim: { startFrame: 0, endFrame: 29 },
  };
  const clips = [v1, v2];
  const original = structuredClone(
    clips.map(({ trim, speed, id }) => ({ trim, speed, id })),
  );
  const projection = timeline.buildTimeline(clips, '30');
  for (const frame of [0, 59, 29]) {
    expect(
      timeline.planVersionReplacement(projection, 'v1', v2, frame),
    ).toHaveProperty('error');
  }
  expect(clips.map(({ trim, speed, id }) => ({ trim, speed, id }))).toEqual(
    original,
  );
});
