import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEditHistory } from './useEditHistory';
import { clip } from '../test/fixtures';
import { rippleDeletePositioned } from '../lib/positionedEdits';
import type { Video2Occurrence } from '../lib/advancedTimeline';
import { createProjectContext } from '../lib/projectContext';
import { createProjectSources } from '../lib/projectSources';
import { historySnapshot } from '../test/historyFixtures';
it('Open locks current edits and replaces all project context in one reversible action', () => {
  const restored = vi.fn(),
    o = { ...options(), onProjectContextRestore: restored };
  const h = renderHook(() => useEditHistory(o));
  const controller = h.result.current;
  const before = controller.history;
  const staging = createProjectSources();
  staging.registerReady({
    id: 'prepared_source',
    kind: 'video',
    mediaType: 'video',
    file: new File(['abc'], 'b.mp4'),
    metadata: {
      clipMetadata: {
        duration: 2,
        fps: 30,
        totalFrames: 60,
        width: 320,
        height: 180,
        source: 'browser',
      },
    },
  });
  const snapshot = historySnapshot(['b']);
  snapshot.video1 = [{ ...snapshot.video1[0], sourceId: 'prepared_source' }];
  const context = {
    ...createProjectContext(),
    exportFormats: ['mp4', 'mov'] as const,
    timingFps: 30 as const,
  };
  let lock: ReturnType<typeof controller.acquireProjectOpenLock> = null;
  act(() => {
    lock = controller.acquireProjectOpenLock();
  });
  expect(lock).not.toBeNull();
  expect(controller.controls.shortcutsAllowed).toBe(false);
  expect(controller.history).toBe(before);
  act(() => {
    expect(
      lock!.replace({
        envelope: { ...snapshot, projectContext: context },
        sources: staging,
        dispose: () => staging.clear(),
      }).ok,
    ).toBe(true);
    lock!.release();
  });
  expect(controller.history.past).toHaveLength(1);
  expect(restored).toHaveBeenCalledTimes(1);
  act(() => {
    expect(controller.controls.undo()).toBe(true);
  });
  const aContext = controller.projectContext;
  act(() =>
    controller.updateExternalProjectContext(
      { exportFormats: ['mp4', 'wav'] },
      'export',
    ),
  );
  expect(controller.controls.canRedo).toBe(true);
  act(() => {
    expect(controller.controls.redo()).toBe(true);
  });
  expect(controller.projectContext.exportFormats).toEqual(['mp4', 'mov']);
  act(() => controller.controls.undo());
  expect(controller.projectContext.incarnationId).toBe(aContext.incarnationId);
  expect(controller.projectContext.exportFormats).toEqual(['mp4', 'wav']);
});
it('a cancelled Open lock neither resets transport nor changes history', () => {
  const h = renderHook(() => useEditHistory(options()));
  const cancel = vi.fn();
  h.result.current.bindTransport({ cancel, capture: vi.fn(), apply: vi.fn() });
  const before = h.result.current.history;
  act(() => {
    const lock = h.result.current.acquireProjectOpenLock();
    lock!.release();
  });
  expect(cancel).not.toHaveBeenCalled();
  expect(h.result.current.history).toBe(before);
});
it('imports into B ignore audio-only snapshots retained from project A', () => {
  const o = { ...options(), limits: { max_clips: 2, max_file_size_mb: 200 } };
  const h = renderHook(() => useEditHistory(o));
  const controller = h.result.current;
  const aSources = createProjectSources();
  aSources.registerReady({
    id: 'a_audio',
    kind: 'audio',
    mediaType: 'audio',
    file: new File(['audio'], 'a.wav'),
    metadata: { duration: 2, sampleCount: 96000 },
  });
  const a = historySnapshot([]);
  a.independentAudio = [
    {
      id: 'a_segment',
      timelineStartFrame: 0,
      durationFrames: 30,
      sourceStartSample: 0,
      source: { kind: 'audio-file', sourceId: 'a_audio' },
    },
  ];
  const bSources = createProjectSources();
  bSources.registerReady({
    id: 'b_video',
    kind: 'video',
    mediaType: 'video',
    file: new File(['video'], 'b.mp4'),
    metadata: {
      clipMetadata: {
        ...clip().metadata!,
        duration: 2,
        fps: 30,
        totalFrames: 60,
      },
    },
  });
  const b = historySnapshot(['b1', 'b2']);
  b.video1 = b.video1.map((v) => ({ ...v, sourceId: 'b_video' }));
  for (const [snapshot, sources] of [
    [a, aSources],
    [b, bSources],
  ] as const) {
    act(() => {
      const lock = controller.acquireProjectOpenLock()!;
      expect(
        lock.replace({
          envelope: {
            ...snapshot,
            projectContext: { ...createProjectContext(), timingFps: 30 },
          },
          sources,
          dispose: () => sources.clear(),
        }).ok,
      ).toBe(true);
      lock.release();
    });
  }
  act(() => {
    expect(
      controller.commitVideo1('ripple-delete', 'Delete second clip', [
        controller.view.video1[0],
      ]),
    ).toBe(true);
  });
  act(() => controller.importVideo1([new File(['new'], 'replacement.mp4')]));
  expect(controller.pendingImports).toHaveLength(0);
  expect(controller.view.video1).toHaveLength(2);
  const imported = controller.view.video1[1];
  act(() =>
    controller.sourceReady(controller.sources.get(imported.sourceId)!.token, {
      clipMetadata: {
        ...clip().metadata!,
        duration: 1,
        fps: 30,
        totalFrames: 30,
      },
    }),
  );
  expect(controller.view.video1[1].trim).toEqual({
    startFrame: 0,
    endFrame: 29,
  });
  expect(o.onError).not.toHaveBeenCalled();
});
const options = () => ({
  limits: { max_clips: 20, max_file_size_mb: 200 },
  editingLocked: false,
  trimDraftOpen: false,
  onError: vi.fn(),
  onAnnouncement: vi.fn(),
});
it.each([false, true])(
  'a_new_Auto_base_preflights_audio_only_history_before_rebasing_%s',
  (collapse) => {
    const o = options(),
      h = renderHook(() => useEditHistory(o));
    act(() => h.result.current.importVideo1([new File(['old'], 'old.mp4')]));
    const occurrence = h.result.current.view.video1[0],
      token = h.result.current.sources.get(occurrence.sourceId)!.token;
    act(() =>
      h.result.current.sourceReady(token, {
        clipMetadata: {
          ...clip().metadata!,
          fps: collapse ? 60 : 30,
          totalFrames: 60,
          duration: collapse ? 1 : 2,
        },
      }),
    );
    act(() =>
      expect(
        h.result.current.commitDetach({ track: 'video1', id: occurrence.id }),
      ).toBe(true),
    );
    if (collapse)
      act(() =>
        expect(
          h.result.current.commitAudioEdit({
            action: 'trim',
            id: h.result.current.view.independentAudio[0].id,
            edge: 'end',
            deltaFrames: -59,
          }),
        ).toBe(true),
      );
    act(() =>
      expect(
        h.result.current.commitVideo1('ripple-delete', 'Remove picture', []),
      ).toBe(true),
    );
    const before = h.result.current.history,
      frozen = h.result.current.view.independentAudio[0].source;
    act(() => h.result.current.importVideo1([new File(['next'], 'next.mp4')]));
    expect(h.result.current.view.video1).toEqual([]);
    const pending = h.result.current.pendingImports[0];
    act(() =>
      h.result.current.sourceReady(pending, {
        clipMetadata: {
          ...clip().metadata!,
          fps: collapse ? 24 : 60,
          totalFrames: 120,
          duration: collapse ? 5 : 2,
        },
      }),
    );
    if (collapse) {
      expect(h.result.current.history).toBe(before);
      expect(h.result.current.view.independentAudio[0].durationFrames).toBe(1);
      expect(o.onError).toHaveBeenCalled();
    } else {
      expect(h.result.current.view.independentAudio[0].durationFrames).toBe(
        120,
      );
      expect(h.result.current.view.independentAudio[0].source).toEqual(frozen);
      expect(h.result.current.view.independentAudio[0].sourceStartSample).toBe(
        0,
      );
    }
    expect(h.result.current.pendingImports).toEqual([]);
  },
);
it('successful_edits_emit_live_transient_transport_and_rejected_or_noop_edits_emit_nothing', () => {
  const h = setup(),
    capture = vi.fn(() => ({
      frame: 12,
      projectSeconds: 0.4,
      playingIntent: true,
      occurrenceId: h.id,
      sourceId: h.token.sourceId,
      sourceTime: 0.4,
    })),
    apply = vi.fn(),
    cancel = vi.fn();
  act(() => h.result.current.bindTransport({ capture, apply, cancel }));
  act(() =>
    h.result.current.commitPlacement({
      token: h.token,
      track: 'video1',
      timelineStartFrame: 10,
      trim: { startFrame: 0, endFrame: 9 },
    }),
  );
  expect(capture).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ frame: 12 }),
    expect.objectContaining({
      action: 'overwrite',
      before: expect.anything(),
      after: expect.anything(),
    }),
  );
  act(() =>
    h.result.current.commitAudioEdit({ action: 'lift', id: 'missing' }),
  );
  expect(apply).toHaveBeenCalledTimes(1);
  act(() => h.result.current.controls.undo());
  expect(apply).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ action: 'undo' }),
  );
  act(() => h.result.current.clearProject());
  expect(cancel).toHaveBeenCalledOnce();
  expect(JSON.stringify(h.result.current.history)).not.toContain(
    'playingIntent',
  );
});
it('auto_fps_reorder_converts_short_music_before_source_EOF_validation', () => {
  const h = setup();
  act(() =>
    h.result.current.importVideo1([new File(['second'], 'second.mp4')]),
  );
  const second = h.result.current.view.video1[1];
  const token = h.result.current.sources.get(second.sourceId)!.token;
  act(() =>
    h.result.current.sourceReady(token, {
      clipMetadata: { ...clip().metadata!, fps: 24 },
    }),
  );
  const song = h.result.current.sources.register(
    new File(['song'], 'song.wav'),
    'music',
  );
  act(() => {
    h.result.current.sources.markReady(song, {
      duration: 0.2,
      sampleCount: 9600,
    });
    expect(
      h.result.current.commit('music-add', 'Add short song', {
        ...h.result.current.view,

        music: [
          {
            id: 'music',
            sourceId: song.sourceId,
            timelineStartFrame: 0,
            sourceStartSample: 0,
            durationFrames: 6,
          },
        ],
      }),
    ).toBe(true);
  });
  act(() =>
    expect(
      h.result.current.commitVideo1(
        'reorder',
        'Reorder clips',
        [...h.result.current.view.video1].reverse(),
      ),
    ).toBe(true),
  );
  expect(h.result.current.view.music[0].durationFrames).toBe(5);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.music[0].durationFrames).toBe(6);
  act(() => h.result.current.controls.redo());
  expect(h.result.current.view.music[0].durationFrames).toBe(5);
  expect(h.result.current.view.music[0].sourceStartSample).toBe(0);
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
it('undo_restores_the_auto_FPS_fallback_for_audio_only_project_edits', () => {
  const h = setup(),
    controller = h.result.current;
  act(() => {
    expect(controller.commitDetach({ track: 'video1', id: h.id })).toBe(true);
  });
  act(() => {
    expect(controller.commitVideo1('ripple-delete', 'Remove picture', [])).toBe(
      true,
    );
  });
  act(() => {
    expect(controller.setFpsSelection('50')).toBe(true);
  });
  act(() => {
    expect(controller.controls.undo()).toBe(true);
  });
  const segment = controller.view.independentAudio[0];
  act(() => {
    expect(
      controller.commitAudioEdit({
        action: 'split',
        id: segment.id,
        frame: 30,
      }),
    ).toBe(true);
  });
  expect(controller.view.independentAudio[1].sourceStartSample).toBe(48000);
});
it('external_drop_is_one_action_and_metadata_conflicts_preserve_redo_and_release_candidate', () => {
  const h = setup();
  let token: ReturnType<typeof h.result.current.importToBin> = null;
  act(() => {
    token = h.result.current.importToBin(
      new File(['take'], 'take.mp4'),
      'video',
      { track: 'video2', timelineStartFrame: 0 },
    );
  });
  act(() =>
    h.result.current.commitPlacement({
      token: h.token,
      track: 'video2',
      timelineStartFrame: 0,
      trim: { startFrame: 0, endFrame: 29 },
    }),
  );
  const before = h.result.current.history;
  act(() =>
    h.result.current.sourceReady(token!, {
      clipMetadata: { ...clip().metadata!, totalFrames: 30, duration: 1 },
    }),
  );
  expect(h.result.current.history).toBe(before);
  expect(h.result.current.pendingBinImports).toEqual([]);
  expect(h.result.current.sources.get(token!.sourceId)?.url).toBeUndefined();
  expect(h.o.onError).toHaveBeenCalledWith(
    'This range overlaps another clip on Video 2. Move it to a free range.',
  );
});
it('bin_readiness_during_a_trim_waits_until_the_draft_closes', () => {
  const h = setup();
  let token: ReturnType<typeof h.result.current.importToBin> = null;
  act(() => {
    token = h.result.current.importToBin(
      new File(['take'], 'take.mp4'),
      'video',
    );
  });
  h.rerender({ ...h.o, trimDraftOpen: true });
  act(() =>
    h.result.current.sourceReady(token!, { clipMetadata: clip().metadata }),
  );
  expect(h.result.current.view.binSourceIds).toEqual([]);
  h.rerender(h.o);
  expect(h.result.current.view.binSourceIds).toEqual([token!.sourceId]);
  expect(h.result.current.history.past).toHaveLength(1);
});
it('bin_import_remove_are_undoable_and_pending_readiness_cannot_commit_to_a_new_session', () => {
  const h = setup();
  let token: ReturnType<typeof h.result.current.importToBin> = null;
  act(() => {
    token = h.result.current.importToBin(new File(['bin'], 'bin.mp4'), 'video');
  });
  expect(h.result.current.view.binSourceIds).toEqual([]);
  act(() =>
    h.result.current.sourceReady(token!, { clipMetadata: clip().metadata }),
  );
  expect(h.result.current.view.binSourceIds).toEqual([token!.sourceId]);
  expect(h.result.current.history.past).toHaveLength(1);
  act(() => h.result.current.removeBinSource(token!.sourceId));
  expect(h.result.current.view.video1).toHaveLength(1);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.binSourceIds).toEqual([token!.sourceId]);
  let pending: ReturnType<typeof h.result.current.importToBin> = null;
  act(() => {
    pending = h.result.current.importToBin(
      new File(['old'], 'old.mp4'),
      'video',
    );
  });
  act(() => h.result.current.clearProject());
  act(() =>
    expect(
      h.result.current.sourceReady(pending!, { clipMetadata: clip().metadata }),
    ).toBe(false),
  );
  expect(h.result.current.view.binSourceIds).toEqual([]);
});
it('detach_and_audio_edit_each_commit_once_undo_restores_mode_and_failed_edits_keep_redo', () => {
  const h = setup();
  act(() =>
    expect(h.result.current.commitDetach({ track: 'video1', id: h.id })).toBe(
      true,
    ),
  );
  const segment = h.result.current.view.independentAudio[0];
  expect(h.result.current.history.past).toHaveLength(1);
  expect(h.result.current.view.video1[0].originalAudio).toBe('detached');
  act(() =>
    h.result.current.commitAudioEdit({
      action: 'move',
      id: segment.id,
      startFrame: 5,
    }),
  );
  expect(h.result.current.history.past).toHaveLength(2);
  act(() => h.result.current.controls.undo());
  const future = h.result.current.history.future;
  act(() =>
    expect(
      h.result.current.commitAudioEdit({
        action: 'move',
        id: segment.id,
        startFrame: -1,
      }),
    ).toBe(false),
  );
  act(() =>
    expect(
      h.result.current.commitAudioEdit({
        action: 'move',
        id: segment.id,
        startFrame: 0,
      }),
    ).toBe(false),
  );
  expect(h.result.current.history.future).toBe(future);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video1[0].originalAudio).toBe('linked');
  expect(h.result.current.view.independentAudio).toEqual([]);
});
it('placement_overwrite_is_one_history_action_and_uses_current_source_token', () => {
  const h = setup();
  act(() =>
    expect(
      h.result.current.commitPlacement({
        token: h.token,
        track: 'video1',
        timelineStartFrame: 10,
        trim: { startFrame: 0, endFrame: 9 },
      }),
    ).toBe(true),
  );
  expect(h.result.current.view.video1).toHaveLength(3);
  expect(h.result.current.history.past).toHaveLength(1);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video1).toHaveLength(1);
  const future = h.result.current.history.future;
  act(() =>
    expect(
      h.result.current.commitPlacement({
        token: { ...h.token, session: h.token.session + 1 },
        track: 'video1',
        timelineStartFrame: 0,
      }),
    ).toBe(false),
  );
  expect(h.result.current.history.future).toBe(future);
});
it('independent_audio_gesture_commits_once_and_lock_cancels_the_draft', () => {
  const h = setup();
  act(() => h.result.current.commitDetach({ track: 'video1', id: h.id }));
  const segment = h.result.current.view.independentAudio[0];
  let token: string | null = null;
  act(() => {
    token = h.result.current.begin('independent-move', segment.id);
  });
  act(() =>
    h.result.current.preview(token!, {
      ...h.result.current.view,
      independentAudio: [{ ...segment, timelineStartFrame: 5 }],
    }),
  );
  act(() =>
    h.result.current.preview(token!, {
      ...h.result.current.view,
      independentAudio: [{ ...segment, timelineStartFrame: 8 }],
    }),
  );
  act(() => expect(h.result.current.finish(token!, true)).toBe(true));
  expect(h.result.current.history.past).toHaveLength(2);
  act(() => {
    token = h.result.current.begin('independent-move', segment.id);
  });
  h.rerender({ ...h.o, editingLocked: true });
  act(() => expect(h.result.current.finish(token!, true)).toBe(false));
  expect(h.result.current.view.independentAudio[0].timelineStartFrame).toBe(8);
});
it('removed_song_restores_same_File_and_valid_URL', () => {
  const h = setup(),
    file = new File(['audio'], 'song.wav');
  const source = h.result.current.sources.register(file, 'music');
  act(() => {
    h.result.current.sources.markReady(source, { duration: 1 });
    h.result.current.commit('music-add', 'Add song', {
      ...h.result.current.view,

      music: [
        {
          id: 'song',
          sourceId: source.sourceId,
          timelineStartFrame: 0,
          sourceStartSample: 0,
          durationFrames: 30,
        },
      ],
    });
  });
  const deleted = rippleDeletePositioned(
    h.result.current.view,
    'music',
    'song',
  );
  if ('error' in deleted) throw new Error(deleted.error.message);
  act(() =>
    h.result.current.commit(
      'music-ripple-delete',
      'Delete music',
      deleted.value,
    ),
  );
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.music).toHaveLength(1);
  expect(h.result.current.sources.get(source.sourceId)?.file).toBe(file);
  expect(h.result.current.sources.ensureUrl(source.sourceId)).toMatch(/^blob:/);
});
it('auto_reorder_converts_positions_atomically_and_missing_restore_preserves_stacks', () => {
  const h = setup();
  let replacement: Video2Occurrence;
  act(() => {
    replacement = {
      id: 'take',
      sourceId: h.token.sourceId,
      trim: { startFrame: 0, endFrame: 29 },
      trimSaved: true,
      speed: 1,
      timelineStartFrame: 10,
      contentInFrame: 0,
      contentOutFrame: 20,
      contentFullSource: false,
    };
    h.result.current.commit('video2-add', 'Add', {
      ...h.result.current.view,
      video2: [replacement],
    });
  });
  act(() => expect(h.result.current.setFpsSelection('60')).toBe(true));
  expect(h.result.current.view.video2[0].timelineStartFrame).toBe(20);
  expect(h.result.current.view.video2[0].contentOutFrame).toBe(40);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video2[0].timelineStartFrame).toBe(10);
  const before = h.result.current.history;
  act(() => h.result.current.sources.clear());
  act(() => expect(h.result.current.controls.redo()).toBe(false));
  expect(h.result.current.history).toBe(before);
});
it('positioned_overlap_rejected_and_invalid_out_of_project_can_restore', () => {
  const h = setup();
  const v: Video2Occurrence = {
    id: 'take',
    sourceId: h.token.sourceId,
    trim: { startFrame: 0, endFrame: 29 },
    trimSaved: true,
    speed: 1,
    timelineStartFrame: 10,
    contentInFrame: 0,
    contentOutFrame: 20,
    contentFullSource: false,
  };
  act(() =>
    expect(
      h.result.current.commit('video2-add', 'Add', {
        ...h.result.current.view,
        video2: [v, { ...v, id: 'other', timelineStartFrame: 15 }],
      }),
    ).toBe(false),
  );
  expect(h.result.current.view.video2).toHaveLength(0);
  act(() =>
    expect(
      h.result.current.commit('video2-add', 'Add', {
        ...h.result.current.view,
        video2: [{ ...v, timelineStartFrame: 100 }],
      }),
    ).toBe(false),
  );
  act(() =>
    expect(
      h.result.current.commit('video2-add', 'Add', {
        ...h.result.current.view,
        video2: [v],
      }),
    ).toBe(true),
  );
  act(() => h.result.current.commitVideo1('ripple-delete', 'Delete base', []));
  expect(h.result.current.view.video2).toHaveLength(1);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video1).toHaveLength(1);
});
it('nonhistorical_import_preflights_retained_snapshots_after_empty_base', () => {
  const h = setup();
  const v: Video2Occurrence = {
    id: 'take',
    sourceId: h.token.sourceId,
    trim: { startFrame: 0, endFrame: 29 },
    trimSaved: true,
    speed: 1,
    timelineStartFrame: 10,
    contentInFrame: 0,
    contentOutFrame: 20,
    contentFullSource: false,
  };
  act(() =>
    h.result.current.commit('video2-add', 'Add', {
      ...h.result.current.view,
      video2: [v],
    }),
  );
  act(() => h.result.current.commitVideo1('ripple-delete', 'Delete', []));
  act(() => h.result.current.importVideo1([new File(['next'], 'next.mp4')]));
  expect(h.result.current.view.video1).toHaveLength(0);
  expect(h.result.current.pendingImports).toHaveLength(1);
  const token = h.result.current.pendingImports[0];
  act(() =>
    h.result.current.sourceReady(token, {
      clipMetadata: clip('next', 25).metadata,
    }),
  );
  expect(h.result.current.view.video1).toHaveLength(1);
  expect(h.result.current.view.video2[0].timelineStartFrame).toBe(8);
  act(() => h.result.current.controls.undo());
  expect(h.result.current.view.video1).toHaveLength(2);
});
it('positioned_gesture_outside_export_rolls_back_without_history', () => {
  const h = setup();
  const v: Video2Occurrence = {
    id: 'take',
    sourceId: h.token.sourceId,
    trim: { startFrame: 0, endFrame: 29 },
    trimSaved: true,
    speed: 1,
    timelineStartFrame: 10,
    contentInFrame: 0,
    contentOutFrame: 20,
    contentFullSource: false,
  };
  act(() =>
    h.result.current.commit('video2-add', 'Add', {
      ...h.result.current.view,
      video2: [v],
    }),
  );
  const before = h.result.current.history;
  let token: string | null = null;
  act(() => {
    token = h.result.current.begin('video2-move', 'take');
  });
  act(() =>
    h.result.current.preview(token!, {
      ...h.result.current.view,
      video2: [{ ...v, timelineStartFrame: 100 }],
    }),
  );
  act(() => expect(h.result.current.finish(token!, true)).toBe(false));
  expect(h.result.current.history).toBe(before);
});
it('candidate_ready_after_undo_cannot_reinstall_and_new_choice_supersedes', () => {
  const h = setup();
  let a: ReturnType<typeof h.result.current.stageTimelineSource>, b: typeof a;
  act(() => {
    a = h.result.current.stageTimelineSource(
      new File(['a'], 'a.mp4'),
      'video2',
      10,
    );
  });
  act(() => {
    b = h.result.current.stageTimelineSource(
      new File(['b'], 'b.mp4'),
      'video2',
      10,
    );
  });
  act(() =>
    expect(
      h.result.current.completeTimelineSource(a!, {
        clipMetadata: clip().metadata,
      }),
    ).toBe(false),
  );
  act(() =>
    expect(
      h.result.current.completeTimelineSource(b!, {
        clipMetadata: clip().metadata,
      }),
    ).toBe(true),
  );
  expect(h.result.current.view.video2).toHaveLength(0);
  act(() =>
    expect(
      h.result.current.acceptTimelineSource(b!, {
        timelineStartFrame: 10,
        trim: { startFrame: 0, endFrame: 29 },
      }),
    ).toBe(true),
  );
  act(() => h.result.current.controls.undo());
  act(() =>
    expect(
      h.result.current.completeTimelineSource(b!, {
        clipMetadata: clip().metadata,
      }),
    ).toBe(false),
  );
  expect(h.result.current.view.video2).toHaveLength(0);
});
it('overlong_replacement_stays_draft_and_locked_probe_cannot_commit', () => {
  const h = setup();
  let token: ReturnType<typeof h.result.current.stageTimelineSource>;
  act(() => {
    token = h.result.current.stageTimelineSource(
      new File(['v'], 'v.mp4'),
      'video2',
      10,
    );
  });
  act(() =>
    h.result.current.completeTimelineSource(token!, {
      clipMetadata: clip().metadata,
    }),
  );
  act(() =>
    expect(
      h.result.current.acceptTimelineSource(token!, { timelineStartFrame: 10 }),
    ).toBe(false),
  );
  expect(h.result.current.view.video2).toHaveLength(0);
  expect(h.result.current.pendingTimelineSources).toHaveLength(1);
  h.rerender({ ...h.o, editingLocked: true });
  act(() =>
    expect(
      h.result.current.acceptTimelineSource(token!, { timelineStartFrame: 0 }),
    ).toBe(false),
  );
  expect(h.result.current.pendingTimelineSources).toHaveLength(0);
});
it('failed_song_replacement_keeps_previous_segments', () => {
  const h = setup();
  let song: ReturnType<typeof h.result.current.stageTimelineSource>;
  act(() => {
    song = h.result.current.stageTimelineSource(
      new File(['a'], 'song.wav'),
      'music',
      0,
    );
  });
  act(() => h.result.current.completeTimelineSource(song!, { duration: 1 }));
  act(() =>
    expect(
      h.result.current.acceptTimelineSource(song!, { timelineStartFrame: 0 }),
    ).toBe(true),
  );
  const before = h.result.current.history;
  let failed: typeof song;
  act(() => {
    failed = h.result.current.stageTimelineSource(
      new File(['bad'], 'bad.wav'),
      'music',
      0,
    );
    h.result.current.failTimelineSource(failed!);
  });
  expect(h.result.current.history).toBe(before);
  expect(h.result.current.view.music).toHaveLength(1);
});
it('one_invalid_replacement_can_be_repaired_while_another_remains_invalid', () => {
  const h = setup();
  const v: Video2Occurrence = {
    id: 'a',
    sourceId: h.token.sourceId,
    trim: { startFrame: 0, endFrame: 29 },
    trimSaved: true,
    speed: 1,
    timelineStartFrame: 20,
    contentInFrame: 0,
    contentOutFrame: 10,
    contentFullSource: false,
  };
  act(() =>
    h.result.current.commit('video2-add', 'Add', {
      ...h.result.current.view,
      video2: [v, { ...v, id: 'b', timelineStartFrame: 40 }],
    }),
  );
  act(() =>
    h.result.current.commitVideo1(
      'trim',
      'Shorten',
      h.result.current.view.video1.map((v) => ({
        ...v,
        trim: { startFrame: 0, endFrame: 9 },
        trimSaved: true,
      })),
    ),
  );
  act(() =>
    expect(
      h.result.current.commit('video2-move', 'Repair', {
        ...h.result.current.view,
        video2: h.result.current.view.video2.map((v) =>
          v.id === 'a' ? { ...v, timelineStartFrame: 0 } : v,
        ),
      }),
    ).toBe(true),
  );
  expect(h.result.current.view.video2[1].timelineStartFrame).toBe(40);
});
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
it('pip_candidate_races cancel through delivery lock without creating entries', () => {
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
  expect(h.result.current.history.past).toHaveLength(0);
  expect(h.result.current.view.pip).toBeNull();
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
it('URLs and unowned Files release on redo invalidation and eviction', () => {
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
  expect(h.result.current.sources.get(token!.sourceId)).toBeUndefined();
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
