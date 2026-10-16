import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineProjection } from '../lib/timeline';
import { useProjectPlayback } from './useProjectPlayback';
const ready: TimelineProjection = {
  status: 'ready',
  fps: 25,
  totalFrames: 50,
  durationSeconds: 2,
  items: [],
};
describe('shared project playback', () => {
  it('registering_an_already_pending_readiness_token_does_not_publish_another_render', () => {
    const renders = vi.fn();
    const { result } = renderHook(() => {
      renders();
      return useProjectPlayback(ready, 0);
    });
    act(() => result.current.toggle());
    act(() => result.current.suspend(7));
    const count = renders.mock.calls.length;
    act(() => result.current.suspend(7));
    expect(renders).toHaveBeenCalledTimes(count);
    expect(result.current.status).toBe('preparing');
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('empty_transport_disabled', () => {
    const { result } = renderHook(() =>
      useProjectPlayback({ ...ready, status: 'empty', totalFrames: 0 }, 0),
    );
    act(() => result.current.toggle());
    expect(result.current.frame).toBeNull();
    expect(result.current.playing).toBe(false);
  });
  it('real_presented_picture_frames_anchor_the_monotonic_clock_without_restoring_paused_intent', () => {
    const { result } = renderHook(() => useProjectPlayback(ready, 0));
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.observePicture(0.02, performance.now()));
    expect(result.current.captureAnchor().projectSeconds).toBeCloseTo(0.02, 4);
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.captureAnchor().projectSeconds).toBeCloseTo(0.04, 4);
    act(() => result.current.pause());
    const frame = result.current.frame;
    act(() => result.current.observePicture(0.8, performance.now()));
    expect(result.current.frame).toBe(frame);
    expect(result.current.playing).toBe(false);
  });
  it('picture_and_sound_readiness_both_gate_the_shared_clock', () => {
    const { result } = renderHook(() => useProjectPlayback(ready, 0));
    act(() => result.current.toggle());
    act(() => result.current.suspend(10));
    act(() => result.current.suspend(-10));
    act(() => result.current.ready(10));
    expect(result.current.status).toBe('preparing');
    act(() => result.current.ready(-10));
    expect(result.current.status).toBe('playing');
  });
  it('pause_and_newer_edits_cancel_stale_readiness_and_capture_elapsed_time_between_ticks', () => {
    const { result } = renderHook(() => useProjectPlayback(ready, 0));
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(15));
    expect(result.current.captureAnchor().projectSeconds).toBeCloseTo(0.015, 4);
    act(() => result.current.suspend(1));
    expect(result.current.status).toBe('preparing');
    const frame = result.current.frame;
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.frame).toBe(frame);
    act(() => result.current.pause());
    act(() => result.current.ready(1));
    expect(result.current.playing).toBe(false);
    act(() => result.current.toggle());
    act(() => result.current.suspend(2));
    act(() => result.current.suspend(3));
    act(() => result.current.ready(2));
    expect(result.current.status).toBe('preparing');
    act(() => result.current.ready(3));
    expect(result.current.status).toBe('playing');
  });
  it('seek_clamps_to_integer_frame', () => {
    const { result } = renderHook(() => useProjectPlayback(ready, 0));
    act(() => result.current.seek(100));
    expect(result.current.frame).toBe(49);
    act(() => result.current.seek(3.7));
    expect(result.current.frame).toBe(3);
  });
  it('play_stops_at_final_frame_and_restarts', () => {
    const { result } = renderHook(() => useProjectPlayback(ready, 0));
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(2200));
    expect(result.current.frame).toBe(49);
    expect(result.current.playing).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.frame).toBe(0);
  });
  it('structural_revision_preserves_intent_and_shortening_at_EOF_pauses', () => {
    const { result, rerender } = renderHook(
      ({ timeline, revision }) => useProjectPlayback(timeline, revision),
      { initialProps: { timeline: ready, revision: 0 } },
    );
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.frame).toBe(25);
    rerender({ timeline: ready, revision: 1 });
    expect(result.current.playing).toBe(true);
    rerender({ timeline: { ...ready, totalFrames: 10 }, revision: 2 });
    expect(result.current.frame).toBe(9);
    expect(result.current.playing).toBe(false);
    rerender({
      timeline: { ...ready, status: 'unavailable', totalFrames: 0 },
      revision: 3,
    });
    expect(result.current.frame).toBeNull();
  });
  it('resetPlayback_stops_and_returns_to_zero_preserving_project', () => {
    const original = structuredClone(ready);
    const { result } = renderHook(() => useProjectPlayback(ready, 7));
    act(() => result.current.seek(30));
    act(() => result.current.toggle());
    act(() => result.current.resetPlayback());
    expect(result.current.frame).toBe(0);
    expect(result.current.playing).toBe(false);
    expect(ready).toEqual(original);
  });
  it('resetPlayback_without_valid_timeline_keeps_null_frame', () => {
    const { result } = renderHook(() =>
      useProjectPlayback({ ...ready, status: 'unavailable' }, 0),
    );
    act(() => result.current.resetPlayback());
    expect(result.current.frame).toBeNull();
  });
  it('unmount_cancels_clock', () => {
    const { result, unmount } = renderHook(() => useProjectPlayback(ready, 0));
    act(() => result.current.toggle());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('throttled_clock_uses_elapsed_time', () => {
    const { result } = renderHook(() => useProjectPlayback(ready, 0));
    act(() => result.current.toggle());
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 1000);
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.frame).toBe(25);
  });
  it('resetPlayback_preserves_selection_job_settings_urls_and_requests', () => {
    const project = {
      clips: ['clip-a'],
      overlays: ['logo', 'pip'],
      music: 'music.wav',
      job: { id: 'completed-job', status: 'completed' },
      selection: { kind: 'clip', id: 'clip-a' },
      settings: { fps: 25, musicVolume: 0.3 },
      urls: ['blob:clip', 'blob:pip'],
      request: 'poll-in-flight',
      revision: 7,
    };
    const snapshot = structuredClone(project);
    const { result } = renderHook(() => {
      const [state] = useState(project);
      return {
        project: state,
        playback: useProjectPlayback(ready, state.revision),
      };
    });
    act(() => result.current.playback.seek(30));
    act(() => result.current.playback.toggle());
    act(() => result.current.playback.resetPlayback());
    expect(result.current.playback.frame).toBe(0);
    expect(result.current.playback.playing).toBe(false);
    expect(result.current.project).toBe(project);
    expect(result.current.project).toEqual(snapshot);
  });
});
