import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import type { EditSnapshot } from './editHistory';
import { moveVideo1Insert } from './rippleInsert';
import { materializeSnapshot } from './historyProjection';
import { buildTimeline } from './timeline';
import { buildV3MergeRequest } from './advancedManifest';
import { serializeProjectCapture, prepareRelinkedProject } from './projectFile';
import { createProjectMediaVerifier } from './projectMedia';
import { createProjectContext } from './projectContext';
import { parseProjectText, stringifyProjectDocument } from './projectFileJson';

const limits = { max_clips: 20, max_file_size_mb: 200 };
function fixture() {
  const f = advancedFixture();
  const original = f.snapshot.video1[0];
  const snapshot: EditSnapshot = {
    ...f.snapshot,
    video2: [],
    video1: [
      {
        ...original,
        id: 'left',
        speed: 0.5,
        outputWindow: { outputInFrame: 10, outputOutFrame: 40 },
      },
      {
        ...original,
        id: 'right',
        speed: 0.5,
        outputWindow: { outputInFrame: 40, outputOutFrame: 90 },
      },
      { ...original, id: 'tail', trim: { startFrame: 100, endFrame: 119 } },
    ],
  };
  return { ...f, snapshot };
}
function move(f: ReturnType<typeof fixture>, id: string, frame: number) {
  const result = moveVideo1Insert(
    f.snapshot,
    f.sources,
    id,
    frame,
    limits,
    () => 'remainder',
  );
  if ('error' in result) throw new Error(result.error.message);
  return result.value;
}
it.each([
  ['right', 0, ['right', 'left', 'tail'], [0, 50, 80]],
  ['tail', 30, ['left', 'tail', 'right'], [0, 30, 50]],
  ['left', 50, ['right', 'left', 'tail'], [0, 50, 80]],
] as const)(
  'inserts %s at exact project frame %i without changing split windows or source edits',
  (id, frame, order, starts) => {
    const f = fixture();
    const next = move(f, id, frame);
    expect(next.video1.map((v) => v.id)).toEqual(order);
    for (const v of next.video1)
      expect(v).toEqual(f.snapshot.video1.find((old) => old.id === v.id));
    const timeline = buildTimeline(
      materializeSnapshot(next, f.sources).clips,
      next.fpsSelection,
    );
    expect(timeline.items.map((v) => v.startFrame)).toEqual(starts);
    expect(timeline.totalFrames).toBe(100);
    expect(f.snapshot.video1.map((v) => v.id)).toEqual([
      'left',
      'right',
      'tail',
    ]);
  },
);
it('inserts inside an occupied clip by preserving both visible windows around the moved clip', () => {
  const f = fixture();
  const next = move(f, 'tail', 15);
  expect(next.video1.map((v) => [v.id, v.outputWindow])).toEqual([
    ['left', { outputInFrame: 10, outputOutFrame: 25 }],
    ['tail', undefined],
    ['remainder', { outputInFrame: 25, outputOutFrame: 40 }],
    ['right', { outputInFrame: 40, outputOutFrame: 90 }],
  ]);
});
it.each([-1, 0.5, NaN, 101])(
  'rejects genuinely invalid project frame %s atomically',
  (frame) => {
    const f = fixture();
    expect(
      moveVideo1Insert(
        f.snapshot,
        f.sources,
        'tail',
        frame,
        limits,
        () => 'new',
      ),
    ).toMatchObject({ error: { code: 'invalid_range' } });
    expect(f.snapshot.video1.map((v) => v.id)).toEqual([
      'left',
      'right',
      'tail',
    ]);
  },
);
it('keeps invalid source windows rejected', () => {
  const f = fixture();
  f.snapshot.video1 = f.snapshot.video1.map((v) =>
    v.id === 'right'
      ? { ...v, outputWindow: { outputInFrame: 40, outputOutFrame: 301 } }
      : v,
  );
  expect(
    moveVideo1Insert(f.snapshot, f.sources, 'right', 0, limits, () => 'new'),
  ).toHaveProperty('error');
});
it('preserves project FPS and split durations when the inserted first source has a different FPS', () => {
  const f = fixture();
  const source = f.sources.get(f.take.sourceId)!;
  f.sources.markReady(f.take, {
    clipMetadata: { ...source.metadata!, fps: 30 },
  });
  f.snapshot.fpsSelection = 'auto';
  f.snapshot.video1 = f.snapshot.video1.map((v) =>
    v.id === 'tail'
      ? {
          ...v,
          sourceId: f.take.sourceId,
          trim: { startFrame: 0, endFrame: 23 },
        }
      : v,
  );
  const next = move(f, 'tail', 0);
  const timeline = buildTimeline(
    materializeSnapshot(next, f.sources).clips,
    next.fpsSelection,
  );
  expect(timeline.fps).toBe(25);
  expect(timeline.items.map((v) => v.frameCount)).toEqual([20, 30, 50]);
});
it('render manifest follows inserted order with project durations and linked source windows', () => {
  const f = fixture();
  const next = move(f, 'right', 0);
  const render = buildV3MergeRequest(
    next,
    f.sources,
    25,
    { image: null, video: null },
    ['mp4'],
  );
  expect(render.manifest.order).toEqual(['right', 'left', 'tail']);
  expect(
    render.manifest.clips.map((v) => [
      v.client_id,
      v.timeline_start_frame,
      v.duration_frames,
      v.output_in_frame,
      v.output_out_frame,
      v.speed,
      v.original_audio,
    ]),
  ).toEqual([
    ['right', 0, 50, 40, 90, 0.5, 'linked'],
    ['left', 50, 30, 10, 40, 0.5, 'linked'],
    ['tail', 80, 20, 0, 20, 1, 'linked'],
  ]);
  expect(render.videoFiles).toHaveLength(1);
});
it('Save/Open preserves inserted order, trims, speed, split windows and linked audio', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const f = fixture();
  const next = move(f, 'right', 0);
  const source = f.sources.get(f.base.sourceId)!;
  Object.defineProperty(source.file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('base').buffer,
  });
  const verifier = createProjectMediaVerifier();
  const saved = await serializeProjectCapture(
    {
      envelope: {
        ...next,
        projectContext: { ...createProjectContext(), timingFps: 25 },
      },
      sources: new Map([[f.base.sourceId, source]]),
      capturedAt: new Date(),
    },
    verifier,
    limits,
    new AbortController().signal,
  );
  if (!saved.ok) throw new Error(saved.issue.message);
  expect(
    saved.value.edit.video1.map((v) => v.outputWindow?.outputInFrame),
  ).toEqual([40, 10, undefined]);
  const json = stringifyProjectDocument(saved.value, limits);
  if (!json.ok) throw new Error(json.issue.message);
  const parsed = parseProjectText(json.value, limits);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  const portable = parsed.value.sources[0];
  let serial = 0;
  const opened = prepareRelinkedProject(
    parsed.value,
    new Map([
      [
        portable.id,
        {
          sourceId: portable.id,
          evidence: {
            file: source.file,
            sha256: portable.sha256,
            metadata: {
              mediaType: 'video' as const,
              durationSeconds: 6,
              width: 320,
              height: 180,
            },
          },
          renamedConfirmed: false,
        },
      ],
    ]),
    limits,
    () => `opened_${++serial}`,
  );
  if (!opened.ok) throw new Error(opened.issue.message);
  expect(
    opened.value.envelope.video1.map(
      ({ trim, speed, outputWindow, originalAudio }) => ({
        trim,
        speed,
        outputWindow,
        originalAudio,
      }),
    ),
  ).toEqual(
    next.video1.map(({ trim, speed, outputWindow, originalAudio }) => ({
      trim,
      speed,
      outputWindow,
      originalAudio,
    })),
  );
  expect(
    buildTimeline(
      materializeSnapshot(opened.value.envelope, opened.value.sources).clips,
      '25',
    ).items.map((v) => v.startFrame),
  ).toEqual([0, 50, 80]);
  opened.value.dispose();
  verifier.dispose();
});
