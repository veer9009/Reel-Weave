import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  prepareRelinkedProject,
  serializeProjectCapture,
  createProjectDownload,
} from './projectFile';
import { createProjectContext } from './projectContext';
import { createProjectMediaVerifier } from './projectMedia';
import { createProjectDocumentFixture } from '../test/projectFileFixtures';
const limits = { max_clips: 20, max_file_size_mb: 200 };
function original() {
  const file = new File(['abc'], 'base.mp4', {
    lastModified: 0,
    type: 'video/mp4',
  });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('abc').buffer,
  });
  return file;
}
function prepared() {
  const document = createProjectDocumentFixture(),
    file = original();
  let serial = 0;
  const source = document.sources[0];
  const matches = new Map([
    [
      source.id,
      {
        sourceId: source.id,
        evidence: {
          file,
          sha256: source.sha256,
          metadata: {
            mediaType: 'video' as const,
            durationSeconds: 2,
            width: 320,
            height: 180,
          },
        },
        renamedConfirmed: false,
      },
    ],
  ]);
  const result = prepareRelinkedProject(
    document,
    matches,
    limits,
    () => `runtime_${++serial}`,
  );
  if (!result.ok) throw new Error(result.issue.message);
  return { ...result.value, document, file };
}
it('prepares fresh runtime identities and preserves exact edit decisions', () => {
  const p = prepared();
  expect(p.envelope.video1[0].sourceId).not.toBe(p.document.sources[0].id);
  expect(p.envelope.video1[0].id).not.toBe(p.document.edit.video1[0].id);
  expect(p.sources.get(p.envelope.video1[0].sourceId)?.file).toBe(p.file);
  expect(p.envelope.video1[0].trim).toEqual({ startFrame: 0, endFrame: 59 });
  expect(p.envelope.projectContext.exportFormats).toEqual(['mp4']);
  p.dispose();
});
it('requires every source and confirmation of renamed media', () => {
  const d = createProjectDocumentFixture();
  expect(prepareRelinkedProject(d, new Map(), limits, () => 'runtime').ok).toBe(
    false,
  );
  const p = prepared(),
    source = d.sources[0];
  const renamed = new File(['abc'], 'renamed.mp4');
  const matches = new Map([
    [
      source.id,
      {
        sourceId: source.id,
        evidence: {
          file: renamed,
          sha256: source.sha256,
          metadata: {
            mediaType: 'video' as const,
            durationSeconds: 2,
            width: 320,
            height: 180,
          },
        },
        renamedConfirmed: false,
      },
    ],
  ]);
  expect(prepareRelinkedProject(d, matches, limits, () => 'runtime').ok).toBe(
    false,
  );
  p.dispose();
});
it('serializes the copied snapshot only, without File URLs tokens or history', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const p = prepared();
  const verifier = createProjectMediaVerifier();
  const metadata = {
    duration: 2,
    fps: 30,
    totalFrames: 60,
    width: 320,
    height: 180,
    source: 'browser' as const,
  };
  const capture = {
    envelope: p.envelope,
    sources: new Map([
      [
        p.envelope.video1[0].sourceId,
        {
          file: p.file,
          kind: 'video' as const,
          mediaType: 'video' as const,
          status: 'ready' as const,
          metadata,
          duration: 2,
        },
      ],
    ]),
    capturedAt: new Date(2026, 9, 20, 12, 34, 56),
  };
  Object.assign(capture.envelope, {
    history: 'not portable',
    url: 'blob:private',
  });
  const result = await serializeProjectCapture(
    capture,
    verifier,
    limits,
    new AbortController().signal,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sources[0].sha256).toBe(p.document.sources[0].sha256);
  expect(result.value.edit.video1[0].trim).toEqual({
    startFrame: 0,
    endFrame: 59,
  });
  const json = JSON.stringify(result.value);
  expect(json).not.toContain('blob:');
  expect(json).not.toContain('not portable');
  expect(json).not.toContain('"file"');
  expect(json).not.toContain('"token"');
  verifier.dispose();
  p.dispose();
});
it('never downloads a partially serialized project or claims a confirmed disk write', () => {
  vi.useFakeTimers();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(
        'AVStudio-project-2026-10-20-123456.avstudio.json',
      );
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });
  const download = createProjectDownload();
  expect(download.request('{}', new Date(2026, 9, 20, 12, 34, 56)).ok).toBe(
    true,
  );
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector('a[download]')).toBeNull();
  vi.runAllTimers();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  download.dispose();
  vi.useRealTimers();
});
it('assigns a different incarnation on each prepared Open', () => {
  const a = createProjectContext(),
    b = createProjectContext();
  expect(a.incarnationId).not.toBe(b.incarnationId);
});
