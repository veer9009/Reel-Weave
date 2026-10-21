import { expect, it, vi } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import {
  buildV4MergeRequest,
  buildV3MergeRequest,
  requiresV4,
} from './advancedManifest';
import { validatePositioned } from './positionedEdits';
import { collectSnapshotSources } from './projectContext';
import { submitV4Merge } from './api';
import type { EditSnapshot } from './editHistory';

export function musicFixture() {
  const f = advancedFixture();
  const tokens = [0, 1].map(() =>
    f.sources.register(new File(['audio'], 'same-name.wav'), 'audio'),
  );
  tokens.forEach((t) =>
    f.sources.markReady(t, { sampleCount: 480000, duration: 10 }),
  );
  const snapshot: EditSnapshot = {
    ...f.snapshot,
    music: tokens.map((t, i) => ({
      id: `music-${i}`,
      sourceId: t.sourceId,
      timelineStartFrame: i * 30,
      durationFrames: 30,
      sourceStartSample: i * 4800,
    })),
    independentAudio: [
      {
        id: 'shared',
        timelineStartFrame: 0,
        durationFrames: 10,
        sourceStartSample: 0,
        source: { kind: 'audio-file', sourceId: tokens[0].sourceId },
      },
    ],
  };
  return { ...f, snapshot, tokens };
}

it('keeps each music source ready, reachable and in its own window', () => {
  const f = musicFixture();
  expect(validatePositioned(f.snapshot, f.sources, 25)).toBeNull();
  const reachable = collectSnapshotSources(f.snapshot);
  expect(f.tokens.every((t) => reachable.has(t.sourceId))).toBe(true);
  expect(requiresV4(f.snapshot)).toBe(true);
  expect(requiresV4({ ...f.snapshot, music: [f.snapshot.music[0]] })).toBe(
    false,
  );
});

it('submits real per-piece files once with exact V4 windows, even for MP4 alone', async () => {
  const f = musicFixture();
  const request = buildV4MergeRequest(
    f.snapshot,
    f.sources,
    25,
    { image: null, video: null },
    ['mp4'],
  );
  expect(request.audioFiles).toHaveLength(2);
  expect(request.audioFiles.map((v) => v.name)).toEqual([
    'same-name.wav',
    'same-name.wav',
  ]);
  expect(request.manifest.music).toEqual({
    segments: [
      {
        client_id: 'music-0',
        source_id: f.tokens[0].sourceId,
        timeline_start_frame: 0,
        duration_frames: 30,
        source_start_sample: 0,
      },
      {
        client_id: 'music-1',
        source_id: f.tokens[1].sourceId,
        timeline_start_frame: 30,
        duration_frames: 30,
        source_start_sample: 4800,
      },
    ],
  });
  expect(request.manifest.schema_version).toBe(4);
  expect(request.manifest.audio_sources).toHaveLength(2);
  expect(() =>
    buildV3MergeRequest(
      f.snapshot,
      f.sources,
      25,
      { image: null, video: null },
      ['mp4'],
    ),
  ).toThrow(/V4|multiple|music/i);
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ job_id: 'job', status: 'queued' }), {
        status: 202,
      }),
  );
  vi.stubGlobal('fetch', fetch);
  try {
    expect((await submitV4Merge(request)).job_id).toBe('job');
    const body = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as FormData;
    expect(body.getAll('audio_files')).toHaveLength(2);
    expect(JSON.parse(String(body.get('manifest'))).schema_version).toBe(4);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects per-piece missing media and total audio size before submission', () => {
  const f = musicFixture();
  expect(() =>
    buildV4MergeRequest(
      f.snapshot,
      f.sources,
      25,
      { image: null, video: null },
      ['mp4'],
      {
        max_clips: 20,
        max_file_size_mb: 200,
        max_audio_file_size_mb: 0,
      },
    ),
  ).toThrow(/limit|exceed/i);
  f.sources.markError(f.tokens[1]);
  expect(() =>
    buildV4MergeRequest(
      f.snapshot,
      f.sources,
      25,
      { image: null, video: null },
      ['mp4'],
    ),
  ).toThrow();
});
