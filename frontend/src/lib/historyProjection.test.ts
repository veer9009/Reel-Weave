import { expect, it, vi } from 'vitest';
import { createProjectSources } from './projectSources';
import { materializeSnapshot, validateRestoration } from './historyProjection';
import { historySnapshot } from '../test/historyFixtures';
import { clip } from '../test/fixtures';
it('restoration_rejects_a_missing_independent_recipe_before_reclaiming_media', () => {
  const sources = createProjectSources();
  const snapshot = {
    ...historySnapshot([]),
    independentAudio: [
      {
        id: 'a',
        timelineStartFrame: 0,
        durationFrames: 1,
        sourceStartSample: 0,
        source: { kind: 'audio-file' as const, sourceId: 'missing' },
      },
    ],
  };
  expect(
    validateRestoration(snapshot, sources, {
      max_clips: 20,
      max_file_size_mb: 200,
    }),
  ).toMatch(/source/i);
});
it('restoration_rejects_invalid_normalized_base_windows_atomically', () => {
  const sources = createProjectSources();
  const original = clip();
  const token = sources.register(original.file, 'video1');
  sources.markReady(token, { clipMetadata: original.metadata });
  const snapshot = historySnapshot(['a']);
  snapshot.video1 = [
    {
      ...snapshot.video1[0],
      sourceId: token.sourceId,
      outputWindow: { outputInFrame: 10, outputOutFrame: 9 },
    },
  ];
  expect(
    validateRestoration(snapshot, sources, {
      max_clips: 20,
      max_file_size_mb: 200,
    }),
  ).toMatch(/window|range/i);
});
it('projects split sources by identity and validates atomically', () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source');
  const sources = createProjectSources(),
    original = clip();
  const token = sources.register(original.file, 'video1');
  sources.markReady(token, { clipMetadata: original.metadata });
  const s = historySnapshot();
  s.video1 = s.video1.map((v) => ({ ...v, sourceId: token.sourceId }));
  expect(
    validateRestoration(s, sources, { max_clips: 20, max_file_size_mb: 200 }),
  ).toBeNull();
  const restored = materializeSnapshot(s, sources).clips;
  expect(restored[0].file).toBe(original.file);
  expect(restored[1].file).toBe(original.file);
  expect(restored[0].url).toBe(restored[1].url);
  expect(
    validateRestoration(s, sources, { max_clips: 1, max_file_size_mb: 200 }),
  ).toMatch(/limit/i);
  expect(
    validateRestoration({ ...s, video1: [s.video1[0], s.video1[0]] }, sources, {
      max_clips: 20,
      max_file_size_mb: 200,
    }),
  ).toMatch(/identity/i);
  expect(
    validateRestoration(historySnapshot(), sources, {
      max_clips: 20,
      max_file_size_mb: 200,
    }),
  ).toMatch(/source/i);
  expect(
    validateRestoration(
      {
        ...s,
        video1: [{ ...s.video1[0], trim: { startFrame: 0.5, endFrame: 80 } }],
      },
      sources,
      { max_clips: 20, max_file_size_mb: 200 },
    ),
  ).toMatch(/trim/i);
  sources.markError(token);
  expect(materializeSnapshot(s, sources).clips[0].metadataStatus).toBe('error');
});
