import { describe, expect, it } from 'vitest';
import { createProjectSources } from './projectSources';
import { historySnapshot } from '../test/historyFixtures';
import type { EditSnapshot, Video1Occurrence } from './editHistory';
import type { ClipSpeed } from './clips';
import { buildAdvancedTimeline, resolveProgramFrame } from './advancedTimeline';
import { overwriteVideo1 } from './overwriteEdits';
import * as edits from './overwriteEdits';

const limits = { max_clips: 20, max_file_size_mb: 200 };
const overlays = { image: null, video: null };
function fixture(fps = 25, speed: ClipSpeed = 1) {
  const sources = createProjectSources();
  const video1 = ['a', 'b', 'c'].map((id) => {
    const token = sources.register(new File(['media'], `${id}.mp4`), 'video1');
    sources.markReady(token, {
      clipMetadata: {
        duration: 10,
        totalFrames: 250,
        fps,
        width: 320,
        height: 180,
        source: 'browser',
      },
    });
    return {
      id,
      sourceId: token.sourceId,
      trim: { startFrame: 0, endFrame: 59 },
      trimSaved: true,
      speed,
      originalAudio: 'linked' as const,
    };
  });
  const token = sources.register(new File(['x'], 'x.mp4'), 'video2');
  sources.markReady(token, {
    clipMetadata: {
      duration: 10,
      totalFrames: 250,
      fps: 25,
      width: 320,
      height: 180,
      source: 'browser',
    },
  });
  const placed: Video1Occurrence = {
    id: 'draft',
    sourceId: token.sourceId,
    trim: { startFrame: 0, endFrame: 59 },
    trimSaved: true,
    speed: 1,
  };
  const snapshot: EditSnapshot = {
    ...historySnapshot([]),
    fpsSelection: '25',
    video1,
  };
  let serial = 0;
  const allocate = () => `new-${serial++}`;
  return { sources, snapshot, placed, allocate };
}
function unwrap(result: ReturnType<typeof overwriteVideo1>) {
  if ('error' in result) throw new Error(result.error.message);
  return result.value;
}
describe('atomic Video 1 overwrite', () => {
  it('speed_keeps_existing_unsaved_source_trim_signal', () => {
    const f = fixture();
    const snapshot = {
      ...f.snapshot,
      video1: [{ ...f.snapshot.video1[0], trimSaved: false }],
    };
    expect(
      unwrap(
        edits.changeBaseSourceEdit(
          snapshot,
          'a',
          snapshot.video1[0].trim!,
          0.5,
          'speed',
          f.sources,
          25,
        ),
      ).video1[0].trimSaved,
    ).toBe(false);
  });
  it('base_speed_preserves_window_coverage_and_trim_resets_only_selected_window', () => {
    const f = fixture();
    const snapshot = {
      ...f.snapshot,
      video1: [
        {
          ...f.snapshot.video1[0],
          outputWindow: { outputInFrame: 40, outputOutFrame: 60 },
        },
        f.snapshot.video1[1],
      ],
    };
    const slowed = unwrap(
      edits.changeBaseSourceEdit(
        snapshot,
        'a',
        { startFrame: 0, endFrame: 59 },
        0.5,
        'speed',
        f.sources,
        25,
      ),
    );
    expect(slowed.video1[0].outputWindow).toEqual({
      outputInFrame: 80,
      outputOutFrame: 120,
    });
    const trimmed = unwrap(
      edits.changeBaseSourceEdit(
        snapshot,
        'a',
        { startFrame: 10, endFrame: 29 },
        1,
        'trim',
        f.sources,
        25,
      ),
    );
    expect(trimmed.video1[0].outputWindow).toBeUndefined();
    expect(trimmed.video1[1]).toBe(snapshot.video1[1]);
    expect(
      edits.changeBaseSourceEdit(
        snapshot,
        'a',
        { startFrame: 50, endFrame: 300 },
        1,
        'trim',
        f.sources,
        25,
      ),
    ).toHaveProperty('error');
  });
  it('preserves_exact_boundary_offsets_and_later_ids', () => {
    const f = fixture();
    const next = unwrap(
      overwriteVideo1(f.snapshot, f.sources, f.placed, 40, limits, f.allocate),
    );
    const p = buildAdvancedTimeline(next, f.sources, overlays);
    expect(p.base.items.map((v) => v.startFrame)).toEqual([0, 40, 100, 120]);
    expect(p.base.items.map((v) => v.frameCount)).toEqual([40, 60, 20, 60]);
    expect(next.video1[2].outputWindow).toEqual({
      outputInFrame: 40,
      outputOutFrame: 60,
    });
    expect(next.video1[3].id).toBe('c');
    expect(next.video1.slice(0, 3).map((v) => v.id)).not.toContain('a');
    expect(p.base.totalFrames).toBe(180);
    expect(next.video2).toBe(f.snapshot.video2);
    expect(next.music).toBe(f.snapshot.music);
    expect(next.independentAudio).toBe(f.snapshot.independentAudio);
  });
  it.each([
    [40, 90, 180],
    [150, 70, 220],
    [180, 60, 240],
    [0, 60, 180],
  ])('range %s + %s preserves or extends N=%s', (start, duration, total) => {
    const f = fixture();
    const placed = {
      ...f.placed,
      trim: { startFrame: 0, endFrame: duration - 1 },
    };
    const next = unwrap(
      overwriteVideo1(f.snapshot, f.sources, placed, start, limits, f.allocate),
    );
    expect(
      buildAdvancedTimeline(next, f.sources, overlays).base.totalFrames,
    ).toBe(total);
    if (duration === 90)
      expect(next.video1.at(-1)?.outputWindow).toEqual({
        outputInFrame: 10,
        outputOutFrame: 60,
      });
  });
  it.each([-1, 181, 0.5, NaN, Infinity])(
    'rejects invalid placement %s atomically',
    (p) => {
      const f = fixture();
      const before = JSON.stringify(f.snapshot);
      expect(
        overwriteVideo1(f.snapshot, f.sources, f.placed, p, limits, f.allocate),
      ).toHaveProperty('error');
      expect(JSON.stringify(f.snapshot)).toBe(before);
    },
  );
  it('accepts_only_zero_on_empty_base_and_checks_final_fragment_capacity', () => {
    const f = fixture();
    const empty = { ...f.snapshot, video1: [] };
    expect(
      unwrap(overwriteVideo1(empty, f.sources, f.placed, 0, limits, f.allocate))
        .video1,
    ).toHaveLength(1);
    expect(
      overwriteVideo1(empty, f.sources, f.placed, 1, limits, f.allocate),
    ).toHaveProperty('error');
    expect(
      overwriteVideo1(
        f.snapshot,
        f.sources,
        f.placed,
        40,
        { ...limits, max_clips: 3 },
        f.allocate,
      ),
    ).toHaveProperty('error');
  });
  it('single_middle_overwrite_preserves_both_windows_and_detached_mode', () => {
    const f = fixture();
    const snapshot = {
      ...f.snapshot,
      video1: [{ ...f.snapshot.video1[0], originalAudio: 'detached' as const }],
    };
    const next = unwrap(
      overwriteVideo1(
        snapshot,
        f.sources,
        { ...f.placed, trim: { startFrame: 0, endFrame: 9 } },
        20,
        limits,
        f.allocate,
      ),
    );
    expect(next.video1.map((v) => v.outputWindow)).toEqual([
      { outputInFrame: 0, outputOutFrame: 20 },
      undefined,
      { outputInFrame: 30, outputOutFrame: 60 },
    ]);
    expect([
      next.video1[0].originalAudio,
      next.video1[2].originalAudio,
    ]).toEqual(['detached', 'detached']);
  });
  it.each([24, 30, 60])(
    'every outside frame retains source time for FPS %s and slow speeds',
    (fps) => {
      for (const speed of [1, 0.75, 0.5] as const) {
        const f = fixture(fps, speed);
        const before = buildAdvancedTimeline(f.snapshot, f.sources, overlays);
        const next = unwrap(
          overwriteVideo1(
            f.snapshot,
            f.sources,
            { ...f.placed, trim: { startFrame: 0, endFrame: 19 } },
            20,
            limits,
            f.allocate,
          ),
        );
        const after = buildAdvancedTimeline(next, f.sources, overlays);
        for (let frame = 0; frame < before.base.totalFrames; frame++) {
          if (frame >= 20 && frame < 40) continue;
          expect(resolveProgramFrame(after, frame)?.clip.file).toBe(
            resolveProgramFrame(before, frame)?.clip.file,
          );
          expect(resolveProgramFrame(after, frame)?.sourceTime).toBeCloseTo(
            resolveProgramFrame(before, frame)!.sourceTime,
            9,
          );
        }
      }
    },
  );
  it('rejects_overwrite_that_changes_auto_fps', () => {
    const f = fixture(30);
    expect(
      overwriteVideo1(
        { ...f.snapshot, fpsSelection: 'auto' },
        f.sources,
        f.placed,
        0,
        limits,
        f.allocate,
      ),
    ).toMatchObject({
      error: {
        message:
          'This overwrite changes Auto FPS. Choose an explicit project FPS before placing this clip.',
      },
    });
  });
  it('video2_picture_and_independent_audio_survive_at_absolute_positions', () => {
    const f = fixture();
    const snapshot = {
      ...f.snapshot,
      video2: [
        {
          id: 'take',
          sourceId: f.placed.sourceId,
          trim: f.placed.trim!,
          trimSaved: true,
          speed: 1 as const,
          timelineStartFrame: 40,
          contentInFrame: 0,
          contentOutFrame: 60,
          contentFullSource: false,
        },
      ],
      independentAudio: [
        {
          id: 'sound',
          timelineStartFrame: 40,
          durationFrames: 10,
          sourceStartSample: 0,
          source: {
            kind: 'video-edit' as const,
            sourceId: f.snapshot.video1[0].sourceId,
            sourceStartFrame: 0,
            sourceEndFrame: 59,
            speed: 1 as const,
            normalizationFps: 25 as const,
          },
        },
      ],
    };
    const next = unwrap(
      overwriteVideo1(snapshot, f.sources, f.placed, 40, limits, f.allocate),
    );
    expect(next.video2).toBe(snapshot.video2);
    expect(next.independentAudio).toBe(snapshot.independentAudio);
    expect(
      resolveProgramFrame(buildAdvancedTimeline(next, f.sources, overlays), 40)
        ?.track,
    ).toBe('video2');
  });
});
