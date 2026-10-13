import { expect, it } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedMergeRequest } from './advancedManifest';
it('serializes_committed_segments_and_deduplicates_sources', () => {
  const f = advancedFixture();
  f.snapshot.video1.push({ ...f.snapshot.video1[0], id: 'split' });
  const r = buildAdvancedMergeRequest(f.snapshot, f.sources, 25, {
    image: null,
    video: null,
  });
  expect(r.videoFiles).toHaveLength(2);
  expect(r.manifest.clips).toHaveLength(2);
  expect(r.manifest.schema_version).toBe(2);
  expect(r.manifest.video2[0].content_full_source).toBe(false);
  expect(r.manifest.music).toBeNull();
  expect(r.manifest.video_sources.map((s) => s.source_id)).toEqual([
    f.base.sourceId,
    f.take.sourceId,
  ]);
});
it('missing_media_blocks_serialization_without_uploading_history', () => {
  const f = advancedFixture();
  f.sources.clear();
  expect(() =>
    buildAdvancedMergeRequest(f.snapshot, f.sources, 25, {
      image: null,
      video: null,
    }),
  ).toThrow(/source|media/i);
});
