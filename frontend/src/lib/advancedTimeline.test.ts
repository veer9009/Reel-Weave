import { expect, it } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline, resolveProgramFrame } from './advancedTimeline';
import {
  createHistory,
  commitHistory,
  undoHistory,
  redoHistory,
} from './editHistory';

const overlays = { image: null, video: null };
it('replacement_owns_start_and_excludes_end', () => {
  const f = advancedFixture();
  const p = buildAdvancedTimeline(f.snapshot, f.sources, overlays);
  expect(
    [39, 40, 99, 100].map((n) => resolveProgramFrame(p, n)?.track),
  ).toEqual(['video1', 'video2', 'video2', 'video1']);
  expect(p.base.totalFrames).toBe(150);
});
it('base_resumes_at_covered_source_offset', () => {
  const f = advancedFixture();
  const p = buildAdvancedTimeline(f.snapshot, f.sources, overlays);
  expect(resolveProgramFrame(p, 100)?.sourceTime).toBe(4);
  expect(resolveProgramFrame(p, 40)?.sourceTime).toBe(0);
  expect(resolveProgramFrame(p, 150)).toBeNull();
});
it('adjacent_and_cross_base_replacements', () => {
  const f = advancedFixture();
  f.snapshot.video1 = [
    { ...f.snapshot.video1[0], trim: { startFrame: 0, endFrame: 74 } },
    {
      ...f.snapshot.video1[0],
      id: 'base-right',
      trim: { startFrame: 75, endFrame: 149 },
    },
  ];
  f.snapshot.video2.push({
    ...f.snapshot.video2[0],
    id: 'take-next',
    timelineStartFrame: 100,
    contentOutFrame: 20,
  });
  const p = buildAdvancedTimeline(f.snapshot, f.sources, overlays);
  expect(resolveProgramFrame(p, 75)?.track).toBe('video2');
  expect(resolveProgramFrame(p, 100)?.clip.id).toBe('take-next');
});
it('display_extent_does_not_extend_export', () => {
  const f = advancedFixture();
  f.snapshot.video2[0].timelineStartFrame = 140;
  const p = buildAdvancedTimeline(f.snapshot, f.sources, overlays);
  expect(p.displayFrames).toBe(200);
  expect(p.base.totalFrames).toBe(150);
  expect(p.renderErrors.length).toBeGreaterThan(0);
});
it('snapshot_copy_includes_music_and_content_flag', () => {
  const f = advancedFixture();
  const initial = createHistory(f.snapshot);
  const changed = {
    ...f.snapshot,
    video2: [{ ...f.snapshot.video2[0], contentFullSource: true }],
  };
  const h = commitHistory(initial, 'video2-trim', 'Trim', changed);
  expect(h.past).toHaveLength(1);
  expect(undoHistory(h).present.video2[0].contentFullSource).toBe(false);
  expect(redoHistory(undoHistory(h)).present.video2[0].contentFullSource).toBe(
    true,
  );
});
it('shared_video_source_can_materialize_on_either_lane', () => {
  const f = advancedFixture();
  f.snapshot.video2[0].sourceId = f.base.sourceId;
  expect(
    buildAdvancedTimeline(f.snapshot, f.sources, overlays).video2[0].clip.file,
  ).toBe(f.sources.get(f.base.sourceId)?.file);
});
