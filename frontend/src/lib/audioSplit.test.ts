import { describe, expect, it, vi } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from './advancedTimeline';
import { SUPPORTED_PROJECT_FPS } from './clips';
import { audioSplitIssue, planAudioSplit } from './audioSplit';
import type { AudioSplitRequest } from './audioSplit';

function fixture(kind: 'independent' | 'music' = 'independent', fps = 30) {
  const f = advancedFixture();
  const token = f.sources.register(new File(['audio'], 'voice.wav'), 'audio');
  f.sources.markReady(token, { duration: 30, sampleCount: 1440000 });
  const segment = {
    id: 'audio',
    timelineStartFrame: 100,
    durationFrames: 60,
    sourceStartSample: 4800,
  };
  const snapshot = {
    ...f.snapshot,
    fpsSelection: String(fps) as AudioSplitRequest['snapshot']['fpsSelection'],
    // A 30-project-frame replacement window is representable at every tested FPS.
    video2: f.snapshot.video2.map((v) => ({ ...v, contentOutFrame: 30 })),
    independentAudio:
      kind === 'independent'
        ? [
            {
              ...segment,
              source: { kind: 'audio-file' as const, sourceId: token.sourceId },
            },
          ]
        : [],

    music: kind === 'music' ? [{ ...segment, sourceId: token.sourceId }] : [],
  };
  const request: AudioSplitRequest = {
    snapshot,
    sources: f.sources,
    projection: buildAdvancedTimeline(snapshot, f.sources, {
      image: null,
      video: null,
    }),
    target: { kind, id: 'audio' },
    frame: 125,
    editingLocked: false,
    gestureActive: false,
    modalOpen: false,
    limits: {
      max_clips: 20,
      max_file_size_mb: 200,
      max_audio_file_size_mb: 100,
    },
  };
  return request;
}

describe.each(['independent', 'music'] as const)('%s audio split', (kind) => {
  it('repeated cuts preserve every contiguous source window and the untouched first piece', () => {
    let serial = 0;
    const allocate = () => `piece-${++serial}`;
    const request = fixture(kind, 30);
    const first = planAudioSplit(request, allocate);
    if (!('value' in first)) throw new Error(first.error.message);
    const next = planAudioSplit(
      {
        ...request,
        snapshot: first.value.nextSnapshot,
        target: { kind, id: first.value.rightId },
        frame: 140,
      },
      allocate,
    );
    if (!('value' in next)) throw new Error(next.error.message);
    const pieces =
      kind === 'music'
        ? next.value.nextSnapshot.music
        : next.value.nextSnapshot.independentAudio;
    expect(
      pieces.map((v) => [
        v.timelineStartFrame,
        v.durationFrames,
        v.sourceStartSample,
      ]),
    ).toEqual([
      [100, 25, 4800],
      [125, 15, 44800],
      [140, 20, 68800],
    ]);
    expect(pieces[0].id).toBe(first.value.leftId);
    expect(new Set(pieces.map((v) => v.id)).size).toBe(3);
  });
  it.each(SUPPORTED_PROJECT_FPS)(
    'splits at the exact project frame at %s FPS',
    (fps) => {
      const request = fixture(kind, fps);
      const before = structuredClone(request.snapshot);
      let serial = 0;
      const result = planAudioSplit(request, () => `half-${++serial}`);
      expect('value' in result).toBe(true);
      if (!('value' in result)) throw new Error(result.error.message);
      const pieces =
        kind === 'music'
          ? result.value.nextSnapshot.music
          : result.value.nextSnapshot.independentAudio;
      expect(
        pieces.map((v) => [
          v.timelineStartFrame,
          v.durationFrames,
          v.sourceStartSample,
        ]),
      ).toEqual([
        [100, 25, 4800],
        [125, 35, 4800 + 1200000 / fps],
      ]);
      expect(result.value.leftId).toBe('half-1');
      expect(result.value.rightId).toBe('half-2');
      expect(result.value.nextSnapshot.video1).toEqual(before.video1);
      expect(result.value.nextSnapshot.video2).toEqual(before.video2);
      expect(request.snapshot).toEqual(before);
    },
  );

  it.each([null, 100, 160, 99, 161, 125.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid boundary %s without allocating or changing the project',
    (frame) => {
      const request = { ...fixture(kind), frame };
      const before = structuredClone(request.snapshot);
      const allocate = vi.fn(() => 'unused');
      expect(planAudioSplit(request, allocate)).toHaveProperty('error');
      expect(allocate).not.toHaveBeenCalled();
      expect(request.snapshot).toEqual(before);
    },
  );

  it.each(['editingLocked', 'gestureActive', 'modalOpen'] as const)(
    'explains %s and leaves allocation untouched',
    (key) => {
      const request = { ...fixture(kind), [key]: true };
      const allocate = vi.fn(() => 'unused');
      expect(audioSplitIssue(request)?.message).toBeTruthy();
      expect(planAudioSplit(request, allocate)).toHaveProperty('error');
      expect(allocate).not.toHaveBeenCalled();
    },
  );

  it('rejects stale selection, missing source, capacity and colliding IDs', () => {
    const r = fixture(kind);
    expect(
      audioSplitIssue({ ...r, target: { kind, id: 'missing' } }),
    ).toBeTruthy();
    expect(audioSplitIssue({ ...r, target: null })?.message).toMatch(/select/i);
    expect(
      audioSplitIssue({ ...r, limits: { ...r.limits, max_music_segments: 1 } }),
    ).toBeTruthy();
    expect(planAudioSplit(r, () => 'base')).toHaveProperty('error');
    const sourceId =
      kind === 'music'
        ? r.snapshot.music[0].sourceId
        : r.snapshot.independentAudio[0].source.sourceId;
    r.sources.get(sourceId)!.status = 'error';
    expect(audioSplitIssue(r)?.message).toMatch(/source|media/i);
  });
});

it.each([1, 0.75, 0.5] as const)(
  'keeps a frozen detached recipe at speed %s without double-scaling offsets',
  (speed) => {
    const r = fixture('independent', 30);
    const recipe = {
      kind: 'video-edit' as const,
      sourceId: r.snapshot.video1[0].sourceId,
      sourceStartFrame: 0,
      sourceEndFrame: 149,
      speed,
      normalizationFps: 25 as const,
    };
    const provenance = {
      track: 'video1' as const,
      clipId: r.snapshot.video1[0].id,
    };
    r.snapshot = {
      ...r.snapshot,
      video1: r.snapshot.video1.map((v) => ({
        ...v,
        originalAudio: 'detached',
      })),
      independentAudio: [
        {
          ...r.snapshot.independentAudio[0],
          source: recipe,
          detachedFrom: provenance,
        },
      ],
    };
    let id = 0;
    const result = planAudioSplit(r, () => `frozen-${++id}`);
    if (!('value' in result)) throw new Error(result.error.message);
    expect(
      result.value.nextSnapshot.independentAudio.map(
        (v) => v.sourceStartSample,
      ),
    ).toEqual([4800, 44800]);
    for (const piece of result.value.nextSnapshot.independentAudio) {
      expect(piece.source).toEqual(recipe);
      expect(piece.detachedFrom).toEqual(provenance);
    }
    expect(result.value.nextSnapshot.video1).toEqual(r.snapshot.video1);
  },
);
