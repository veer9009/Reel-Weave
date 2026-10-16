import { useEffect, useLayoutEffect, useState } from 'react';
import type { TimelineProjection } from '../lib/timeline';
import type { AdvancedTimelineProjection } from '../lib/advancedTimeline';
import { resolveProgramFrame } from '../lib/advancedTimeline';
import { mapTransportAnchor } from '../lib/transportMapping';
import type { TransportAnchor, TransportEdit } from '../lib/transportMapping';
export type PlaybackStatus = 'paused' | 'playing' | 'preparing' | 'failed';
export function useProjectPlayback(
  timeline: TimelineProjection,
  structuralRevision: number,
  projection?: AdvancedTimelineProjection,
) {
  const [, render] = useState(0);
  const [api] = useState(() => {
    const runtime = {
      timeline,
      projection,
      revision: structuralRevision,
      position: 0,
      started: performance.now(),
      intent: false,
      status: 'paused' as PlaybackStatus,
      pending: null as number | null,
      generation: 0,
      positionRevision: 0,
    };
    const readiness = new Set<number>();
    const available = () => {
      const t = runtime.timeline;
      return t.status === 'ready' && t.totalFrames > 0 && t.fps !== null;
    };
    const live = () => {
      const r = runtime;
      return (
        r.position +
        (r.status === 'playing'
          ? (Math.max(0, performance.now() - r.started) *
              (r.timeline.fps ?? 0)) /
            1000
          : 0)
      );
    };
    const settle = () => {
      const r = runtime;
      r.position = live();
      r.started = performance.now();
    };
    const publish = () => render((n) => n + 1);
    const clamp = () => {
      const r = runtime,
        n = r.timeline.totalFrames;
      if (!available()) {
        r.position = 0;
        r.intent = false;
        r.status = 'paused';
        r.pending = null;
      } else if (r.position >= n - 1) {
        r.position = n - 1;
        r.intent = false;
        r.status = 'paused';
        r.pending = null;
      } else r.position = Math.max(0, r.position);
    };
    const controller = {
      getSnapshot: () => runtime,
      captureAnchor(): TransportAnchor {
        const r = runtime,
          position = available()
            ? Math.min(live(), r.timeline.totalFrames - 1)
            : 0;
        const current = r.projection
            ? resolveProgramFrame(r.projection, position)
            : null,
          item = r.timeline.items.find(
            (v) => position >= v.startFrame && position <= v.endFrame,
          );
        const resolved = r.projection?.resolved.find(
          (v) => position >= v.startFrame && position < v.endFrameExclusive,
        );
        return {
          frame: Math.floor(position),
          projectSeconds: position / (r.timeline.fps ?? 1),
          playingIntent: r.intent,
          occurrenceId: current?.clip.id ?? item?.clip.id ?? null,
          sourceId: resolved?.sourceId ?? null,
          sourceTime:
            current?.sourceTime ??
            (item && r.timeline.fps
              ? item.clip.trim.startFrame / item.clip.metadata.fps +
                ((position -
                  item.startFrame +
                  (item.clip.outputWindow?.outputInFrame ?? 0)) /
                  r.timeline.fps) *
                  item.clip.speed
              : null),
        };
      },
      applyEdit(edit: TransportEdit, anchor?: TransportAnchor) {
        const captured = anchor ?? controller.captureAnchor(),
          mapped = mapTransportAnchor(captured, edit),
          r = runtime;
        const next =
          mapped.frame === null
            ? null
            : resolveProgramFrame(edit.after, mapped.frame);
        if (
          next &&
          captured.sourceTime !== null &&
          Math.abs(next.sourceTime - captured.sourceTime) >
            (1 / (edit.after.base.fps ?? 25)) * next.clip.speed
        )
          r.positionRevision++;
        r.timeline = edit.after.base;
        r.projection = edit.after;
        r.position = mapped.frame ?? 0;
        r.started = performance.now();
        r.intent = mapped.playingIntent;
        r.status = r.intent ? 'playing' : 'paused';
        r.pending = null;
        r.generation++;
        publish();
      },
      update(
        next: TimelineProjection,
        revision: number,
        p?: AdvancedTimelineProjection,
      ) {
        const r = runtime;
        const changed =
          r.revision !== revision ||
          r.timeline.fps !== next.fps ||
          r.timeline.totalFrames !== next.totalFrames ||
          r.timeline.status !== next.status;
        if (changed) {
          settle();
          const oldFps = r.timeline.fps;
          r.timeline = next;
          if (oldFps && next.fps && oldFps !== next.fps)
            r.position = Math.floor((r.position / oldFps) * next.fps + 0.5);
          clamp();
          r.revision = revision;
        }
        r.timeline = next;
        r.projection = p;
        if (changed) publish();
      },
      tick() {
        const r = runtime;
        if (r.status !== 'playing') return;
        settle();
        clamp();
        publish();
      },
      observePicture(seconds: number, presentedAt: number) {
        const r = runtime;
        if (
          !r.intent ||
          r.status !== 'playing' ||
          !Number.isFinite(seconds) ||
          !Number.isFinite(presentedAt) ||
          seconds < 0
        )
          return;
        r.position = seconds * (r.timeline.fps ?? 0);
        r.started = presentedAt;
        clamp();
        if (r.status !== 'playing') publish();
      },
      seek(frame: number) {
        if (!available() || !Number.isFinite(frame)) return;
        const r = runtime;
        r.position = Math.max(
          0,
          Math.min(r.timeline.totalFrames - 1, Math.floor(frame)),
        );
        r.started = performance.now();
        r.intent = false;
        r.status = 'paused';
        r.pending = null;
        r.generation++;
        r.positionRevision++;
        publish();
      },
      toggle() {
        if (!available()) return;
        const r = runtime;
        if (r.intent) {
          controller.pause();
          return;
        }
        if (r.position >= r.timeline.totalFrames - 1) {
          r.position = 0;
          r.positionRevision++;
        }
        r.intent = true;
        r.status = 'playing';
        r.started = performance.now();
        r.generation++;
        publish();
      },
      pause() {
        settle();
        const r = runtime;
        clamp();
        r.intent = false;
        r.status = 'paused';
        r.pending = null;
        r.generation++;
        publish();
      },
      resetPlayback() {
        controller.pause();
        runtime.position = 0;
        runtime.positionRevision++;
        publish();
      },
      suspend(token: number) {
        const r = runtime;
        if (!r.intent) return;
        if (r.pending === null) readiness.clear();
        if (readiness.has(token)) return;
        readiness.add(token);
        settle();
        r.pending = token;
        r.status = 'preparing';
        publish();
      },
      ready(token: number) {
        const r = runtime;
        if (r.pending === null || !readiness.has(token) || !r.intent) return;
        readiness.delete(token);
        if (readiness.size) return;
        r.pending = null;
        r.status = 'playing';
        r.started = performance.now();
        publish();
      },
      fail(token?: number) {
        const r = runtime;
        if (token !== undefined && r.pending !== null && r.pending !== token)
          return;
        settle();
        r.intent = false;
        r.status = 'failed';
        r.pending = null;
        r.generation++;
        publish();
      },
    };
    return controller;
  });
  useLayoutEffect(
    () => api.update(timeline, structuralRevision, projection),
    [api, timeline, structuralRevision, projection],
  );
  const r = api.getSnapshot(),
    playing = r.status === 'playing' && r.intent;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(api.tick, 20);
    return () => window.clearInterval(timer);
  }, [api, playing]);
  return {
    ...api,
    frame:
      r.timeline.status === 'ready' &&
      r.timeline.fps &&
      r.timeline.totalFrames > 0
        ? Math.min(r.timeline.totalFrames - 1, Math.floor(r.position))
        : null,
    playing,
    playingIntent: r.intent,
    status: r.status,
    generation: r.generation,
    positionRevision: r.positionRevision,
  };
}
export type ProjectPlayback = ReturnType<typeof useProjectPlayback>;
