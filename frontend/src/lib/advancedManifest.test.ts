import { expect, it } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedMergeRequest } from './advancedManifest';
import {
  buildV3MergeRequest,
  requiresV3,
  validateManifestSize,
} from './advancedManifest';
import { submitV3Merge } from './api';
import { vi } from 'vitest';

it('v3_preserves_windows_and_frozen_audio_only_sources_with_deduplicated_uploads', async () => {
  const f = advancedFixture();
  const audio = f.sources.register(new File(['pcm'], 'voice.wav'), 'audio');
  f.sources.markReady(audio, { duration: 6, sampleCount: 288000 });
  const snapshot = {
    ...f.snapshot,
    video2: [],
    video1: [
      {
        ...f.snapshot.video1[0],
        originalAudio: 'detached' as const,
        outputWindow: { outputInFrame: 40, outputOutFrame: 60 },
      },
    ],
    independentAudio: [
      {
        id: 'frozen',
        timelineStartFrame: 0,
        durationFrames: 20,
        sourceStartSample: 19200,
        source: {
          kind: 'video-edit' as const,
          sourceId: f.take.sourceId,
          sourceStartFrame: 0,
          sourceEndFrame: 59,
          speed: 0.5 as const,
          normalizationFps: 25 as const,
        },
        detachedFrom: { track: 'video2' as const, clipId: 'deleted' },
      },
      {
        id: 'dialogue',
        timelineStartFrame: 20,
        durationFrames: 20,
        sourceStartSample: 0,
        source: { kind: 'audio-file' as const, sourceId: audio.sourceId },
      },
    ],

    music: [
      {
        id: 'music',
        sourceId: audio.sourceId,
        timelineStartFrame: 0,
        durationFrames: 20,
        sourceStartSample: 0,
      },
    ],
  };
  expect(requiresV3(snapshot, ['mp4'])).toBe(true);
  const render = buildV3MergeRequest(
    snapshot,
    f.sources,
    25,
    { image: null, video: null },
    ['mp4', 'mov', 'wav', 'mp3'],
  );
  expect(render.manifest.clips[0]).toMatchObject({
    timeline_start_frame: 0,
    duration_frames: 20,
    output_in_frame: 40,
    output_out_frame: 60,
    original_audio: 'detached',
  });
  expect(render.manifest.independent_audio[0]).toEqual({
    id: 'frozen',
    timeline_start_frame: 0,
    duration_frames: 20,
    source_start_sample: 19200,
    source: {
      kind: 'video-edit',
      source_id: f.take.sourceId,
      source_start_frame: 0,
      source_end_frame: 59,
      speed: 0.5,
      normalization_fps: 25,
    },
    detached_from: { track: 'video2', clip_id: 'deleted' },
  });
  expect(render.videoFiles).toEqual([
    f.sources.get(f.base.sourceId)!.file,
    f.sources.get(f.take.sourceId)!.file,
  ]);
  expect(render.audioFiles).toEqual([f.sources.get(audio.sourceId)!.file]);
  expect(JSON.stringify(render.manifest)).not.toMatch(
    /blob:|requestId|normalizationFps/,
  );
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ job_id: 'job', status: 'queued', error: null }),
  });
  vi.stubGlobal('fetch', fetch);
  await submitV3Merge(render);
  const form = fetch.mock.calls[0][1].body as FormData;
  expect(form.getAll('files')).toHaveLength(2);
  expect(form.getAll('audio_files')).toHaveLength(1);
  expect(form.has('background_audio')).toBe(false);
});
it('v3_preflight_rejects_invalid_formats_and_manifest_budget_without_changing_v2', () => {
  const f = advancedFixture(),
    o = { image: null, video: null };
  expect(requiresV3(f.snapshot, ['mp4'])).toBe(false);
  expect(requiresV3(f.snapshot, ['mp4', 'wav'])).toBe(true);
  for (const formats of [['wav'], ['mp4', 'mp4'], ['mp4', 'flac']])
    expect(() =>
      buildV3MergeRequest(f.snapshot, f.sources, 25, o, formats as ['mp4']),
    ).toThrow(/format/i);
  expect(() => validateManifestSize('x'.repeat(65536))).not.toThrow();
  expect(() => validateManifestSize('x'.repeat(65537))).toThrow(
    'Timeline description exceeds the render limit',
  );
  expect(() => validateManifestSize('é'.repeat(32769))).toThrow(
    'Timeline description exceeds the render limit',
  );
});
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
