import { beforeEach, expect, it, vi } from 'vitest';
import {
  createProjectSources,
  collectReachableSources,
} from './projectSources';
import { createHistory, commitHistory, undoHistory } from './editHistory';
import { historySnapshot } from '../test/historyFixtures';
it('ready_adoption_is_transactional_and_rollback_keeps_staging_owned', () => {
  const live = createProjectSources(),
    staged = createProjectSources();
  const old = live.register(new File(['old'], 'old.mp4'), 'video1');
  const token = staged.registerReady({
    id: 'ready_source',
    file: new File(['abc'], 'base.mp4'),
    kind: 'video',
    mediaType: 'video',
    metadata: {
      duration: 2,
      clipMetadata: {
        duration: 2,
        fps: 30,
        totalFrames: 60,
        width: 320,
        height: 180,
        source: 'browser',
      },
    },
  });
  const url = staged.ensureUrl(token.sourceId);
  const transfer = live.adoptFrom(staged);
  expect(live.get(token.sourceId)?.url).toBe(url);
  transfer.rollback();
  transfer.rollback();
  expect(live.get(token.sourceId)).toBeUndefined();
  expect(staged.get(token.sourceId)?.url).toBe(url);
  expect(live.get(old.sourceId)).toBeDefined();
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
  const accepted = live.adoptFrom(staged);
  live.reconcileUrls(new Set([token.sourceId, old.sourceId]));
  accepted.commit();
  staged.clear();
  expect(live.get(token.sourceId)?.file.name).toBe('base.mp4');
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
});
it('garbage_collection_waits_for_the_last_consumer_lease', () => {
  const sources = createProjectSources();
  const token = sources.register(new File(['v'], 'v.mp4'), 'video1');
  const url = sources.ensureUrl(token.sourceId);
  const release = sources.acquireLease('render', new Set([token.sourceId]));
  sources.collectGarbage(new Set());
  expect(sources.get(token.sourceId)).toBeDefined();
  release();
  expect(sources.get(token.sourceId)).toBeUndefined();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
});
it('adoption_collisions_and_clear_do_not_damage_the_original_owner', () => {
  const live = createProjectSources(),
    staged = createProjectSources();
  const input = {
    id: 'same_id',
    file: new File(['a'], 'a.wav'),
    kind: 'audio' as const,
    mediaType: 'audio' as const,
    metadata: { duration: 1, sampleCount: 48000 },
  };
  live.registerReady(input);
  staged.registerReady(input);
  expect(() => live.adoptFrom(staged)).toThrow();
  expect(live.get(input.id)?.file).toBe(input.file);
  expect(staged.get(input.id)?.file).toBe(input.file);
  const other = createProjectSources();
  const adoption = other.adoptFrom(staged);
  other.clear();
  expect(() => adoption.commit()).toThrow();
  expect(staged.get(input.id)?.file).toBe(input.file);
});
it('restored_audio_keeps_saved_samples_when_preview_metadata_arrives_again', () => {
  const sources = createProjectSources();
  const token = sources.registerReady({
    id: 'restored_audio',
    file: new File(['abc'], 'a.mp3'),
    kind: 'audio',
    mediaType: 'audio',
    metadata: { duration: 2, sampleCount: 96000 },
  });
  expect(sources.markReady(token, { duration: 2.04 })).toBe(true);
  expect(sources.get(token.sourceId)?.duration).toBe(2);
  expect(sources.get(token.sourceId)?.sampleCount).toBe(96000);
});
it('leases_aggregate_owners_and_old_release_does_not_release_a_newer_lease', () => {
  const sources = createProjectSources();
  const token = sources.register(new File(['v'], 'voice.mp4'), 'video1');
  const url = sources.ensureUrl(token.sourceId);
  const old = sources.acquireLease('playback', new Set([token.sourceId]));
  const current = sources.acquireLease('playback', new Set([token.sourceId]));
  sources.setExternalOwners(new Set(['image']));
  old();
  sources.reconcileUrls(new Set());
  expect(sources.get(token.sourceId)?.url).toBe(url);
  expect([...sources.externalOwners].sort()).toEqual(
    ['image', token.sourceId].sort(),
  );
  current();
  current();
  sources.reconcileUrls(new Set());
  expect(sources.get(token.sourceId)?.url).toBeUndefined();
});
it('session_clear_stops_active_media_before_releasing_its_URL', () => {
  const sources = createProjectSources(),
    token = sources.register(new File(['v'], 'voice.mp4'), 'video1');
  const url = sources.ensureUrl(token.sourceId);
  let stopped = false;
  sources.onBeforeClear(() => {
    expect(sources.get(token.sourceId)?.url).toBe(url);
    stopped = true;
  });
  sources.clear();
  expect(stopped).toBe(true);
  expect(sources.get(token.sourceId)).toBeUndefined();
});
it('audio_only_and_bin_sources_remain_reachable_after_owner_deletion', () => {
  const snapshot = {
    ...historySnapshot([]),
    binSourceIds: ['bin-only'],
    independentAudio: [
      {
        id: 'sound',
        timelineStartFrame: 0,
        durationFrames: 1,
        sourceStartSample: 0,
        source: {
          kind: 'video-edit' as const,
          sourceId: 'sound-only',
          sourceStartFrame: 0,
          sourceEndFrame: 9,
          speed: 1 as const,
          normalizationFps: 25 as const,
        },
      },
    ],
  };
  const reachable = collectReachableSources(
    createHistory(snapshot),
    null,
    [],
    new Set(['playing']),
  );
  expect([...reachable].sort()).toEqual(['bin-only', 'playing', 'sound-only']);
});
it('video_asset_type_is_independent_of_first_placement_role', () => {
  const sources = createProjectSources();
  const token = sources.register(new File(['v'], 'v.mp4'), 'video2');
  expect(sources.get(token.sourceId)?.mediaType).toBe('video');
});
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    () => `blob:${Math.random()}`,
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
it('source identities, exact files, stale tokens and cleanup', () => {
  const sources = createProjectSources();
  const file = new File(['v'], 'same.mp4');
  const a = sources.register(file, 'video1'),
    b = sources.register(new File(['b'], file.name), 'video1');
  expect(a.sourceId).not.toBe(b.sourceId);
  expect(sources.get(a.sourceId)?.file).toBe(file);
  expect(
    sources.markReady({ ...a, requestId: a.requestId + 1 }, { duration: 2 }),
  ).toBe(false);
  const url = sources.ensureUrl(a.sourceId);
  sources.reconcileUrls(new Set([a.sourceId]));
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  sources.reconcileUrls(new Set());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  expect(sources.ensureUrl(a.sourceId)).not.toBe(url);
  sources.clear();
  expect(sources.markError(a)).toBe(false);
  expect(sources.get(a.sourceId)).toBeUndefined();
});
it('reachability includes history, preview, probes and external assets', () => {
  const initial = historySnapshot(['a']);
  const h = undoHistory(
    commitHistory(
      createHistory(initial),
      'ripple-delete',
      'Delete',
      historySnapshot([]),
    ),
  );
  expect(
    [
      ...collectReachableSources(
        h,
        historySnapshot(['b']),
        [{ session: 1, sourceId: 'probe', requestId: 1 }],
        new Set(['image', 'music']),
      ),
    ].sort(),
  ).toEqual(['image', 'music', 'probe', 'source:a', 'source:b']);
});
it('rejects incomplete or invalid kind-specific metadata without changing readiness', () => {
  const sources = createProjectSources();
  const video = sources.register(new File(['v'], 'v.mp4'), 'video1');
  expect(sources.markReady(video, { duration: 2 })).toBe(false);
  expect(sources.get(video.sourceId)?.status).toBe('loading');
  const pip = sources.register(new File(['v'], 'p.mp4'), 'pip');
  expect(sources.markReady(pip, { duration: NaN })).toBe(false);
  expect(sources.markReady(pip, { duration: 0 })).toBe(false);
  expect(sources.markReady(pip, { duration: 2 })).toBe(true);
  sources.markError(pip);
  expect(sources.markReady(pip, { duration: 2 })).toBe(false);
});
