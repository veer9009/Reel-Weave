import { expect, it } from 'vitest';
import { createFullProjectDocumentFixture } from '../test/projectFileFixtures';
import {
  validateProjectDocument,
  migrateProjectDocumentV1,
} from './projectFileJson';
import { prepareRelinkedProject, serializeProjectCapture } from './projectFile';
import type { AcceptedRelink } from './projectFile';
import { collectSnapshotSources } from './projectContext';

const limits = { max_clips: 20, max_file_size_mb: 200 };

it('migrates V1 music without changing its exact windows', () => {
  const v1 = createFullProjectDocumentFixture();
  expect(validateProjectDocument(v1, limits).ok).toBe(true);
  const v2 = migrateProjectDocumentV1(v1);
  expect(v2.schemaVersion).toBe(2);
  expect(v2.edit).not.toHaveProperty('musicSourceId');
  expect(v2.edit.music).toEqual(v1.edit.music);
  expect(v2.edit.independentAudio).toEqual(v1.edit.independentAudio);
  expect(validateProjectDocument(v2, limits).ok).toBe(true);
  expect(v1.schemaVersion).toBe(1);
});

it('round trips different-file music pieces through V2 relink, preserving sample offsets', async () => {
  const v2 = migrateProjectDocumentV1(createFullProjectDocumentFixture());
  const first = v2.edit.music[0];
  const source = v2.sources.find((s) => s.id === first.sourceId)!;
  v2.sources.push({ ...source, id: 'second_song', originalName: 'second.wav' });
  v2.edit.music = [
    {
      ...first,
      id: 'music-left',
      timelineStartFrame: 0,
      durationFrames: 10,
      sourceStartSample: 4800,
    },
    {
      ...first,
      id: 'music-right',
      sourceId: 'second_song',
      timelineStartFrame: 10,
      durationFrames: 10,
      sourceStartSample: 9600,
    },
  ];
  expect(validateProjectDocument(v2, limits).ok).toBe(true);
  const matches = new Map<string, AcceptedRelink>();
  for (const s of v2.sources)
    matches.set(s.id, {
      sourceId: s.id,
      renamedConfirmed: false,
      evidence: {
        file: new File(['abc'], s.originalName, { type: s.mimeType }),
        sha256: s.sha256,
        metadata:
          s.mediaType === 'image'
            ? {
                mediaType: 'image',
                width: s.metadata.width,
                height: s.metadata.height,
              }
            : s.mediaType === 'video'
              ? {
                  mediaType: 'video',
                  durationSeconds: s.metadata.durationSeconds,
                  width: s.metadata.width ?? 320,
                  height: s.metadata.height ?? 180,
                }
              : {
                  mediaType: 'audio',
                  durationSeconds: s.metadata.durationSeconds,
                },
      },
    });
  let id = 0;
  const prepared = prepareRelinkedProject(
    v2,
    matches,
    limits,
    () => `runtime_${++id}`,
  );
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error(prepared.issue.message);
  const capture = {
    envelope: prepared.value.envelope,
    capturedAt: new Date(),
    sources: new Map(
      [...collectSnapshotSources(prepared.value.envelope)].map((id) => [
        id,
        prepared.value.sources.get(id)!,
      ]),
    ),
  };
  const saved = await serializeProjectCapture(
    capture,
    {
      async fingerprint() {
        return { ok: true, value: source.sha256 };
      },
      async inspect() {
        return {
          ok: true,
          value: { mediaType: 'image', width: 32, height: 32 },
        };
      },
      dispose() {},
    },
    limits,
    new AbortController().signal,
  );
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error(saved.issue.message);
  expect(saved.value.schemaVersion).toBe(2);
  expect(saved.value.edit).not.toHaveProperty('musicSourceId');
  expect(
    saved.value.edit.music.map((s) => [
      s.timelineStartFrame,
      s.durationFrames,
      s.sourceStartSample,
    ]),
  ).toEqual([
    [0, 10, 4800],
    [10, 10, 9600],
  ]);
  expect(new Set(saved.value.edit.music.map((s) => s.sourceId)).size).toBe(2);
  prepared.value.dispose();
});

it('rejects a V2 legacy source field, missing per-piece references and future versions', () => {
  const v2 = migrateProjectDocumentV1(createFullProjectDocumentFixture());
  expect(
    validateProjectDocument(
      { ...v2, edit: { ...v2.edit, musicSourceId: null } },
      limits,
    ).ok,
  ).toBe(false);
  expect(validateProjectDocument({ ...v2, schemaVersion: 99 }, limits).ok).toBe(
    false,
  );
  v2.edit.music[0].sourceId = 'missing';
  expect(validateProjectDocument(v2, limits).ok).toBe(false);
});
