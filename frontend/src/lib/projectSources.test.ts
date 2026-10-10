import { beforeEach, expect, it, vi } from 'vitest';
import {
  createProjectSources,
  collectReachableSources,
} from './projectSources';
import { createHistory, commitHistory, undoHistory } from './editHistory';
import { historySnapshot } from '../test/historyFixtures';
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    () => `blob:${Math.random()}`,
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
it('source identities, exact files, stale tokens and cleanup', () => {
  const sources = createProjectSources();
  const file = new File(['v'], 'same.mp4');
  const a = sources.register(file, 'video1'),
    b = sources.register(new File(['b'], file.name), 'video1');
  expect(a.sourceId).not.toBe(b.sourceId);
  expect(sources.get(a.sourceId)?.file).toBe(file);
  expect(
    sources.markReady({ ...a, requestId: a.requestId + 1 }, { duration: 2 }),
  ).toBe(false);
  const url = sources.ensureUrl(a.sourceId);
  sources.reconcileUrls(new Set([a.sourceId]));
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  sources.reconcileUrls(new Set());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  expect(sources.ensureUrl(a.sourceId)).not.toBe(url);
  sources.clear();
  expect(sources.markError(a)).toBe(false);
  expect(sources.get(a.sourceId)).toBeUndefined();
});
it('reachability includes history, preview, probes and external assets', () => {
  const initial = historySnapshot(['a']);
  const h = undoHistory(
    commitHistory(
      createHistory(initial),
      'ripple-delete',
      'Delete',
      historySnapshot([]),
    ),
  );
  expect(
    [
      ...collectReachableSources(
        h,
        historySnapshot(['b']),
        [{ session: 1, sourceId: 'probe', requestId: 1 }],
        new Set(['image', 'music']),
      ),
    ].sort(),
  ).toEqual(['image', 'music', 'probe', 'source:a', 'source:b']);
});
it('rejects incomplete or invalid kind-specific metadata without changing readiness', () => {
  const sources = createProjectSources();
  const video = sources.register(new File(['v'], 'v.mp4'), 'video1');
  expect(sources.markReady(video, { duration: 2 })).toBe(false);
  expect(sources.get(video.sourceId)?.status).toBe('loading');
  const pip = sources.register(new File(['v'], 'p.mp4'), 'pip');
  expect(sources.markReady(pip, { duration: NaN })).toBe(false);
  expect(sources.markReady(pip, { duration: 0 })).toBe(false);
  expect(sources.markReady(pip, { duration: 2 })).toBe(true);
  sources.markError(pip);
  expect(sources.markReady(pip, { duration: 2 })).toBe(false);
});
