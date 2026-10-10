import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEditHistory } from './useEditHistory';
import { clip } from '../test/fixtures';
const options = () => ({
  limits: { max_clips: 20, max_file_size_mb: 200 },
  editingLocked: false,
  trimDraftOpen: false,
  onError: vi.fn(),
  onAnnouncement: vi.fn(),
});
function setup() {
  const o = options(),
    hook = renderHook((props) => useEditHistory(props), { initialProps: o });
  const source = clip();
  act(() => hook.result.current.importVideo1([source.file]));
  const occurrence = hook.result.current.view.video1[0];
  const token = hook.result.current.sources.get(occurrence.sourceId)!.token;
  act(() =>
    hook.result.current.sourceReady(token, { clipMetadata: source.metadata }),
  );
  return { ...hook, o, token, id: occurrence.id };
}
it('transactions preview, commit once, cancellation and current eligibility', () => {
  const h = setup();
  let token: string | null = null;
  act(() => {
    token = h.result.current.begin('trim', h.id);
  });
  expect(token).not.toBeNull();
  expect(h.result.current.controls.canUndo).toBe(false);
  act(() => {
    expect(h.result.current.begin('trim', h.id)).toBeNull();
  });
  act(() =>
    h.result.current.preview(token!, {
      ...h.result.current.view,
      video1: h.result.current.view.video1.map((v) => ({
        ...v,
        trim: { startFrame: 10, endFrame: 59 },
      })),
    }),
  );
  expect(h.result.current.history.past).toHaveLength(0);
  act(() => {
    expect(h.result.current.finish(token!, true)).toBe(true);
    expect(h.result.current.finish(token!, true)).toBe(false);
  });
  expect(h.result.current.history.past).toHaveLength(1);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video1[0].trim?.startFrame).toBe(0);
  act(() => {
    token = h.result.current.begin('trim', h.id);
    h.result.current.preview(token!, {
      ...h.result.current.view,
      fpsSelection: '25',
    });
    h.result.current.finish(token!, false);
  });
  expect(h.result.current.history.future).toHaveLength(1);
  h.rerender({ ...h.o, editingLocked: true });
  act(() => expect(h.result.current.controls.redo()).toBe(false));
});
it('imports, metadata and excluded same-ID values rebase all snapshots', () => {
  const h = setup();
  act(() =>
    h.result.current.commit('fps', 'FPS', {
      ...h.result.current.view,
      fpsSelection: '25',
    }),
  );
  act(() => h.result.current.importVideo1([new File(['c'], 'c.mp4')]));
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video1).toHaveLength(2);
  act(() =>
    h.result.current.sourceReady(h.token, { clipMetadata: clip().metadata }),
  );
  expect(h.result.current.history.future).toHaveLength(1);
  act(() => h.result.current.rebaseSpeed(h.id, 0.5));
  expect(h.result.current.history.future).toHaveLength(0);
  expect(h.result.current.view.video1[0].speed).toBe(0.5);
});
it('audio does not revise structure; errors preserve atomic stacks', () => {
  const h = setup(),
    revision = h.result.current.structuralRevision;
  act(() =>
    h.result.current.commit('audio-mute', 'Mute', {
      ...h.result.current.view,
      audio: { ...h.result.current.view.audio, originalMuted: true },
    }),
  );
  act(() => h.result.current.controls.undo());
  expect(h.result.current.structuralRevision).toBe(revision);
  const before = h.result.current.history;
  act(() =>
    expect(
      h.result.current.commit('split', 'Split', {
        ...before.present,
        video1: [...before.present.video1, before.present.video1[0]],
      }),
    ).toBe(false),
  );
  expect(h.result.current.history).toBe(before);
  expect(h.o.onError).toHaveBeenCalled();
});
it('new_project_is_not_undoable_and_old_tokens_are_ignored', () => {
  const h = setup();
  act(() =>
    h.result.current.commit('fps', 'FPS', {
      ...h.result.current.view,
      fpsSelection: '25',
    }),
  );
  act(() => h.result.current.controls.undo());
  act(() => h.result.current.clearProject());
  expect(h.result.current.history.past).toHaveLength(0);
  expect(h.result.current.history.future).toHaveLength(0);
  expect(h.result.current.view).toMatchObject({
    video1: [],
    pip: null,
    fpsSelection: 'auto',
    audio: { originalVolume: 1, musicVolume: 0.3 },
  });
  act(() =>
    expect(
      h.result.current.sourceReady(h.token, { clipMetadata: clip().metadata }),
    ).toBe(false),
  );
  h.unmount();
});
it('pip_candidate_races commit against current edits, supersede and cancel', () => {
  const h = setup();
  let a: ReturnType<typeof h.result.current.stagePip>, b: typeof a;
  act(() => {
    a = h.result.current.stagePip(new File(['p'], 'old.mp4'));
    b = h.result.current.stagePip(new File(['p'], 'new.mp4'));
  });
  act(() =>
    expect(h.result.current.completePip(a!, { duration: 2 })).toBe(false),
  );
  act(() =>
    h.result.current.commit('fps', 'FPS', {
      ...h.result.current.view,
      fpsSelection: '25',
    }),
  );
  act(() =>
    expect(h.result.current.completePip(b!, { duration: 2 })).toBe(true),
  );
  expect(h.result.current.view.fpsSelection).toBe('25');
  const pip = h.result.current.view.pip!;
  expect(pip.sourceId).toBe(b!.sourceId);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.pip).toBeNull();
  act(() => h.result.current.controls.redo());
  expect(h.result.current.view.pip).toEqual(pip);
  act(() => {
    a = h.result.current.stagePip(new File(['p'], 'late.mp4'));
    h.result.current.controls.undo();
  });
  act(() =>
    expect(h.result.current.completePip(a!, { duration: 2 })).toBe(false),
  );
  expect(h.result.current.view.pip).toBeNull();
});
it('pip_candidate_races defer through a lock and modal without creating entries', () => {
  const h = setup();
  let token: ReturnType<typeof h.result.current.stagePip>;
  act(() => {
    token = h.result.current.stagePip(new File(['p'], 'pip.mp4'));
  });
  h.rerender({ ...h.o, editingLocked: true });
  act(() =>
    expect(h.result.current.completePip(token!, { duration: 2 })).toBe(false),
  );
  expect(h.result.current.view.pip).toBeNull();
  h.rerender({ ...h.o, trimDraftOpen: true });
  expect(h.result.current.view.pip).toBeNull();
  h.rerender(h.o);
  expect(h.result.current.history.past).toHaveLength(1);
  expect(h.result.current.view.pip?.sourceId).toBe(token!.sourceId);
});
it('metadata completion during a trim draft survives the committed gesture', () => {
  const h = setup();
  act(() => h.result.current.importVideo1([new File(['b'], 'b.mp4')]));
  const second = h.result.current.view.video1[1],
    source = h.result.current.sources.get(second.sourceId)!;
  let gesture: string | null;
  act(() => {
    gesture = h.result.current.begin('trim', h.id);
    h.result.current.preview(gesture!, {
      ...h.result.current.view,
      video1: h.result.current.view.video1.map((v) =>
        v.id === h.id ? { ...v, trim: { startFrame: 5, endFrame: 59 } } : v,
      ),
    });
  });
  act(() =>
    h.result.current.sourceReady(source.token, {
      clipMetadata: clip().metadata,
    }),
  );
  act(() => h.result.current.finish(gesture!, true));
  expect(h.result.current.view.video1[1].trim).toEqual({
    startFrame: 0,
    endFrame: 59,
  });
});
it('30 edit capacity, no-op gesture preserves Redo and capacity failure is atomic', () => {
  const h = setup();
  for (let i = 1; i <= 31; i++)
    act(() =>
      h.result.current.commit('trim', 'Trim', {
        ...h.result.current.view,
        video1: h.result.current.view.video1.map((v) => ({
          ...v,
          trim: { startFrame: i, endFrame: 59 },
        })),
      }),
    );
  for (let i = 0; i < 30; i++) act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video1[0].trim?.startFrame).toBe(1);
  expect(h.result.current.history.future).toHaveLength(30);
  act(() => {
    const token = h.result.current.begin('trim', h.id)!;
    h.result.current.preview(token, h.result.current.view);
    h.result.current.finish(token, true);
  });
  expect(h.result.current.history.future).toHaveLength(30);
  const before = h.result.current.history;
  h.rerender({ ...h.o, limits: { ...h.o.limits, max_clips: 0 } });
  act(() => expect(h.result.current.controls.redo()).toBe(false));
  expect(h.result.current.history).toBe(before);
});
it('URLs release on redo invalidation and eviction, while original files remain session-owned', () => {
  const h = setup();
  const file = new File(['p'], 'pip.mp4');
  let token: ReturnType<typeof h.result.current.stagePip>;
  act(() => {
    token = h.result.current.stagePip(file);
    h.result.current.completePip(token, { duration: 2 });
  });
  const url = h.result.current.sources.ensureUrl(token!.sourceId);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.sources.get(token!.sourceId)?.url).toBe(url);
  act(() =>
    h.result.current.commit('audio-mute', 'Mute', {
      ...h.result.current.view,
      audio: { ...h.result.current.view.audio, originalMuted: true },
    }),
  );
  expect(h.result.current.sources.get(token!.sourceId)?.url).toBeUndefined();
  expect(h.result.current.sources.get(token!.sourceId)?.file).toBe(file);
  const video = h.result.current.view.video1[0];
  act(() =>
    h.result.current.commit('ripple-delete', 'Delete', {
      ...h.result.current.view,
      video1: [],
    }),
  );
  expect(h.result.current.sources.get(video.sourceId)?.url).toBeDefined();
  for (let i = 0; i < 30; i++)
    act(() =>
      h.result.current.commit('audio-volume', 'Volume', {
        ...h.result.current.view,
        audio: { ...h.result.current.view.audio, originalVolume: i / 100 },
      }),
    );
  expect(h.result.current.sources.get(video.sourceId)?.url).toBeUndefined();
  expect(h.result.current.history.past).toHaveLength(30);
});
it('excluded speed and PIP schedule rebase matching identities without sibling propagation', () => {
  const h = setup(),
    sourceId = h.result.current.view.video1[0].sourceId;
  act(() =>
    h.result.current.commit('split', 'Split', {
      ...h.result.current.view,
      video1: [
        {
          id: 'left',
          sourceId,
          trim: { startFrame: 0, endFrame: 19 },
          trimSaved: true,
          speed: 1,
        },
        {
          id: 'right',
          sourceId,
          trim: { startFrame: 20, endFrame: 59 },
          trimSaved: true,
          speed: 0.5,
        },
      ],
    }),
  );
  act(() => h.result.current.rebaseSpeed('left', 0.75));
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video1[0].speed).toBe(1);
  act(() => h.result.current.controls.redo());
  expect(h.result.current.view.video1.map((v) => v.speed)).toEqual([0.75, 0.5]);
  act(() => {
    const t = h.result.current.stagePip(new File(['p'], 'p.mp4'));
    h.result.current.completePip(t, { duration: 2 });
  });
  const id = h.result.current.view.pip!.id;
  act(() =>
    h.result.current.commit('audio-mute', 'Mute', {
      ...h.result.current.view,
      audio: { ...h.result.current.view.audio, originalMuted: true },
    }),
  );
  act(() => h.result.current.rebasePipRange(id, { endFrame: 1000 }));
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.pip?.endFrame).toBe(1000);
});
it('an excluded asset edit cancels an active draft and invalidates Redo', () => {
  const h = setup();
  act(() =>
    h.result.current.commit('fps', 'FPS', {
      ...h.result.current.view,
      fpsSelection: '25',
    }),
  );
  act(() => h.result.current.controls.undo());
  act(() => {
    h.result.current.begin('trim', h.id);
    h.result.current.excludedUserEdit();
  });
  expect(h.result.current.gestureActive).toBe(false);
  expect(h.result.current.history.future).toHaveLength(0);
});
it('resource preparation failure leaves navigation and stacks unchanged', () => {
  const h = setup();
  act(() =>
    h.result.current.commit('ripple-delete', 'Delete', {
      ...h.result.current.view,
      video1: [],
    }),
  );
  h.result.current.sources.reconcileUrls(new Set());
  const before = h.result.current.history;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    throw new Error('Preview resource unavailable');
  });
  act(() => expect(h.result.current.controls.undo()).toBe(false));
  expect(h.result.current.history).toBe(before);
  expect(h.o.onError).toHaveBeenCalledWith('Preview resource unavailable');
});
