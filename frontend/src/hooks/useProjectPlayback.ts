import { useEffect, useState } from 'react';
import type { TimelineProjection } from '../lib/timeline';

export function useProjectPlayback(
  timeline: TimelineProjection,
  structuralRevision: number,
) {
  const available =
    timeline.status === 'ready' &&
    timeline.totalFrames > 0 &&
    timeline.fps !== null;
  const [state, setState] = useState({
    frame: 0,
    playing: false,
    revision: structuralRevision,
    fps: timeline.fps,
    total: timeline.totalFrames,
    status: timeline.status,
  });
  if (
    state.revision !== structuralRevision ||
    state.fps !== timeline.fps ||
    state.total !== timeline.totalFrames ||
    state.status !== timeline.status
  ) {
    setState({
      ...state,
      playing: false,
      frame: available ? Math.min(state.frame, timeline.totalFrames - 1) : 0,
      revision: structuralRevision,
      fps: timeline.fps,
      total: timeline.totalFrames,
      status: timeline.status,
    });
  }
  useEffect(() => {
    if (!state.playing || !available || timeline.fps === null) return;
    const started = Date.now();
    const initial = state.frame;
    const fps = timeline.fps;
    const timer = window.setInterval(() => {
      const next = Math.min(
        timeline.totalFrames - 1,
        initial + Math.floor(((Date.now() - started) * fps) / 1000),
      );
      setState((current) => ({
        ...current,
        frame: next,
        playing: next < timeline.totalFrames - 1,
      }));
    }, 20);
    return () => window.clearInterval(timer);
    // Start a clock only when transport changes, not on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.playing,
    structuralRevision,
    available,
    timeline.fps,
    timeline.totalFrames,
  ]);
  return {
    frame: available ? Math.min(state.frame, timeline.totalFrames - 1) : null,
    playing: available && state.playing,
    seek(frame: number) {
      if (available)
        setState((current) => ({
          ...current,
          frame: Math.max(
            0,
            Math.min(timeline.totalFrames - 1, Math.floor(frame)),
          ),
          playing: false,
        }));
    },
    toggle() {
      if (available)
        setState((current) => ({
          ...current,
          frame: current.frame >= timeline.totalFrames - 1 ? 0 : current.frame,
          playing: !current.playing,
        }));
    },
    pause() {
      setState((current) => ({ ...current, playing: false }));
    },
    resetPlayback() {
      setState((current) => ({ ...current, frame: 0, playing: false }));
    },
  };
}
