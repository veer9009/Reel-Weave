import { describe, expect, it, vi } from 'vitest';
import {
  parseProjectText,
  readProjectFile,
  stringifyProjectDocument,
  validateProjectDocument,
} from './projectFileJson';
import {
  createProjectDocumentFixture,
  createFullProjectDocumentFixture,
} from '../test/projectFileFixtures';
const limits = { max_clips: 20, max_file_size_mb: 200 };
const parse = (value: unknown) =>
  parseProjectText(JSON.stringify(value), limits);

describe('project document integrity', () => {
  it('accepts the complete V1 document without touching media or network', () => {
    const input = createProjectDocumentFixture();
    expect(parse(input)).toEqual({ ok: true, value: input });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it.each([undefined, '1', 0, -1, 1.5])(
    'rejects invalid version %s',
    (schemaVersion) => {
      expect(
        parse({ ...createProjectDocumentFixture(), schemaVersion }).ok,
      ).toBe(false);
    },
  );
  it('distinguishes unsupported version from unrelated JSON', () => {
    expect(
      parse({ ...createProjectDocumentFixture(), schemaVersion: 99 }),
    ).toMatchObject({ ok: false, issue: { code: 'unsupported-version' } });
    expect(parse({ schema_version: 3 })).toMatchObject({
      ok: false,
      issue: { code: 'not-project' },
    });
  });
  it.each([
    '',
    '{',
    'null',
    '[]',
    '{"a":1} trailing',
    '{"format":"x","format":"y"}',
    '{"format":"x","\\u0066ormat":"y"}',
    '{"x":[{"__proto__":{}}]}',
    '{"x":[{"\\u0063onstructor":{}}]}',
  ])('rejects corrupt or dangerous JSON %s', (text) => {
    expect(parseProjectText(text, limits).ok).toBe(false);
  });
  it('accepts one BOM and escaped punctuation inside filenames', () => {
    const value = createProjectDocumentFixture();
    value.sources[0].originalName = 'a"{}\\.mp4';
    expect(parseProjectText('\uFEFF' + JSON.stringify(value), limits)).toEqual({
      ok: true,
      value,
    });
    expect(
      parseProjectText('\uFEFF\uFEFF' + JSON.stringify(value), limits).ok,
    ).toBe(false);
  });
  it.each([
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      Object.assign(d, { unknown: true });
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      Object.assign(d.edit.audio, { unknown: true });
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.edit.video1[0].trim.endFrame = 999;
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.edit.video1[0].speed = 2 as never;
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.edit.video1[0].sourceId = 'missing';
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.edit.audio.musicVolume = 1.01;
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.sources[0].sha256 = 'A'.repeat(64);
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.sources.push(d.sources[0]);
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.edit.video1[0].id = d.sources[0].id;
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.timingFps = 60;
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.edit.video1[0].trim.startFrame = 0.5;
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.edit.video1[0].outputWindow = { outputInFrame: 0, outputOutFrame: 61 };
    },
    (d: ReturnType<typeof createProjectDocumentFixture>) => {
      d.exportSettings.formats = ['wav'];
    },
  ])('rejects a malformed field with a path', (mutate) => {
    const document = createProjectDocumentFixture();
    mutate(document);
    expect(parse(document)).toMatchObject({
      ok: false,
      issue: { code: 'invalid', path: expect.any(String) },
    });
  });
  it('does not treat nonfinite numbers or internal File objects as portable data', () => {
    const document = createProjectDocumentFixture();
    document.edit.audio.originalVolume = Infinity;
    expect(validateProjectDocument(document, limits).ok).toBe(false);
    Object.assign(document.sources[0], { file: new File(['abc'], 'base.mp4') });
    expect(validateProjectDocument(document, limits).ok).toBe(false);
  });
  it('preserves a bin-only project while rejecting a complete clear', () => {
    const document = createProjectDocumentFixture();
    document.edit.video1 = [];
    document.edit.binSourceIds = [document.sources[0].id];
    expect(parse(document).ok).toBe(true);
    document.edit.binSourceIds = [];
    document.sources = [];
    expect(parse(document).ok).toBe(false);
  });
  it('preserves out-of-base overlays rather than repairing a valid draft', () => {
    const document = createProjectDocumentFixture();
    document.edit.pip = {
      id: 'pip_occ',
      sourceId: document.sources[0].id,
      startFrame: 100,
      endFrame: 200,
      position: 'centre',
      size: 'small',
    };
    expect(parse(document)).toEqual({ ok: true, value: document });
  });
  it.each(['pip', 'image'] as const)(
    'rejects unsafe inclusive %s endpoints without rejecting safe out-of-base schedules',
    (kind) => {
      const document = createFullProjectDocumentFixture();
      const schedule =
        kind === 'pip' ? document.edit.pip! : document.imageOverlay!;
      schedule.startFrame = 0;
      schedule.endFrame = Number.MAX_SAFE_INTEGER;
      expect(parse(document)).toMatchObject({
        ok: false,
        issue: { code: 'invalid', path: expect.any(String) },
      });
      schedule.endFrame = Number.MAX_SAFE_INTEGER - 1;
      expect(parse(document)).toEqual({ ok: true, value: document });
    },
  );
  it('accepts inclusive one-frame trims but rejects invalid output windows', () => {
    const document = createProjectDocumentFixture();
    document.edit.video1[0].trim = { startFrame: 59, endFrame: 59 };
    expect(parse(document).ok).toBe(true);
    document.edit.video1[0].outputWindow = {
      outputInFrame: 1,
      outputOutFrame: 1,
    };
    expect(parse(document).ok).toBe(false);
  });
  it('enforces byte and application bounds without truncation', () => {
    const text = JSON.stringify(createProjectDocumentFixture());
    expect(parseProjectText(text.padEnd(5242880), limits).ok).toBe(true);
    expect(parseProjectText(text.padEnd(5242881), limits)).toMatchObject({
      ok: false,
      issue: { code: 'limit' },
    });
    expect(parseProjectText(text, { ...limits, max_clips: 0 })).toMatchObject({
      ok: false,
      issue: { code: 'limit' },
    });
    expect(
      parseProjectText('['.repeat(17) + '0' + ']'.repeat(17), limits),
    ).toMatchObject({ ok: false, issue: { code: 'limit' } });
  });
  it('checks size before reading and reports cancelled and unreadable input', async () => {
    const signal = new AbortController().signal;
    const large = new File([''], 'project.json');
    Object.defineProperty(large, 'size', { value: 5242881 });
    const read = vi.fn();
    Object.defineProperty(large, 'arrayBuffer', { value: read });
    expect(await readProjectFile(large, limits, signal)).toMatchObject({
      ok: false,
      issue: { code: 'limit' },
    });
    expect(read).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    expect(
      await readProjectFile(large, limits, controller.signal),
    ).toMatchObject({ ok: false, issue: { code: 'cancelled' } });
  });
  it('writes a canonical document and never silently drops unknown properties', () => {
    const document = createProjectDocumentFixture();
    document.exportSettings.formats = ['wav', 'mp4'];
    const result = stringifyProjectDocument(document, limits);
    expect(
      result.ok && JSON.parse(result.value).exportSettings.formats,
    ).toEqual(['mp4', 'wav']);
    Object.assign(document, { blob: 'binary' });
    expect(stringifyProjectDocument(document, limits).ok).toBe(false);
  });
  it('accepts exactly 1000 sources and 10000 occurrences and rejects one more', () => {
    const document = createProjectDocumentFixture();
    document.sources = Array.from({ length: 1000 }, (_, i) => ({
      ...document.sources[0],
      id: `source_${i}`,
    }));
    document.edit.video1 = [];
    document.edit.binSourceIds = document.sources.map((s) => s.id);
    expect(parse(document).ok).toBe(true);
    document.sources.push({ ...document.sources[0], id: 'source_extra' });
    document.edit.binSourceIds.push('source_extra');
    expect(parse(document)).toMatchObject({
      ok: false,
      issue: { code: 'limit' },
    });
    const many = createProjectDocumentFixture();
    const occurrence = many.edit.video1[0];
    many.edit.video1 = Array.from({ length: 10000 }, (_, i) => ({
      ...occurrence,
      id: `occ_${i}`,
      trim: { startFrame: 0, endFrame: 0 },
    }));
    expect(
      validateProjectDocument(many, { ...limits, max_clips: 20000 }).ok,
    ).toBe(true);
    many.edit.video1.push({ ...occurrence, id: 'occ_extra' });
    expect(
      validateProjectDocument(many, { ...limits, max_clips: 20000 }),
    ).toMatchObject({ ok: false, issue: { code: 'limit' } });
  });
  it.each([-1, 0.25, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'rejects invalid frame %s',
    (value) => {
      const document = createProjectDocumentFixture();
      document.edit.video1[0].trim.startFrame = value;
      expect(validateProjectDocument(document, limits).ok).toBe(false);
    },
  );
  it('reads strict UTF8 and rejects malformed byte input without a live source', async () => {
    const invalid = new File([], 'project.json');
    Object.defineProperty(invalid, 'arrayBuffer', {
      value: async () => new Uint8Array([0xff]).buffer,
    });
    expect(
      await readProjectFile(invalid, limits, new AbortController().signal),
    ).toMatchObject({ ok: false, issue: { code: 'corrupt' } });
    const valid = new File([], 'project.json');
    Object.defineProperty(valid, 'arrayBuffer', {
      value: async () =>
        new TextEncoder().encode(JSON.stringify(createProjectDocumentFixture()))
          .buffer,
    });
    expect(
      (await readProjectFile(valid, limits, new AbortController().signal)).ok,
    ).toBe(true);
  });
});
