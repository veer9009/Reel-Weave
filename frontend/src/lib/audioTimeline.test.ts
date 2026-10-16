import { describe, expect, it } from 'vitest';
import * as audio from './audioTimeline';
import type { IndependentAudioSegment } from './audioTimeline';
import type { EditSnapshot } from './editHistory';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from './advancedTimeline';
import { overwriteVideo1 } from './overwriteEdits';
const overlays = { image: null, video: null };
function fixture(sampleCount = 480000) {
  const f = advancedFixture();
  const token = f.sources.register(new File(['pcm'], 'sound.wav'), 'audio');
  f.sources.markReady(token, { duration: sampleCount / 48000, sampleCount });
  const segment: IndependentAudioSegment = {
    id: 'sound',
    timelineStartFrame: 10,
    durationFrames: 10,
    sourceStartSample: 19200,
    source: { kind: 'audio-file', sourceId: token.sourceId },
  };
  let serial = 0;
  return { ...f, segment, allocate: () => `sound-${serial++}` };
}
function value<T>(result: { value: T } | { error: { message: string } }): T {
  if ('error' in result) throw new Error(result.error.message);
  return result.value;
}
function projection(
  f: ReturnType<typeof fixture>,
  s: EditSnapshot = f.snapshot,
) {
  return buildAdvancedTimeline(s, f.sources, overlays);
}
function samples(s: EditSnapshot, p: ReturnType<typeof projection>) {
  return audio
    .resolveAudioOwnership(s, p)
    .flatMap((v) =>
      Array.from({ length: v.endFrameExclusive - v.startFrame }, (_, i) => [
        v.source,
        v.source ? v.sourceStartSample + i * 1920 : 0,
      ]),
    );
}
describe('independent audio ownership and frozen detachment', () => {
  it('detaches_only_exposed_base_ranges_preserving_pre_gain_samples', () => {
    const f = fixture(),
      p = projection(f),
      before = samples(f.snapshot, p);
    const next = value(
      audio.detachAudio(
        f.snapshot,
        f.sources,
        p,
        { track: 'video1', id: 'base' },
        f.allocate,
      ),
    );
    expect(
      next.independentAudio.map((v) => [
        v.timelineStartFrame,
        v.durationFrames,
        v.sourceStartSample,
      ]),
    ).toEqual([
      [0, 40, 0],
      [100, 50, 192000],
    ]);
    expect(next.video1[0].originalAudio).toBe('detached');
    expect(next.independentAudio[1].source).toMatchObject({
      kind: 'video-edit',
      sourceId: f.base.sourceId,
      sourceStartFrame: 0,
      sourceEndFrame: 149,
      speed: 1,
      normalizationFps: 25,
    });
    expect(samples(next, projection(f, next))).toEqual(before);
  });
  it('detach_replacement_then_lift_leaves_silence_and_never_relinks_base', () => {
    const f = fixture();
    const next = value(
      audio.detachAudio(
        f.snapshot,
        f.sources,
        projection(f),
        { track: 'video2', id: 'take' },
        f.allocate,
      ),
    );
    expect(
      next.independentAudio.map((v) => [
        v.timelineStartFrame,
        v.durationFrames,
      ]),
    ).toEqual([[40, 60]]);
    const deleted = value(
      audio.editIndependentAudio(
        next,
        { action: 'lift', id: next.independentAudio[0].id },
        25,
        f.sources,
        f.allocate,
      ),
    );
    expect(deleted.video2[0].originalAudio).toBe('detached');
    expect(
      audio
        .resolveAudioOwnership(deleted, projection(f, deleted))
        .find((v) => v.startFrame === 40)?.source,
    ).toBeNull();
  });
  it('existing_independent_masks_detach_exposure_and_muted_bus_still_captures_recipe', () => {
    const f = fixture();
    const snapshot = {
      ...f.snapshot,
      independentAudio: [f.segment],
      audio: { ...f.snapshot.audio, originalMuted: true },
    };
    const next = value(
      audio.detachAudio(
        snapshot,
        f.sources,
        projection(f, snapshot),
        { track: 'video1', id: 'base' },
        f.allocate,
      ),
    );
    expect(
      next.independentAudio
        .filter((v) => v.detachedFrom)
        .map((v) => [
          v.timelineStartFrame,
          v.durationFrames,
          v.sourceStartSample,
        ]),
    ).toEqual([
      [0, 10, 0],
      [20, 20, 38400],
      [100, 50, 192000],
    ]);
  });
  it('fully_hidden_already_detached_and_invalid_shared_composition_cannot_detach', () => {
    const f = fixture();
    const full = {
      ...f.snapshot,
      independentAudio: [
        {
          ...f.segment,
          timelineStartFrame: 0,
          durationFrames: 150,
          sourceStartSample: 0,
        },
      ],
    };
    expect(
      audio.detachAudio(
        full,
        f.sources,
        projection(f, full),
        { track: 'video1', id: 'base' },
        f.allocate,
      ),
    ).toHaveProperty('error');
    const detached = value(
      audio.detachAudio(
        f.snapshot,
        f.sources,
        projection(f),
        { track: 'video1', id: 'base' },
        f.allocate,
      ),
    );
    expect(
      audio.detachAudio(
        detached,
        f.sources,
        projection(f, detached),
        { track: 'video1', id: 'base' },
        f.allocate,
      ),
    ).toHaveProperty('error');
    expect(
      audio.detachAudio(
        f.snapshot,
        f.sources,
        { ...projection(f), renderErrors: ['Invalid replacement'] },
        { track: 'video1', id: 'base' },
        f.allocate,
      ),
    ).toHaveProperty('error');
  });
  it('frozen_audio_survives_owner_deletion_overwrite_and_later_replacement', () => {
    const f = fixture();
    const detached = value(
      audio.detachAudio(
        f.snapshot,
        f.sources,
        projection(f),
        { track: 'video1', id: 'base' },
        f.allocate,
      ),
    );
    const withoutOwner = {
      ...detached,
      video2: [],
      video1: [
        {
          ...f.snapshot.video1[0],
          id: 'other',
          sourceId: f.take.sourceId,
          trim: { startFrame: 0, endFrame: 59 },
        },
      ],
    };
    expect(
      audio.resolveAudioOwnership(withoutOwner, projection(f, withoutOwner))[0]
        .source?.sourceId,
    ).toBe(f.base.sourceId);
    const overwritten = value(
      overwriteVideo1(
        detached,
        f.sources,
        {
          ...f.snapshot.video1[0],
          sourceId: f.take.sourceId,
          trim: { startFrame: 0, endFrame: 59 },
        },
        0,
        { max_clips: 20, max_file_size_mb: 200 },
        f.allocate,
      ),
    );
    expect(overwritten.independentAudio).toBe(detached.independentAudio);
    expect(
      audio.resolveAudioOwnership(overwritten, projection(f, overwritten))[0]
        .source?.sourceId,
    ).toBe(f.base.sourceId);
    const later = {
      ...detached,
      video2: [
        {
          ...f.snapshot.video2[0],
          sourceId: f.base.sourceId,
          trim: { startFrame: 0, endFrame: 149 },
          timelineStartFrame: 0,
          contentOutFrame: 150,
        },
      ],
    };
    expect(
      audio.resolveAudioOwnership(later, projection(f, later))[0].source
        ?.sourceId,
    ).toBe(f.base.sourceId);
    expect(later.independentAudio[0].source).toEqual(
      detached.independentAudio[0].source,
    );
  });
  it('explicit_video_recipe_represents_silence_without_fake_upload_or_base_fallback', () => {
    const f = fixture();
    const detached = value(
      audio.detachAudio(
        f.snapshot,
        f.sources,
        projection(f),
        { track: 'video2', id: 'take' },
        f.allocate,
      ),
    );
    expect(detached.independentAudio[0].source.kind).toBe('video-edit');
    expect(detached.independentAudio[0].source.sourceId).toBe(f.take.sourceId);
    expect(
      audio
        .resolveAudioOwnership(detached, projection(f, detached))
        .find((v) => v.startFrame === 40)?.ownerId,
    ).toBe(detached.independentAudio[0].id);
  });
});
describe('sample-exact independent audio edits', () => {
  it('move_and_both_edge_trim_preserve_exact_offsets_and_recipe', () => {
    const f = fixture(),
      snapshot = { ...f.snapshot, independentAudio: [f.segment] };
    const moved = value(
      audio.editIndependentAudio(
        snapshot,
        { action: 'move', id: 'sound', startFrame: 25 },
        25,
        f.sources,
        f.allocate,
      ),
    );
    expect(moved.independentAudio[0]).toMatchObject({
      timelineStartFrame: 25,
      durationFrames: 10,
      sourceStartSample: 19200,
    });
    const left = value(
      audio.editIndependentAudio(
        snapshot,
        { action: 'trim', id: 'sound', edge: 'start', deltaFrames: 3 },
        25,
        f.sources,
        f.allocate,
      ),
    );
    expect(left.independentAudio[0]).toMatchObject({
      timelineStartFrame: 13,
      durationFrames: 7,
      sourceStartSample: 24960,
    });
    const right = value(
      audio.editIndependentAudio(
        left,
        { action: 'trim', id: 'sound', edge: 'end', deltaFrames: -2 },
        25,
        f.sources,
        f.allocate,
      ),
    );
    expect(right.independentAudio[0]).toMatchObject({
      timelineStartFrame: 13,
      durationFrames: 5,
      sourceStartSample: 24960,
    });
    expect(right.independentAudio[0].source).toBe(f.segment.source);
  });
  it('split_advances_right_offset_exactly_and_accepts_one_frame_halves', () => {
    const f = fixture(),
      snapshot = { ...f.snapshot, independentAudio: [f.segment] };
    const next = value(
      audio.editIndependentAudio(
        snapshot,
        { action: 'split', id: 'sound', frame: 14 },
        25,
        f.sources,
        f.allocate,
      ),
    );
    expect(
      next.independentAudio.map((v) => [
        v.timelineStartFrame,
        v.durationFrames,
        v.sourceStartSample,
      ]),
    ).toEqual([
      [10, 4, 19200],
      [14, 6, 26880],
    ]);
    expect(new Set(next.independentAudio.map((v) => v.id)).size).toBe(2);
    expect(
      audio.editIndependentAudio(
        snapshot,
        { action: 'split', id: 'sound', frame: 10 },
        25,
        f.sources,
        f.allocate,
      ),
    ).toHaveProperty('error');
  });
  it('lift_keeps_gap_while_explicit_ripple_preserves_existing_later_gap', () => {
    const f = fixture();
    const snapshot = {
      ...f.snapshot,
      independentAudio: [
        f.segment,
        { ...f.segment, id: 'later', timelineStartFrame: 30 },
      ],
    };
    expect(
      value(
        audio.editIndependentAudio(
          snapshot,
          { action: 'lift', id: 'sound' },
          25,
          f.sources,
          f.allocate,
        ),
      ).independentAudio[0].timelineStartFrame,
    ).toBe(30);
    expect(
      value(
        audio.editIndependentAudio(
          snapshot,
          { action: 'ripple-delete', id: 'sound' },
          25,
          f.sources,
          f.allocate,
        ),
      ).independentAudio[0].timelineStartFrame,
    ).toBe(20);
    expect(snapshot.independentAudio[1].timelineStartFrame).toBe(30);
  });
  it('place_accepts_touching_edges_and_tails_rejects_overlap_and_invalid_ranges', () => {
    const f = fixture(),
      snapshot = { ...f.snapshot, independentAudio: [f.segment] };
    expect(
      value(
        audio.editIndependentAudio(
          snapshot,
          {
            action: 'place',
            segment: { ...f.segment, id: 'touch', timelineStartFrame: 20 },
          },
          25,
          f.sources,
          f.allocate,
        ),
      ).independentAudio,
    ).toHaveLength(2);
    expect(
      audio.editIndependentAudio(
        snapshot,
        {
          action: 'place',
          segment: { ...f.segment, id: 'bad', timelineStartFrame: 19 },
        },
        25,
        f.sources,
        f.allocate,
      ),
    ).toHaveProperty('error');
    expect(
      value(
        audio.editIndependentAudio(
          snapshot,
          { action: 'move', id: 'sound', startFrame: 200 },
          25,
          f.sources,
          f.allocate,
        ),
      ).independentAudio[0].timelineStartFrame,
    ).toBe(200);
    expect(
      audio.editIndependentAudio(
        snapshot,
        { action: 'trim', id: 'sound', edge: 'end', deltaFrames: -10 },
        25,
        f.sources,
        f.allocate,
      ),
    ).toHaveProperty('error');
    expect(
      audio.editIndependentAudio(
        snapshot,
        { action: 'move', id: 'sound', startFrame: -1 },
        25,
        f.sources,
        f.allocate,
      ),
    ).toHaveProperty('error');
  });
  it('replace_preserves_identity_timeline_duration_and_rejects_insufficient_source', () => {
    const f = fixture(),
      snapshot = {
        ...f.snapshot,
        independentAudio: [
          {
            ...f.segment,
            detachedFrom: { track: 'video1' as const, clipId: 'base' },
          },
        ],
      };
    const next = value(
      audio.editIndependentAudio(
        snapshot,
        {
          action: 'replace',
          id: 'sound',
          source: f.segment.source,
          sourceStartSample: 48000,
        },
        25,
        f.sources,
        f.allocate,
      ),
    );
    expect(next.independentAudio[0]).toMatchObject({
      id: 'sound',
      timelineStartFrame: 10,
      durationFrames: 10,
      sourceStartSample: 48000,
    });
    expect(next.independentAudio[0].detachedFrom).toBeUndefined();
    expect(
      audio.editIndependentAudio(
        snapshot,
        {
          action: 'replace',
          id: 'sound',
          source: f.segment.source,
          sourceStartSample: 479000,
        },
        25,
        f.sources,
        f.allocate,
      ),
    ).toHaveProperty('error');
  });
  it('K_minus_one_padding_is_owned_silence_and_K_padding_is_rejected', () => {
    const accepted = fixture(1921),
      rejected = fixture(1920);
    const a = {
      ...accepted.segment,
      timelineStartFrame: 0,
      durationFrames: 2,
      sourceStartSample: 0,
    };
    expect(
      value(
        audio.editIndependentAudio(
          accepted.snapshot,
          { action: 'place', segment: a },
          25,
          accepted.sources,
          accepted.allocate,
        ),
      ).independentAudio[0].durationFrames,
    ).toBe(2);
    expect(
      audio.editIndependentAudio(
        rejected.snapshot,
        {
          action: 'place',
          segment: {
            ...rejected.segment,
            timelineStartFrame: 0,
            durationFrames: 2,
            sourceStartSample: 0,
          },
        },
        25,
        rejected.sources,
        rejected.allocate,
      ),
    ).toHaveProperty('error');
  });
});
