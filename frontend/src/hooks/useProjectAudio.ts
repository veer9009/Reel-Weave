import { useEffect, useLayoutEffect, useState } from 'react';
import type { EditSnapshot } from '../lib/editHistory';
import type { ProjectSources } from '../lib/projectSources';
import type { AdvancedTimelineProjection } from '../lib/advancedTimeline';
import { resolveAudioOwnership } from '../lib/audioTimeline';
import type { AudioRecipe } from '../lib/audioTimeline';
import type { ProjectPlayback } from './useProjectPlayback';
type Status =
  'ready' | 'preparing' | 'resume-required' | 'unsupported' | 'failed';
type Options = {
  snapshot?: EditSnapshot;
  sources?: ProjectSources;
  projection?: AdvancedTimelineProjection;
  transport: ProjectPlayback;
};
type Target = { sourceId: string; time: number; speed: number; end: number };
type Voice = {
  element: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  sourceId: string | null;
  release: () => void;
  token: number;
  accepted: boolean;
  pending: boolean;
  ended: number | null;
  positionRevision: number | undefined;
};
export function useProjectAudio(options: Options) {
  const [, render] = useState(0);
  const [api] = useState(() => {
    let latest = options;
    let context: AudioContext | null = null,
      buses: GainNode[] = [];
    const pools: (Voice | null)[][] = [
        [null, null],
        [null, null],
      ],
      active = [0, 0];
    let status: Status = 'ready',
      message: string | null = null,
      serial = 0,
      gate: number | null = null,
      generation = -1,
      disposed = false,
      session = 0,
      graphReady = false,
      graphFrame: number | null = null;
    const publish = (next: Status, text: string | null = null) => {
      if (status === next && message === text) return;
      status = next;
      message = text;
      if (!disposed) render((n) => n + 1);
    };
    const currentTargets = (): [Target | null, Target | null] => {
      const o = latest,
        s = o.snapshot,
        p = o.projection,
        fps = p?.base.fps,
        frame = o.transport.frame;
      if (!s || !p || !fps || frame === null || frame >= p.base.totalFrames)
        return [null, null];
      const seconds = o.transport.captureAnchor().projectSeconds;
      const recipeTarget = (
        recipe: AudioRecipe,
        offset: number,
      ): Target | null => {
        const source = o.sources?.get(recipe.sourceId);
        if (!source) return null;
        if (recipe.kind === 'audio-file')
          return {
            sourceId: recipe.sourceId,
            time: offset,
            end: (source.sampleCount ?? 0) / 48000,
            speed: 1,
          };
        if (!source.metadata) return null;
        return {
          sourceId: recipe.sourceId,
          time:
            recipe.sourceStartFrame / source.metadata.fps +
            offset * recipe.speed,
          end: (recipe.sourceEndFrame + 1) / source.metadata.fps,
          speed: recipe.speed,
        };
      };
      const range = resolveAudioOwnership(s, p).find(
        (v) => frame >= v.startFrame && frame < v.endFrameExclusive,
      );
      let original =
        range?.source && !s.audio.originalMuted && s.audio.originalVolume > 0
          ? recipeTarget(
              range.source,
              range.sourceStartSample / 48000 +
                seconds -
                range.startFrame / fps,
            )
          : null;
      const segment = s.music.find(
        (v) =>
          frame >= v.timelineStartFrame &&
          frame < v.timelineStartFrame + v.durationFrames,
      );
      let music =
        segment && !s.audio.musicMuted && s.audio.musicVolume > 0
          ? recipeTarget(
              { kind: 'audio-file', sourceId: segment.sourceId },
              segment.sourceStartSample / 48000 +
                seconds -
                segment.timelineStartFrame / fps,
            )
          : null;
      if (original && original.time >= original.end) original = null;
      if (music && music.time >= music.end) music = null;
      return [original, music];
    };
    const release = (voice: Voice) => {
      voice.token = ++serial;
      voice.element.pause();
      voice.element.removeAttribute('src');
      voice.element.load();
      voice.release();
      voice.release = () => {};
      voice.sourceId = null;
      voice.accepted = false;
      voice.pending = false;
      voice.ended = null;
    };
    const block = (next: Status, text: string) => {
      publish(next, text);
      latest.transport.pause();
    };
    const ensureGate = () => {
      if (gate === null) gate = -++serial;
      latest.transport.suspend(gate);
      publish('preparing');
    };
    const allReady = () => {
      const o = latest;
      if (
        !context ||
        context.state !== 'running' ||
        !graphReady ||
        !o.transport.playingIntent
      )
        return;
      const targets = currentTargets();
      if (
        targets.some((target, bus) => {
          if (!target) return false;
          const voice = pools[bus][active[bus]];
          return (
            !voice ||
            voice.sourceId !== target.sourceId ||
            !voice.accepted ||
            voice.element.readyState < 2 ||
            voice.element.seeking
          );
        })
      )
        return;
      publish('ready');
      if (gate !== null) {
        const token = gate;
        gate = null;
        o.transport.ready(token);
      }
    };
    const play = (voice: Voice) => {
      const o = latest;
      if (
        voice.pending ||
        !voice.sourceId ||
        !o.transport.playingIntent ||
        !context ||
        context.state !== 'running' ||
        voice.element.readyState < 2 ||
        voice.element.seeking
      )
        return;
      const target = currentTargets().find(
        (v) => v?.sourceId === voice.sourceId,
      );
      if (voice.ended !== null && target && target.time >= voice.ended - 0.001)
        return;
      if (voice.accepted && !voice.element.paused) return;
      const token = voice.token,
        epoch = session,
        ownerGeneration = o.transport.generation;
      voice.pending = true;
      void voice.element
        .play()
        .then(() => {
          if (disposed || epoch !== session || voice.token !== token) return;
          voice.pending = false;
          if (!latest.transport.playingIntent) {
            voice.element.pause();
            return;
          }
          if (latest.transport.generation !== ownerGeneration) {
            const bus = pools.findIndex((pool) => pool.includes(voice)),
              target = currentTargets()[bus];
            if (target?.sourceId !== voice.sourceId) {
              voice.element.pause();
              return;
            }
            if (
              !voice.element.paused &&
              voice.element.readyState >= 2 &&
              !voice.element.seeking
            )
              voice.accepted = true;
            sync();
            return;
          }
          voice.accepted = true;
          if (!latest.transport.playing && graphReady) {
            voice.element.pause();
            const bus = pools.findIndex((pool) => pool.includes(voice)),
              target = currentTargets()[bus];
            if (target && target.sourceId === voice.sourceId)
              syncVoice(voice, target);
          }
          allReady();
        })
        .catch((error) => {
          if (
            disposed ||
            epoch !== session ||
            voice.token !== token ||
            !latest.transport.playingIntent
          )
            return;
          voice.pending = false;
          voice.accepted = false;
          block(
            error instanceof DOMException && error.name === 'NotAllowedError'
              ? 'resume-required'
              : 'failed',
            `Sound preview cannot play ${latest.sources?.get(voice.sourceId ?? '')?.file.name ?? 'this source'}. Use Resume Audio or check browser decoding.`,
          );
        });
    };
    const voiceFor = (bus: number, index: number): Voice => {
      const old = pools[bus][index];
      if (old) return old;
      const element = document.createElement('audio');
      element.preload = 'auto';
      element.loop = false;
      element.preservesPitch = true;
      const node = context!.createMediaElementSource(element);
      node.connect(buses[bus]);
      const voice: Voice = {
        element,
        node,
        sourceId: null,
        release: () => {},
        token: 0,
        accepted: false,
        pending: false,
        ended: null,
        positionRevision: undefined,
      };
      pools[bus][index] = voice;
      const ready = () => {
        const target = currentTargets()[bus];
        if (
          pools[bus][active[bus]] !== voice ||
          !target ||
          voice.sourceId !== target.sourceId
        )
          return;
        syncVoice(voice, target);
        if (latest.transport.playing || !voice.accepted) play(voice);
        allReady();
      };
      element.addEventListener('loadedmetadata', ready);
      element.addEventListener('loadeddata', ready);
      element.addEventListener('canplay', ready);
      element.addEventListener('seeked', ready);
      element.addEventListener('waiting', () => {
        if (pools[bus][active[bus]] === voice && latest.transport.playingIntent)
          ensureGate();
      });
      element.addEventListener('ended', () => {
        voice.ended = element.currentTime;
        voice.accepted = true;
        element.pause();
        allReady();
      });
      element.addEventListener('error', () => {
        if (!voice.sourceId || pools[bus][active[bus]] !== voice) return;
        voice.accepted = false;
        block(
          element.error?.code === 4 ? 'unsupported' : 'failed',
          `Sound preview cannot fully audition ${latest.sources?.get(voice.sourceId)?.file.name ?? 'this source'}. A valid project can still be rendered.`,
        );
      });
      return voice;
    };
    const syncVoice = (voice: Voice, target: Target) => {
      const e = voice.element;
      e.playbackRate = target.speed;
      e.preservesPitch = true;
      if (!graphReady && (voice.pending || voice.accepted)) return;
      if (!Number.isFinite(e.duration)) return;
      // Continuous edits preserve the decoder's native clock. Repeated seeks to
      // the rendered transport position introduce buffering and interrupt sound.
      // Explicit seeks and discontinuous source mappings advance this revision.
      const revision = latest.transport.positionRevision;
      if (voice.accepted && !e.paused && voice.positionRevision === revision)
        return;
      voice.positionRevision = revision;
      if (target.time >= Math.min(e.duration, target.end)) {
        voice.ended = e.currentTime;
        e.pause();
        voice.accepted = true;
        return;
      }
      if (voice.ended !== null && target.time >= voice.ended - 0.001) return;
      voice.ended = null;
      const threshold = 0.04 * target.speed;
      if (Math.abs(e.currentTime - target.time) > threshold)
        e.currentTime = Math.max(0, target.time);
    };
    const sync = () => {
      const o = latest,
        s = o.snapshot;
      if (!s || !o.sources || !o.projection || !context) return;
      buses[0].gain.value =
        s.audio.originalMuted || !o.transport.playing || !graphReady
          ? 0
          : s.audio.originalVolume;
      buses[1].gain.value =
        s.audio.musicMuted || !o.transport.playing || !graphReady
          ? 0
          : s.audio.musicVolume;
      if (generation !== o.transport.generation) {
        generation = o.transport.generation;
        gate = null;
      }
      const targets = currentTargets();
      if (!o.transport.playingIntent) {
        for (const bus of [0, 1])
          for (const voice of pools[bus])
            if (voice) {
              if (voice.sourceId && voice.sourceId !== targets[bus]?.sourceId)
                release(voice);
              else {
                voice.element.pause();
                voice.accepted = false;
              }
            }
        return;
      }
      if (context.state !== 'running') {
        ensureGate();
        return;
      }
      if (!graphReady) ensureGate();
      for (const bus of [0, 1]) {
        const target = targets[bus];
        if (!target) {
          for (const voice of pools[bus]) if (voice?.sourceId) release(voice);
          continue;
        }
        let voice = pools[bus][active[bus]];
        if (voice?.sourceId !== target.sourceId) {
          if (voice?.sourceId) release(voice);
          active[bus] = 1 - active[bus];
          voice = voiceFor(bus, active[bus]);
          if (voice.sourceId) release(voice);
          voice.sourceId = target.sourceId;
          voice.token = ++serial;
          voice.accepted = false;
          voice.release = o.sources.acquireLease(
            `preview-sound-${bus}-${active[bus]}`,
            new Set([target.sourceId]),
          );
          voice.element.src = o.sources.ensureUrl(target.sourceId);
          ensureGate();
        }
        syncVoice(voice!, target);
        if (
          !voice!.accepted ||
          voice!.element.readyState < 2 ||
          voice!.element.seeking
        )
          ensureGate();
        if (o.transport.playing || !voice!.accepted) play(voice!);
        else if (graphReady) voice!.element.pause();
      }
      allReady();
    };
    return {
      updateOptions(next: Options) {
        latest = next;
      },
      get status() {
        return status;
      },
      get message() {
        return message;
      },
      sync,
      async resumeAudio() {
        if (!latest.snapshot || !latest.sources) return false;
        disposed = false;
        const epoch = session;
        let resumedContext: AudioContext | null = null;
        try {
          if (!context) {
            if (typeof AudioContext === 'undefined') {
              block(
                'unsupported',
                'This browser cannot fully audition sound. A valid project can still be rendered.',
              );
              return false;
            }
            context = new AudioContext();
            buses = [context.createGain(), context.createGain()];
            for (const bus of buses) bus.connect(context.destination);
          }
          const ctx = context;
          resumedContext = ctx;
          await ctx.resume();
          if (context !== ctx || session !== epoch || disposed) return false;
          const checkGraph = () => {
            graphFrame = null;
            if (context !== ctx || session !== epoch || disposed) return;
            if (ctx.state === 'running' && ctx.currentTime > 0) {
              graphReady = true;
              publish('ready');
              sync();
            } else {
              graphReady = false;
              sync();
              graphFrame = requestAnimationFrame(checkGraph);
            }
          };
          if (graphFrame !== null) cancelAnimationFrame(graphFrame);
          checkGraph();
          sync();
          return true;
        } catch {
          if (
            session !== epoch ||
            disposed ||
            (resumedContext && context !== resumedContext)
          )
            return false;
          block(
            'resume-required',
            'Audio needs a user action. Choose Resume Audio to audition the complete mix.',
          );
          return false;
        }
      },
      stop() {
        session++;
        gate = null;
        graphReady = false;
        if (graphFrame !== null) cancelAnimationFrame(graphFrame);
        graphFrame = null;
        for (const pool of pools)
          for (const voice of pool)
            if (voice) {
              release(voice);
              voice.node.disconnect();
            }
        pools[0] = [null, null];
        pools[1] = [null, null];
        for (const bus of buses) bus.disconnect();
        buses = [];
        const old = context;
        context = null;
        if (old && old.state !== 'closed') void old.close().catch(() => {});
        publish('ready');
      },
      dispose() {
        disposed = true;
        this.stop();
      },
      activate() {
        disposed = false;
      },
    };
  });
  useLayoutEffect(() => {
    api.updateOptions(options);
    api.sync();
  }, [api, options]);
  useEffect(() => {
    api.activate();
    const off = options.sources?.onBeforeClear(() => api.stop());
    return () => {
      off?.();
      api.dispose();
    };
  }, [api, options.sources]);
  return {
    status: api.status,
    message: api.message,
    resumeAudio: api.resumeAudio,
    stop: () => api.stop(),
  };
}
