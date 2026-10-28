import { useEffect, useLayoutEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { AdvancedTimelineProjection } from '../lib/advancedTimeline';
import { resolveProgramFrame } from '../lib/advancedTimeline';
import type { ProjectSources } from '../lib/projectSources';
type Current = ReturnType<typeof resolveProgramFrame>;
type Slot = {
  url?: string;
  sourceId?: string;
  time: number;
  error: boolean;
  reported?: boolean;
  errorAt?: number;
};
type Options = {
  current: Current;
  projection?: AdvancedTimelineProjection;
  frame: number | null;
  projectSeconds?: number;
  playing: boolean;
  generation?: number;
  positionRevision?: number;
  sources?: ProjectSources;
  onSuspend?: (token: number) => void;
  onReady?: (token: number) => void;
  onHold?: (listener: (projectSeconds: number) => void) => () => void;
  onFailure?: (source: string) => void;
  onPresented?: (seconds: number, presentedAt: number) => void;
  onPictureClock?: (read: () => number | null) => () => void;
};
export function usePreviewMedia(options: Options) {
  const [, render] = useState(0);
  const [api] = useState(() => {
    let latest = options,
      previousPlaying = options.playing;
    let pausedTime: number | undefined;
    let holdRevision = 0;
    const elements: (HTMLVideoElement | null)[] = [null, null],
      slots: Slot[] = [
        {
          url: options.current?.clip.url,
          time: options.current?.sourceTime ?? 0,
          error: false,
        },
        { time: 0, error: false },
      ],
      releases: (() => void)[] = [() => {}, () => {}];
    let active = 0,
      serial = 0,
      disposed = false;
    const observationTokens = [0, 0],
      videoCallbacks: (number | null)[] = [null, null],
      animationCallbacks: (number | null)[] = [null, null];
    const cancelObservation = (index: number) => {
      observationTokens[index]++;
      const element = elements[index];
      if (videoCallbacks[index] !== null)
        element?.cancelVideoFrameCallback?.(videoCallbacks[index]!);
      if (animationCallbacks[index] !== null)
        cancelAnimationFrame(animationCallbacks[index]!);
      videoCallbacks[index] = null;
      animationCallbacks[index] = null;
    };
    const observe = (index: number, element: HTMLVideoElement) => {
      cancelObservation(index);
      if (!latest.onPresented) return;
      const token = observationTokens[index];
      const report = (mediaTime: number, at: number) => {
        const o = latest;
        if (
          index !== active ||
          !o.current ||
          !o.playing ||
          element.seeking ||
          element.paused ||
          element.getAttribute('src') !== o.current.clip.url
        )
          return;
        const fps = o.projection?.base.fps;
        const seconds =
          o.projectSeconds ?? (fps && o.frame !== null ? o.frame / fps : 0);
        o.onPresented?.(
          seconds + (mediaTime - o.current.sourceTime) / o.current.clip.speed,
          at,
        );
      };
      const schedule = () => {
        if (disposed || token !== observationTokens[index]) return;
        if (typeof element.requestVideoFrameCallback === 'function')
          videoCallbacks[index] = element.requestVideoFrameCallback(
            (_now, metadata) => {
              if (disposed || token !== observationTokens[index]) return;
              videoCallbacks[index] = null;
              report(metadata.mediaTime, metadata.expectedDisplayTime);
              schedule();
            },
          );
        else
          animationCallbacks[index] = requestAnimationFrame((now) => {
            if (disposed || token !== observationTokens[index]) return;
            animationCallbacks[index] = null;
            if (element.readyState >= 2) report(element.currentTime, now);
            schedule();
          });
      };
      schedule();
    };
    let request: {
      index: number;
      token: number;
      generation: number | undefined;
      positionRevision: number | undefined;
      needsPosition: boolean;
      time: number;
      waiting: boolean;
      origin: number;
      speed: number;
      clip: NonNullable<Current>['clip'];
    } | null = null;
    const publish = () => {
      if (!disposed) render((v) => v + 1);
    };
    const failure = (index: number) => {
      slots[index].error = true;
      slots[index].errorAt = latest.current?.sourceTime;
      if (slots[index].reported) return;
      slots[index].reported = true;
      latest.onFailure?.(latest.current?.clip.file.name ?? 'picture source');
    };
    const stopElement = (index: number) => {
      cancelObservation(index);
      const e = elements[index];
      if (e) {
        e.pause();
        e.removeAttribute('src');
        e.load();
      }
      releases[index]();
      releases[index] = () => {};
    };
    const sourceId = (current: NonNullable<Current>) =>
      latest.projection?.resolved.find(
        (v) => v.occurrenceId === current.clip.id,
      )?.sourceId;
    const assign = (index: number, current: NonNullable<Current>) => {
      const id = sourceId(current),
        slot = slots[index];
      if (slot.url === current.clip.url) {
        slot.time = current.sourceTime;
        if (id && !slot.sourceId) {
          slot.sourceId = id;
          releases[index] =
            latest.sources?.acquireLease(
              `preview-picture-${index}`,
              new Set([id]),
            ) ?? (() => {});
        }
        return false;
      }
      stopElement(index);
      slots[index] = {
        url: current.clip.url,
        sourceId: id,
        time: current.sourceTime,
        error: false,
      };
      releases[index] = id
        ? (latest.sources?.acquireLease(
            `preview-picture-${index}`,
            new Set([id]),
          ) ?? (() => {}))
        : () => {};
      if (elements[index]) observe(index, elements[index]!);
      publish();
      return true;
    };
    const position = (index: number, time: number) => {
      const e = elements[index];
      if (
        !e ||
        e.getAttribute('src') !== slots[index].url ||
        !Number.isFinite(e.duration)
      )
        return false;
      if (time >= e.duration) {
        slots[index].error = true;
        return false;
      }
      e.playbackRate =
        index === request?.index
          ? (latest.current?.clip.speed ?? 1)
          : e.playbackRate;
      if (Math.abs(e.currentTime - time) > 0.001)
        e.currentTime = Math.max(0, time);
      return true;
    };
    const warm = () => {
      const o = latest;
      if (
        !o.projection ||
        o.frame === null ||
        !o.current ||
        request?.index !== active ||
        slots[active].url !== o.current.clip.url
      )
        return;
      const next = o.projection.resolved.find(
        (v) =>
          v.startFrame > o.frame! &&
          resolveProgramFrame(o.projection!, v.startFrame)?.clip.url !==
            o.current!.clip.url,
      );
      if (!next) {
        const index = 1 - active;
        if (slots[index].url) {
          stopElement(index);
          slots[index] = { time: 0, error: false };
          publish();
        }
        return;
      }
      const current = resolveProgramFrame(o.projection, next.startFrame);
      if (!current) return;
      const index = 1 - active;
      if (assign(index, current)) return;
      const e = elements[index];
      if (e && e.readyState >= 1) {
        e.playbackRate = current.clip.speed;
        position(index, current.sourceTime);
      }
    };
    const complete = (index: number) => {
      const o = latest,
        e = elements[index],
        r = request;
      if (
        !r ||
        r.index !== index ||
        r.generation !== o.generation ||
        slots[index].url !== o.current?.clip.url ||
        !e ||
        e.readyState < 2 ||
        e.seeking ||
        e.getAttribute('src') !== slots[index].url
      )
        return;
      if (active !== index) {
        elements[active]?.pause();
        active = index;
        publish();
      }
      if (r.waiting) {
        r.waiting = false;
        o.onReady?.(r.token);
      }
      warm();
    };
    const sync = () => {
      const o = latest,
        current = o.current;
      const resumed = !previousPlaying && o.playing;
      previousPlaying = o.playing;
      if (!current) {
        elements.forEach((e) => e?.pause());
        request = null;
        return;
      }
      let index = slots.findIndex((s) => s.url === current.clip.url);
      if (index < 0) {
        index = 1 - active;
        assign(index, current);
      } else assign(index, current);
      const seconds =
        o.projectSeconds ?? (o.frame ?? 0) / (o.projection?.base.fps ?? 25);
      const origin = current.sourceTime - seconds * current.clip.speed;
      const adjacentLegacyEdit =
        request &&
        !request.clip.outputWindow &&
        !current.clip.outputWindow &&
        request.clip.metadata.fps === current.clip.metadata.fps &&
        current.clip.trim.startFrame === request.clip.trim.endFrame + 1;
      const mappingTolerance =
        o.generation === undefined || adjacentLegacyEdit
          ? current.clip.speed / (o.projection?.base.fps ?? 25)
          : 0.000001;
      const mappingChanged =
        request &&
        request.generation === o.generation &&
        (request.speed !== current.clip.speed ||
          Math.abs(request.origin - origin) > mappingTolerance);
      const sourceChanged = !request || request.index !== index,
        positionChanged =
          !request ||
          mappingChanged ||
          request.positionRevision !== o.positionRevision ||
          (!o.onSuspend && !o.playing && request.time !== current.sourceTime);
      const fresh =
        sourceChanged ||
        positionChanged ||
        request!.generation !== o.generation;
      const retired = fresh && request?.waiting ? request.token : null;
      if (fresh) {
        request = {
          index,
          token: ++serial,
          generation: o.generation,
          positionRevision: o.positionRevision,
          needsPosition:
            sourceChanged || positionChanged || Boolean(request?.needsPosition),
          time: current.sourceTime,
          waiting: false,
          origin,
          speed: current.clip.speed,
          clip: current.clip,
        };
        if (elements[index]) observe(index, elements[index]!);
      }
      request!.origin = origin;
      request!.clip = current.clip;
      if (!o.playing) pausedTime = current.sourceTime;
      const positionTime =
        resumed && !fresh && pausedTime !== undefined
          ? pausedTime
          : current.sourceTime;
      const e = elements[index];
      if (
        slots[index].error &&
        current.sourceTime < (slots[index].errorAt ?? 0)
      ) {
        slots[index].error = false;
        slots[index].reported = false;
      }
      if (slots[index].error) {
        failure(index);
        return;
      }
      if (!o.onSuspend) {
        if (active !== index) {
          elements[active]?.pause();
          active = index;
          publish();
        }
      }
      if (
        e &&
        e.getAttribute('src') === slots[index].url &&
        Number.isFinite(e.duration)
      ) {
        if (current.sourceTime >= e.duration) {
          failure(index);
          return;
        }
        e.playbackRate = current.clip.speed;
        if (
          resumed &&
          o.onSuspend &&
          Math.abs(e.currentTime - positionTime) > 0.04 * current.clip.speed
        )
          request!.needsPosition = true;
        if (request!.needsPosition) {
          position(index, positionTime);
          request!.needsPosition = false;
        }
      }
      const needsReady = !e || e.readyState < 2 || e.seeking;
      if (
        (o.playing || retired !== null) &&
        needsReady &&
        o.onSuspend &&
        !request!.waiting
      ) {
        request!.waiting = true;
        elements[active]?.pause();
        o.onSuspend(request!.token);
      }
      if (retired !== null) o.onReady?.(retired);
      if (!needsReady) complete(index);
      if (active === index && e) {
        if (o.playing && !needsReady) {
          if (e.paused) {
            const token = request!.token,
              url = slots[index].url,
              startedAtHold = holdRevision;
            void e.play().catch((error: unknown) => {
              if (
                error instanceof DOMException &&
                error.name === 'AbortError' &&
                startedAtHold !== holdRevision
              )
                return;
              if (
                latest.playing &&
                request?.token === token &&
                slots[index].url === url
              )
                failure(index);
            });
          }
        } else if (!o.playing && e.paused === false) e.pause();
      }
      warm();
    };
    const readyEvent = (
      index: number,
      event: SyntheticEvent<HTMLVideoElement>,
    ) => {
      if (
        event.currentTarget !== elements[index] ||
        event.currentTarget.getAttribute('src') !== slots[index].url
      )
        return;
      const current = latest.current;
      if (
        request?.index === index &&
        current &&
        request.generation === latest.generation
      ) {
        event.currentTarget.playbackRate = current.clip.speed;
        if (request.needsPosition && position(index, current.sourceTime))
          request.needsPosition = false;
        complete(index);
      } else position(index, slots[index].time);
    };
    const events = [0, 1].map((index) => ({
      onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) =>
        readyEvent(index, e),
      onLoadedData: (e: SyntheticEvent<HTMLVideoElement>) =>
        readyEvent(index, e),
      onCanPlay: (e: SyntheticEvent<HTMLVideoElement>) => readyEvent(index, e),
      onSeeked: (e: SyntheticEvent<HTMLVideoElement>) => readyEvent(index, e),
      onWaiting: () => {
        const o = latest;
        // The transport checks live intent; a render can still say preparing
        // when a native decoder starts waiting again.
        if (index === active && request && !request.waiting) {
          request.waiting = true;
          o.onSuspend?.(request.token);
        }
      },
      onError: () => {
        slots[index].error = true;
        if (request?.index === index) failure(index);
      },
      onEnded: () => {
        if (request?.index === index) failure(index);
      },
    }));
    return {
      updateOptions(next: Options) {
        latest = next;
      },
      readProjectSeconds() {
        const element = elements[active];
        if (
          !element ||
          !request ||
          request.index !== active ||
          !latest.current ||
          element.getAttribute('src') !== latest.current.clip.url ||
          element.seeking ||
          element.readyState < 2
        )
          return null;
        return (element.currentTime - request.origin) / request.speed;
      },
      hold(projectSeconds: number) {
        holdRevision++;
        const current = latest.current;
        if (current) {
          const seconds =
            latest.projectSeconds ??
            (latest.frame ?? 0) / (latest.projection?.base.fps ?? 25);
          pausedTime =
            current.sourceTime +
            (projectSeconds - seconds) * current.clip.speed;
        }
        previousPlaying = false;
        elements[active]?.pause();
      },
      get slots() {
        return slots;
      },
      get active() {
        return active;
      },
      get element() {
        return elements[active];
      },
      events,
      bind: [0, 1].map((index) => (element: HTMLVideoElement | null) => {
        if (element) {
          elements[index] = element;
          observe(index, element);
        } else cancelObservation(index);
      }),
      sync,
      stop() {
        request = null;
        serial++;
        for (const index of [0, 1]) {
          stopElement(index);
          slots[index] = { time: 0, error: false };
        }
        publish();
      },
      dispose() {
        disposed = true;
        request = null;
        for (const index of [0, 1]) stopElement(index);
      },
      resume() {
        disposed = false;
      },
    };
  });
  useLayoutEffect(() => {
    api.updateOptions(options);
    api.sync();
  }, [api, options]);
  const onHold = options.onHold;
  useLayoutEffect(() => onHold?.(api.hold), [api, onHold]);
  const onPictureClock = options.onPictureClock;
  useLayoutEffect(
    () => onPictureClock?.(api.readProjectSeconds),
    [api, onPictureClock],
  );
  useEffect(() => {
    api.resume();
    const off = options.sources?.onBeforeClear(api.stop);
    return () => {
      off?.();
      api.dispose();
    };
  }, [api, options.sources]);
  return {
    slots: api.slots,
    active: api.active,
    element: api.element,
    events: api.events,
    bind: api.bind,
  };
}
