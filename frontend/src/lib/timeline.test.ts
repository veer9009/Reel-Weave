import { describe, expect, it } from 'vitest';
import type { Clip } from './clips';
import { buildTimeline } from './timeline';

export function readyClip(id = 'a', fps = 30, speed: 1 | 0.5 | 0.75 = 1): Clip {
  return {
    id,
    file: new File(['video'], `${id}.mp4`),
    url: `blob:${id}`,
    metadataStatus: 'ready',
    metadata: {
      duration: 1,
      fps,
      totalFrames: 30,
      width: 1280,
      height: 720,
      source: 'browser',
    },
    trim: { startFrame: 0, endFrame: 29 },
    trimSaved: false,
    speed,
  };
}
describe('real timeline projection', () => {
  it('windowed_base_keeps_visible_normalized_offset_and_duration', () => {
    const base = readyClip('window', 25);
    const source = {
      ...base,
      metadata: { ...base.metadata!, totalFrames: 60, duration: 2.4 },
      trim: { startFrame: 0, endFrame: 59 },
      outputWindow: { outputInFrame: 40, outputOutFrame: 60 },
    };
    expect(buildTimeline([source], '25').totalFrames).toBe(20);
  });
  it.each([
    [0, 0],
    [-1, 20],
    [20, 31],
    [0.5, 20],
  ])(
    'invalid normalized window %s..%s cannot create timing',
    (outputInFrame, outputOutFrame) => {
      expect(
        buildTimeline(
          [
            {
              ...readyClip('bad', 25),
              outputWindow: { outputInFrame, outputOutFrame },
            },
          ],
          '25',
        ).status,
      ).toBe('unavailable');
    },
  );
  it('empty_has_no_sample_timing', () => {
    expect(buildTimeline([], 'auto')).toEqual({
      status: 'empty',
      fps: null,
      items: [],
      totalFrames: 0,
      durationSeconds: 0,
    });
    expect(buildTimeline([], '25').fps).toBe(25);
  });
  it('mixed_fps_trim_speed_boundaries', () => {
    const result = buildTimeline([readyClip(), readyClip('b', 60, 0.5)], '25');
    expect(
      result.items.map(({ startFrame, endFrame, frameCount }) => [
        startFrame,
        endFrame,
        frameCount,
      ]),
    ).toEqual([
      [0, 24, 25],
      [25, 49, 25],
    ]);
    expect(result.totalFrames).toBe(50);
    expect(result.durationSeconds).toBe(2);
  });
  it.each(['loading', 'error'] as const)(
    'middle %s clip invalidates timing',
    (status) => {
      const middle = { ...readyClip('pending'), metadataStatus: status };
      expect(
        buildTimeline([readyClip(), middle, readyClip('c')], '25'),
      ).toMatchObject({ status: 'unavailable', items: [], totalFrames: 0 });
    },
  );
  it('auto_uses_first_source_only', () => {
    expect(
      buildTimeline(
        [{ ...readyClip(), metadata: undefined }, readyClip('b')],
        'auto',
      ).fps,
    ).toBeNull();
  });
  it('half_up_and_single_frame_match_existing_helper', () => {
    const tiny = { ...readyClip(), trim: { startFrame: 0, endFrame: 0 } };
    expect(buildTimeline([tiny], '24').totalFrames).toBe(1);
    const tie = {
      ...readyClip('tie', 60),
      trim: { startFrame: 0, endFrame: 4 },
    };
    expect(buildTimeline([tie], '30').totalFrames).toBe(3);
  });
});
