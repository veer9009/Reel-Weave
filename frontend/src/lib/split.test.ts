import { expect, it } from 'vitest';
import * as timeline from './timeline';
import { clip } from '../test/fixtures';

it('Split produces contiguous inclusive source ranges with no lost or duplicated frame', () => {
  expect(timeline.planClipSplit).toBeTypeOf('function');
  const target = { ...clip('target'), trim: { startFrame: 10, endFrame: 49 } };
  const result = timeline.planClipSplit(
    timeline.buildTimeline([target], '30'),
    'target',
    19,
  );
  expect(result).toEqual({
    leftTrim: { startFrame: 10, endFrame: 29 },
    rightTrim: { startFrame: 30, endFrame: 49 },
  });
  if ('error' in result) throw new Error(result.error);
  expect(result.leftTrim.endFrame + 1).toBe(result.rightTrim.startFrame);
});

it.each([
  { fps: 60, speed: 0.5 as const, frame: 66, cut: 29 },
  { fps: 30, speed: 0.75 as const, frame: 69, cut: 27 },
])(
  'Split maps project playhead $frame to source frame $cut at $speed speed and $fps FPS',
  ({ fps, speed, frame, cut }) => {
    expect(timeline.planClipSplit).toBeTypeOf('function');
    const target = {
      ...clip('target', fps, speed),
      trim: { startFrame: 10, endFrame: 49 },
    };
    const result = timeline.planClipSplit(
      timeline.buildTimeline([clip('prefix'), target], '25'),
      'target',
      frame,
    );
    expect(result).toEqual({
      leftTrim: { startFrame: 10, endFrame: cut },
      rightTrim: { startFrame: cut + 1, endFrame: 49 },
    });
  },
);

it('Split rejects clip boundaries, missing selections and one-frame ranges without mutation', () => {
  expect(timeline.planClipSplit).toBeTypeOf('function');
  const clips = [
    clip('target'),
    { ...clip('tiny', 30, 0.5), trim: { startFrame: 7, endFrame: 7 } },
  ];
  const before = clips.map((c) => ({ ...c, trim: { ...c.trim! } }));
  const projection = timeline.buildTimeline(clips, '30');
  for (const frame of [0, 59, -1, 60, 1.5]) {
    expect(timeline.planClipSplit(projection, 'target', frame)).toHaveProperty(
      'error',
      expect.any(String),
    );
  }
  expect(timeline.planClipSplit(projection, 'tiny', 61)).toHaveProperty(
    'error',
    expect.stringMatching(/one.frame/i),
  );
  expect(timeline.planClipSplit(projection, 'absent', 20)).toHaveProperty(
    'error',
  );
  // Strictly inside a slow clip can still land on its final source frame.
  const slow = timeline.buildTimeline([clip('slow', 30, 0.5)], '60');
  expect(timeline.planClipSplit(slow, 'slow', 237)).toHaveProperty('error');
  expect(clips).toEqual(before);
});
