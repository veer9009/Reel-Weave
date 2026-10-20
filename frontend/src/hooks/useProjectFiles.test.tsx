import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { useEditHistory } from './useEditHistory';
import { useProjectFiles } from './useProjectFiles';
import { createProjectDocumentFixture } from '../test/projectFileFixtures';
const limits = { max_clips: 20, max_file_size_mb: 200 };
const availability = { saveDisabledReason: null, openDisabledReason: null };
function projectFile(text = JSON.stringify(createProjectDocumentFixture())) {
  const f = new File([text], 'edit.avstudio.json');
  Object.defineProperty(f, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(text).buffer,
  });
  return f;
}
function setup() {
  return renderHook(() => {
    const history = useEditHistory({
      limits,
      editingLocked: false,
      trimDraftOpen: false,
      onError: vi.fn(),
      onAnnouncement: vi.fn(),
    });
    const files = useProjectFiles({
      history,
      limits,
      availability,
      onOpened: vi.fn(),
      onAnnounce: vi.fn(),
    });
    return { history, files };
  });
}
it('invalid project files leave all current state and history intact', async () => {
  const h = setup(),
    before = h.result.current.history.history;
  await act(async () => h.result.current.files.open(projectFile('{broken')));
  expect(h.result.current.files.openPhase).toBe('failed');
  expect(h.result.current.files.issue?.code).toBe('corrupt');
  expect(h.result.current.history.history).toBe(before);
  act(() => h.result.current.files.cancelOpen());
  expect(h.result.current.history.history).toBe(before);
});
it('lists all required files and blocks confirmation while any are missing', async () => {
  const h = setup();
  const before = h.result.current.history.history;
  await act(async () => h.result.current.files.open(projectFile()));
  expect(h.result.current.files.rows).toHaveLength(1);
  expect(h.result.current.files.rows[0].status).toBe('missing');
  expect(h.result.current.files.canConfirm).toBe(false);
  expect(h.result.current.files.confirmOpen().ok).toBe(false);
  expect(h.result.current.history.controls.shortcutsAllowed).toBe(false);
  expect(h.result.current.history.history).toBe(before);
  act(() => h.result.current.files.cancelOpen());
  expect(h.result.current.history.controls.shortcutsAllowed).toBe(true);
});
it('late project reads cannot install or resurrect a cancelled Open', async () => {
  const h = setup();
  let resolve!: (value: ArrayBuffer) => void;
  const f = new File([], 'edit.json');
  Object.defineProperty(f, 'arrayBuffer', {
    value: () =>
      new Promise<ArrayBuffer>((r) => {
        resolve = r;
      }),
  });
  let pending!: Promise<void>;
  act(() => {
    pending = h.result.current.files.open(f);
  });
  act(() => h.result.current.files.cancelOpen());
  await act(async () => {
    resolve(
      new TextEncoder().encode(JSON.stringify(createProjectDocumentFixture()))
        .buffer,
    );
    await pending;
  });
  expect(h.result.current.files.openPhase).toBe('idle');
  expect(h.result.current.files.rows).toHaveLength(0);
  expect(h.result.current.history.history.past).toHaveLength(0);
});
it('reset cancels an open attempt before New Project clears sources', async () => {
  const h = setup();
  await act(async () => h.result.current.files.open(projectFile()));
  act(() => {
    h.result.current.files.reset();
    h.result.current.history.clearProject();
  });
  expect(h.result.current.files.openPhase).toBe('idle');
  expect(h.result.current.history.history.past).toHaveLength(0);
});
it('replacing a candidate aborts its owned probe and only the latest choice can match', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const probes: HTMLVideoElement[] = [];
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (this instanceof HTMLVideoElement && this.src) probes.push(this);
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (blob) => `blob:${(blob as File).name}`,
  );
  const h = setup();
  await act(async () => h.result.current.files.open(projectFile()));
  const make = (name: string) => {
    const f = new File(['abc'], name);
    Object.defineProperty(f, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('abc').buffer,
    });
    return f;
  };
  let first!: Promise<void>, second!: Promise<void>;
  act(() => {
    first = h.result.current.files.addMedia([make('first.mp4')], 'source_base');
  });
  await waitFor(() => expect(probes).toHaveLength(1));
  act(() => {
    second = h.result.current.files.addMedia([make('base.mp4')], 'source_base');
  });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first.mp4');
  await waitFor(() => expect(probes).toHaveLength(2));
  Object.defineProperties(probes[1], {
    duration: { value: 2 },
    videoWidth: { value: 320 },
    videoHeight: { value: 180 },
  });
  await act(async () => {
    fireEvent.loadedMetadata(probes[1]);
    await second;
    await first;
  });
  expect(h.result.current.files.rows[0].accepted?.evidence.file.name).toBe(
    'base.mp4',
  );
  expect(h.result.current.files.canConfirm).toBe(true);
});
