import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRelinkCandidate,
  createProjectMediaVerifier,
} from './projectMedia';
import { createProjectDocumentFixture } from '../test/projectFileFixtures';
const limits = { max_clips: 20, max_file_size_mb: 200 };
const signal = () => new AbortController().signal;
function file(bytes = 'abc', name = 'base.mp4') {
  const result = new File([bytes], name, { type: '', lastModified: 42 });
  Object.defineProperty(result, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(bytes).buffer,
  });
  return result;
}
afterEach(() => vi.useRealTimers());
describe('local project source verification', () => {
  it('uses real SHA256 and keeps the cache scoped to immutable File identity', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const verifier = createProjectMediaVerifier();
    expect(await verifier.fingerprint(file(), signal())).toEqual({
      ok: true,
      value: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
    const other = await verifier.fingerprint(file('abd'), signal());
    expect(other.ok && other.value).not.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    verifier.dispose();
  });
  it.each([0.05, 0.051])(
    'enforces observable duration tolerance %s',
    (difference) => {
      const source = createProjectDocumentFixture().sources[0];
      const evidence = {
        file: file(),
        sha256: source.sha256,
        metadata: {
          mediaType: 'video' as const,
          durationSeconds: 2 + difference,
          width: 320,
          height: 180,
        },
      };
      expect(
        checkRelinkCandidate(source, evidence, limits, new Set(['video1'])).ok,
      ).toBe(difference === 0.05);
    },
  );
  it('identifies renamed originals but rejects same-name different content', () => {
    const source = createProjectDocumentFixture().sources[0];
    const evidence = {
      file: file('abc', 'renamed.mp4'),
      sha256: source.sha256,
      metadata: {
        mediaType: 'video' as const,
        durationSeconds: 2,
        width: 320,
        height: 180,
      },
    };
    expect(
      checkRelinkCandidate(source, evidence, limits, new Set(['video1'])),
    ).toEqual({ ok: true, value: { renamed: true } });
    expect(
      checkRelinkCandidate(
        source,
        { ...evidence, sha256: '0'.repeat(64) },
        limits,
        new Set(['video1']),
      ).ok,
    ).toBe(false);
    expect(
      checkRelinkCandidate(
        source,
        { ...evidence, metadata: { ...evidence.metadata, width: 321 } },
        limits,
        new Set(['video1']),
      ).ok,
    ).toBe(false);
  });
  it('cancels queued and completed fingerprint work without accepting stale results', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const verifier = createProjectMediaVerifier();
    const controller = new AbortController();
    controller.abort();
    expect(await verifier.fingerprint(file(), controller.signal)).toMatchObject(
      { ok: false, issue: { code: 'cancelled' } },
    );
    verifier.dispose();
    expect(await verifier.fingerprint(file(), signal())).toMatchObject({
      ok: false,
    });
  });
  it('times out local probes and releases their URLs and listeners', async () => {
    vi.useFakeTimers();
    const verifier = createProjectMediaVerifier();
    const pending = verifier.inspect(file(), 'video', signal());
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toMatchObject({
      ok: false,
      issue: { code: 'media' },
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    verifier.dispose();
  });
  it('cancels probes immediately and rejects late metadata', async () => {
    const verifier = createProjectMediaVerifier();
    const controller = new AbortController();
    const pending = verifier.inspect(file(), 'video', controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      issue: { code: 'cancelled' },
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    verifier.dispose();
  });
});
