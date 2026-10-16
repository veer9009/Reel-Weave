import { describe, expect, it } from 'vitest';
import { historySnapshot } from '../test/historyFixtures';
import {
  createHistory,
  commitHistory,
  undoHistory,
  redoHistory,
  rebaseHistory,
  snapshotsEqual,
} from './editHistory';

describe('metadata history', () => {
  it('legacy_snapshot_defaults_linked_and_empty_collections', () => {
    const base = historySnapshot();
    const legacy = {
      ...base,
      binSourceIds: undefined,
      independentAudio: undefined,
      video1: base.video1.map((v) => ({
        id: v.id,
        sourceId: v.sourceId,
        trim: v.trim,
        trimSaved: v.trimSaved,
        speed: v.speed,
      })),
    };
    const present = createHistory(legacy).present;
    expect(present.video1[0].originalAudio).toBe('linked');
    expect(present.independentAudio).toEqual([]);
    expect(present.binSourceIds).toEqual([]);
  });
  it('snapshot_roundtrip_keeps_frozen_recipe_windows_and_modes', () => {
    const initial = historySnapshot(['a']);
    const recipe = {
      kind: 'video-edit' as const,
      sourceId: 'source:a',
      sourceStartFrame: 0,
      sourceEndFrame: 59,
      speed: 0.5 as const,
      normalizationFps: 25 as const,
    };
    const segment = {
      id: 'sound',
      timelineStartFrame: 10,
      durationFrames: 20,
      sourceStartSample: 19200,
      source: recipe,
      detachedFrom: { track: 'video1' as const, clipId: 'deleted-owner' },
    };
    const next = {
      ...initial,
      binSourceIds: ['source:a'],
      independentAudio: [segment],
      video1: [
        {
          ...initial.video1[0],
          originalAudio: 'detached' as const,
          outputWindow: { outputInFrame: 10, outputOutFrame: 30 },
        },
      ],
    };
    const history = commitHistory(
      createHistory(initial),
      'trim',
      'Window',
      next,
    );
    recipe.sourceStartFrame = 3;
    next.video1[0].outputWindow.outputInFrame = 12;
    expect(history.present.video1[0].outputWindow).toEqual({
      outputInFrame: 10,
      outputOutFrame: 30,
    });
    expect(history.present.independentAudio[0].source).toMatchObject({
      sourceStartFrame: 0,
      normalizationFps: 25,
    });
    expect(redoHistory(undoHistory(history)).present).toEqual(history.present);
    expect(
      snapshotsEqual(history.present, { ...history.present, binSourceIds: [] }),
    ).toBe(false);
  });
  it('empty_and_noop', () => {
    const h = createHistory(historySnapshot());
    expect(h.past).toHaveLength(0);
    expect(undoHistory(h)).toBe(h);
    expect(redoHistory(h)).toBe(h);
    expect(commitHistory(h, 'trim', 'Trim clip', historySnapshot())).toBe(h);
  });
  it('round_trip_and_branch', () => {
    const h = createHistory(historySnapshot());
    const next = { ...h.present, video1: [...h.present.video1].reverse() };
    const edited = commitHistory(h, 'reorder', 'Reorder clips', next);
    const undone = undoHistory(edited);
    expect(undone.present).toEqual(h.present);
    expect(redoHistory(undone).present).toEqual(next);
    expect(
      commitHistory(undone, 'trim', 'Trim', undone.present).future,
    ).toHaveLength(1);
    expect(
      commitHistory(undone, 'fps', 'FPS', {
        ...undone.present,
        fpsSelection: '25',
      }).future,
    ).toHaveLength(0);
  });
  it('capacity_30', () => {
    let h = createHistory(historySnapshot());
    for (let i = 1; i <= 31; i++)
      h = commitHistory(h, 'trim', 'Trim', {
        ...h.present,
        video1: h.present.video1.map((v, index) =>
          index ? v : { ...v, trim: { startFrame: i, endFrame: 59 } },
        ),
      });
    expect(h.past).toHaveLength(30);
    for (let i = 0; i < 30; i++) h = undoHistory(h);
    expect(h.present.video1[0].trim).toEqual({ startFrame: 1, endFrame: 59 });
    expect(h.past.length + h.future.length).toBe(30);
    for (let i = 0; i < 30; i++) h = redoHistory(h);
    expect(h.present.video1[0].trim?.startFrame).toBe(31);
  });
  it('immutable_lightweight_values and saved_flag_is_a_change', () => {
    const initial = historySnapshot();
    const h = createHistory(initial);
    initial.video1[0].trim!.startFrame = 10;
    expect(h.present.video1[0].trim?.startFrame).toBe(0);
    const next = {
      ...h.present,
      video1: h.present.video1.map((v) => ({ ...v, trimSaved: true })),
    };
    expect(snapshotsEqual(h.present, next)).toBe(false);
    expect(commitHistory(h, 'trim', 'Trim', next).past).toHaveLength(1);
    expect(JSON.stringify(h)).not.toMatch(/blob:|url|file|metadataStatus/);
  });
  it('rebases every neighbor without clearing redo for metadata', () => {
    const h = undoHistory(
      commitHistory(createHistory(historySnapshot()), 'fps', 'FPS', {
        ...historySnapshot(),
        fpsSelection: '25',
      }),
    );
    const rewrite = (s: ReturnType<typeof historySnapshot>) => ({
      ...s,
      video1: [...s.video1, historySnapshot(['c']).video1[0]],
    });
    const rebased = rebaseHistory(h, rewrite, false);
    expect(rebased.future).toHaveLength(1);
    expect(redoHistory(rebased).present.video1.map((v) => v.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(rebaseHistory(h, rewrite, true).future).toHaveLength(0);
  });
});
