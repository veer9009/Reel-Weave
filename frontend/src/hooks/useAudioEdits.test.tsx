import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEditHistory } from './useEditHistory';
import { clip } from '../test/fixtures';
import type { AudioSplitTarget } from '../lib/audioSplit';

function setup(kind: 'independent' | 'music') {
  const hook = renderHook(() =>
    useEditHistory({
      limits: { max_clips: 20, max_file_size_mb: 200 },
      editingLocked: false,
      trimDraftOpen: false,
      onError: vi.fn(),
      onAnnouncement: vi.fn(),
    }),
  );
  const h = hook.result.current;
  act(() => {
    h.importVideo1([new File(['video'], 'base.mp4')]);
  });
  const picture = h.view.video1[0];
  act(() => {
    h.sourceReady(h.sources.get(picture.sourceId)!.token, {
      clipMetadata: clip().metadata!,
    });
  });
  const source = h.sources.register(new File(['pcm'], 'first.wav'), 'audio');
  h.sources.markReady(source, { duration: 10, sampleCount: 480000 });
  const segment = {
    id: 'sound',
    timelineStartFrame: 0,
    durationFrames: 40,
    sourceStartSample: 4800,
  };
  act(() => {
    expect(
      h.commit(
        kind === 'music' ? 'music-add' : 'independent-place',
        'add sound',
        {
          ...h.view,
          music:
            kind === 'music' ? [{ ...segment, sourceId: source.sourceId }] : [],
          independentAudio:
            kind === 'independent'
              ? [
                  {
                    ...segment,
                    source: { kind: 'audio-file', sourceId: source.sourceId },
                  },
                ]
              : [],
        },
      ),
    ).toBe(true);
  });
  return { h, hook, target: { kind, id: 'sound' } as AudioSplitTarget };
}

it.each(['independent', 'music'] as const)(
  'splits %s once, returns the right identity and restores IDs on redo',
  (kind) => {
    const { h, target } = setup(kind);
    const before = structuredClone(h.history.present);
    const count = h.history.past.length;
    let result: ReturnType<typeof h.splitAudio>;
    act(() => {
      result = h.splitAudio(target, 20);
    });
    expect(result!).toHaveProperty('value');
    if (!('value' in result!)) throw new Error('split failed');
    const ids = result!.value;
    expect(h.history.past.length).toBe(count + 1);
    expect(h.history.past.at(-1)?.label).toBe('Split Audio');
    const pieces = kind === 'music' ? h.view.music : h.view.independentAudio;
    expect(
      pieces.map((v) => [
        v.id,
        v.timelineStartFrame,
        v.durationFrames,
        v.sourceStartSample,
      ]),
    ).toEqual([
      [ids.leftId, 0, 20, 4800],
      [ids.rightId, 20, 20, 36800],
    ]);
    expect(h.view.video1).toEqual(before.video1);
    act(() => {
      h.controls.undo();
    });
    expect(h.history.present.video1).toEqual(before.video1);
    expect(
      (kind === 'music' ? h.view.music : h.view.independentAudio)[0].id,
    ).toBe('sound');
    const redo = h.history.future;
    act(() => {
      expect(h.splitAudio(target, 0)).toHaveProperty('error');
    });
    expect(h.history.future).toBe(redo);
    act(() => {
      h.controls.redo();
    });
    expect(
      (kind === 'music' ? h.view.music : h.view.independentAudio).map(
        (v) => v.id,
      ),
    ).toEqual([ids.leftId, ids.rightId]);
  },
);

it.each(['independent', 'music'] as const)(
  'replaces only one %s piece after metadata arrives',
  (kind) => {
    const { h, target } = setup(kind);
    let result: ReturnType<typeof h.splitAudio>;
    act(() => {
      result = h.splitAudio(target, 20);
    });
    if (!('value' in result!)) throw new Error('split failed');
    const right = { kind, id: result.value.rightId };
    const before = h.view;
    let token: ReturnType<typeof h.replaceAudioPiece>;
    act(() => {
      token = h.replaceAudioPiece(right, new File(['new'], 'new.wav'));
    });
    expect(token!).toBeTruthy();
    act(() => {
      h.sourceReady(token!, { duration: 10, sampleCount: 480000 });
    });
    const pieces = kind === 'music' ? h.view.music : h.view.independentAudio;
    expect(pieces[0]).toEqual(
      (kind === 'music' ? before.music : before.independentAudio)[0],
    );
    expect(pieces[1]).toMatchObject({
      id: right.id,
      timelineStartFrame: 20,
      durationFrames: 20,
      sourceStartSample: 0,
    });
    const sourceId =
      'source' in pieces[1] ? pieces[1].source.sourceId : pieces[1].sourceId;
    expect(sourceId).toBe(token!.sourceId);
    expect(h.view.video1).toEqual(before.video1);
  },
);

it.each(['independent', 'music'] as const)(
  'ignores stale %s replacement completion after Undo',
  (kind) => {
    const { h, target } = setup(kind);
    let token: ReturnType<typeof h.replaceAudioPiece>;
    act(() => {
      token = h.replaceAudioPiece(target, new File(['new'], 'new.wav'));
    });
    act(() => {
      h.controls.undo();
    });
    const unchanged = h.history.present;
    act(() => {
      h.sourceReady(token!, { duration: 10, sampleCount: 480000 });
    });
    expect(h.history.present).toBe(unchanged);
    expect(h.view.music).toHaveLength(0);
    expect(h.view.independentAudio).toHaveLength(0);
  },
);

it.each(['independent', 'music'] as const)(
  'only the latest %s replacement can complete even when earlier metadata arrives first',
  (kind) => {
    const { h, target } = setup(kind);
    const before = h.history.present;
    let first: ReturnType<typeof h.replaceAudioPiece>,
      last: ReturnType<typeof h.replaceAudioPiece>;
    act(() => {
      first = h.replaceAudioPiece(target, new File(['first'], 'first.wav'));
    });
    act(() => {
      last = h.replaceAudioPiece(target, new File(['last'], 'last.wav'));
    });
    act(() => {
      h.sourceReady(first!, { duration: 10, sampleCount: 480000 });
    });
    expect(h.history.present).toBe(before);
    act(() => {
      h.sourceReady(last!, { duration: 10, sampleCount: 480000 });
    });
    const piece =
      kind === 'music' ? h.view.music[0] : h.view.independentAudio[0];
    expect('source' in piece ? piece.source.sourceId : piece.sourceId).toBe(
      last!.sourceId,
    );
    expect(h.view.video1).toEqual(before.video1);
  },
);
