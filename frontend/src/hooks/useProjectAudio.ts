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
type Target = {
  sourceId: string;
  time: number;
  speed: number;
  end: number;
  origin: number;
};
type Voice = {
  element: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  normalizer: StereoPannerNode;
  sourceId: string | null;
  release: () => void;
  token: number;
  accepted: boolean;
  pending: boolean;
  ended: number | null;
  positionRevision: number | undefined;
  mapping?: { origin: number; speed: number; generation: number };
  warming?: Target;
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
    let committedOptions = 0;
    let heldAtCommit: number | null = null;
    let stagingOutput = false;
    let outputStart: number | null = null;
    const outputTime = () => {
      const timestamp = context?.getOutputTimestamp?.();
      if (
        typeof timestamp?.contextTime !== 'number' ||
        !Number.isFinite(timestamp.contextTime) ||
        typeof timestamp.performanceTime !== 'number' ||
        !Number.isFinite(timestamp.performanceTime) ||
        timestamp.performanceTime <= 0
      )
        return null;
      return (
        timestamp.contextTime +
        (performance.now() - timestamp.performanceTime) / 1000
      );
    };
    const isPlaying = () => {
      const live = latest.transport.getSnapshot?.();
      return live
        ? live.intent && live.status === 'playing'
        : latest.transport.playing;
    };
    const applyGains = () => {
      const audio = latest.snapshot?.audio;
      const audible =
        audio &&
        graphReady &&
        (outputStart !== null || (gate === null && isPlaying()));
      if (buses.length === 2) {
        buses[0].gain.value =
          audible && !audio.originalMuted ? audio.originalVolume : 0;
        buses[1].gain.value =
          audible && !audio.musicMuted ? audio.musicVolume : 0;
      }
    };
    const publish = (next: Status, text: string | null = null) => {
      if (status === next && message === text) return;
      status = next;
      message = text;
      if (!disposed) render((n) => n + 1);
    };
    const currentTargets = (
      heldSeconds?: number,
    ): [Target | null, Target | null] => {
      const o = latest,
        s = o.snapshot,
        p = o.projection,
        fps = p?.base.fps;
      if (!s || !p || !fps || o.transport.frame === null) return [null, null];
      const seconds =
        heldSeconds ??
        o.transport.captureSoundSeconds?.() ??
        o.transport.captureAnchor().projectSeconds;
      // Ownership and source offsets must use the same live clock at cuts.
      const frame = seconds * fps;
      if (frame >= p.base.totalFrames) return [null, null];
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
            origin: offset - seconds,
          };
        if (!source.metadata) return null;
        return {
          sourceId: recipe.sourceId,
          time:
            recipe.sourceStartFrame / source.metadata.fps +
            offset * recipe.speed,
          end: (recipe.sourceEndFrame + 1) / source.metadata.fps,
          speed: recipe.speed,
          origin:
            recipe.sourceStartFrame / source.metadata.fps +
            (offset - seconds) * recipe.speed,
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
      voice.mapping = undefined;
      voice.warming = undefined;
    };
    const block = (next: Status, text: string) => {
      publish(next, text);
      latest.transport.pause();
    };
    const ensureGate = () => {
      stagingOutput = false;
      outputStart = null;
      if (gate === null) gate = -++serial;
      heldAtCommit = committedOptions;
      for (const bus of buses) bus.gain.value = 0;
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
            voice.pending ||
            voice.element.readyState < 2 ||
            voice.element.seeking
          );
        })
      )
        return;
      if (gate !== null) {
        if (
          targets.some(Boolean) &&
          typeof context.getOutputTimestamp === 'function' &&
          o.transport.isLastReadinessToken
        ) {
          if (!o.transport.isLastReadinessToken(gate)) return;
          // Flush muted preparation through the real output device before
          // releasing picture. No fixed delay or alternate playback clock.
          stagingOutput = true;
          for (const bus of [0, 1]) {
            const voice = pools[bus][active[bus]];
            if (targets[bus] && voice?.element.paused) play(voice);
          }
          if (
            targets.some(
              (target, bus) => target && pools[bus][active[bus]]?.pending,
            )
          )
            return;
          outputStart ??= context.currentTime;
          applyGains();
          const audible = outputTime();
          if (audible === null || audible < outputStart) return;
        }
        const token = gate;
        gate = null;
        stagingOutput = false;
        outputStart = null;
        o.transport.ready(token);
      }
      applyGains();
      publish('ready');
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
          const bus = pools.findIndex((pool) => pool.includes(voice)),
            target = currentTargets()[bus];
          if (
            gate !== null &&
            target &&
            Math.abs(voice.element.currentTime - target.time) >
              0.04 * target.speed
          ) {
            voice.element.pause();
            syncVoice(voice, target, true);
          }
          // Release our readiness token before deciding whether to stop the
          // decoder. If this was the final token, it is already the live voice;
          // pausing it here introduces another native startup gap at every cut.
          allReady();
          // A separate picture hold can still keep the shared clock frozen.
          if ((!isPlaying() || gate !== null) && graphReady && !stagingOutput) {
            voice.element.pause();
            const bus = pools.findIndex((pool) => pool.includes(voice)),
              target = currentTargets()[bus];
            if (target && target.sourceId === voice.sourceId)
              syncVoice(voice, target, true);
          }
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
          // An edit may retain this voice while replacing the transport
          // generation. A rejected trial belongs to its captured generation,
          // just like a successful trial; retry against the current mapping.
          if (latest.transport.generation !== ownerGeneration) {
            sync();
            return;
          }
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
      // Match the renderer's equal-power mono-to-stereo normalization.
      // Center pan leaves an existing stereo source's channels unchanged.
      const normalizer = context!.createStereoPanner();
      normalizer.pan.value = 0;
      node.connect(normalizer);
      normalizer.connect(buses[bus]);
      const voice: Voice = {
        element,
        node,
        normalizer,
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
        if (pools[bus][active[bus]] !== voice) {
          if (voice.warming) syncVoice(voice, voice.warming);
          return;
        }
        const target = currentTargets()[bus];
        if (
          pools[bus][active[bus]] !== voice ||
          !target ||
          voice.sourceId !== target.sourceId
        )
          return;
        syncVoice(voice, target);
        if (
          (isPlaying() && latest.transport.playing && heldAtCommit === null) ||
          !voice.accepted
        )
          play(voice);
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
    const syncVoice = (voice: Voice, target: Target, preparedTrial = false) => {
      const e = voice.element;
      // Let a muted native trial settle before moving its decoder cursor.
      if (voice.pending && (gate !== null || !isPlaying())) return;
      e.playbackRate = target.speed;
      e.preservesPitch = true;
      if (!graphReady && (voice.pending || voice.accepted)) return;
      if (!Number.isFinite(e.duration)) return;
      // Continuous edits preserve the decoder's native clock. Repeated seeks to
      // the rendered transport position introduce buffering and interrupt sound.
      // Explicit seeks and discontinuous source mappings advance this revision.
      const revision = latest.transport.positionRevision;
      const generation = latest.transport.generation;
      const tolerance =
        voice.mapping?.generation === generation
          ? 0.000001
          : target.speed / (latest.projection?.base.fps ?? 25);
      const continuous =
        voice.mapping &&
        voice.mapping.speed === target.speed &&
        Math.abs(voice.mapping.origin - target.origin) <= tolerance;
      voice.mapping = {
        origin: target.origin,
        speed: target.speed,
        generation,
      };
      if (
        voice.accepted &&
        !preparedTrial &&
        (isPlaying() || !e.paused) &&
        voice.positionRevision === revision &&
        continuous
      )
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
      if (!s || !o.sources || !o.projection) return;
      if (generation !== o.transport.generation) {
        generation = o.transport.generation;
        gate = null;
        stagingOutput = false;
        outputStart = null;
      }
      if (!o.transport.playingIntent) {
        stagingOutput = false;
        outputStart = null;
      }
      if (!context) {
        if (o.transport.playingIntent) ensureGate();
        return;
      }
      if (!isPlaying()) heldAtCommit = committedOptions;
      else if (gate === null && heldAtCommit !== null) {
        if (!o.transport.playing || committedOptions <= heldAtCommit) return;
        heldAtCommit = null;
      }
      applyGains();
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
          for (const voice of pools[bus])
            if (voice?.sourceId) {
              if (voice.pending) {
                release(voice);
                continue;
              }
              voice.element.pause();
              voice.accepted = false;
            }
          continue;
        }
        let voice = pools[bus][active[bus]];
        if (voice?.sourceId !== target.sourceId) {
          if (voice?.sourceId) {
            voice.element.pause();
            voice.token = ++serial;
            voice.pending = false;
            voice.accepted = false;
          }
          active[bus] = 1 - active[bus];
          voice = voiceFor(bus, active[bus]);
          if (voice.sourceId !== target.sourceId) {
            if (voice.sourceId) release(voice);
            voice.sourceId = target.sourceId;
            voice.token = ++serial;
            voice.accepted = false;
            voice.release = o.sources.acquireLease(
              `preview-sound-${bus}-${active[bus]}`,
              new Set([target.sourceId]),
            );
            voice.element.src = o.sources.ensureUrl(target.sourceId);
          }
          voice.warming = undefined;
          if (voice.element.error) {
            block(
              voice.element.error.code === 4 ? 'unsupported' : 'failed',
              `Sound preview cannot fully audition ${o.sources.get(voice.sourceId ?? '')?.file.name ?? 'this source'}. A valid project can still be rendered.`,
            );
            return;
          }
          ensureGate();
        }
        syncVoice(voice!, target);
        if (
          !voice!.accepted ||
          voice!.element.readyState < 2 ||
          voice!.element.seeking
        )
          ensureGate();
        if (isPlaying() || !voice!.accepted) play(voice!);
      }
      allReady();
      if (!isPlaying() && graphReady && !stagingOutput)
        for (const pool of pools)
          for (const voice of pool)
            if (voice && !voice.pending && !voice.element.paused)
              voice.element.pause();
      // Load the upcoming source in the existing spare decoder. Do not play it
      // or acquire a readiness token until it actually owns the audible range.
      if (isPlaying()) {
        const seconds =
          o.transport.captureSoundSeconds?.() ??
          o.transport.captureAnchor().projectSeconds;
        const fps = o.projection.base.fps!;
        const nextOriginal = resolveAudioOwnership(s, o.projection).find(
          (range) => range.startFrame > seconds * fps && range.source,
        );
        const nextMusic = s.music
          .filter((segment) => segment.timelineStartFrame > seconds * fps)
          .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame)[0];
        const starts = [
          nextOriginal?.startFrame,
          nextMusic?.timelineStartFrame,
        ];
        for (const bus of [0, 1]) {
          const start = starts[bus];
          if (start === undefined || start / fps - seconds > 0.25) continue;
          const target = currentTargets(start / fps)[bus];
          if (!target || target.sourceId === targets[bus]?.sourceId) continue;
          const index = 1 - active[bus];
          const voice = voiceFor(bus, index);
          if (voice.sourceId !== target.sourceId) {
            if (voice.sourceId) release(voice);
            voice.sourceId = target.sourceId;
            voice.token = ++serial;
            voice.release = o.sources.acquireLease(
              `preview-sound-${bus}-${index}`,
              new Set([target.sourceId]),
            );
            voice.element.src = o.sources.ensureUrl(target.sourceId);
          }
          voice.warming = target;
          syncVoice(voice, target);
        }
      }
    };
    return {
      commitOptions(next: Options) {
        const changed = committedOptions === 0 || latest !== next;
        latest = next;
        committedOptions++;
        // A held decoder resumes in the same UI commit as the picture, even
        // when a hold/ready pair was batched and the playing flag stayed true.
        if (
          changed ||
          (heldAtCommit !== null &&
            gate === null &&
            context &&
            graphReady &&
            isPlaying() &&
            next.transport.playing)
        )
          sync();
      },
      hold(projectSeconds: number) {
        stagingOutput = false;
        outputStart = null;
        heldAtCommit = committedOptions;
        for (const bus of buses) bus.gain.value = 0;
        for (const pool of pools)
          for (const voice of pool)
            if (voice?.accepted && !voice.pending && !voice.element.paused)
              voice.element.pause();
        const live = latest.transport.getSnapshot?.();
        // A newer edit must publish its matching source model before seeking.
        if (live && live.generation !== latest.transport.generation) return;
        const targets = currentTargets(projectSeconds);
        for (const bus of [0, 1]) {
          const voice = pools[bus][active[bus]],
            target = targets[bus];
          if (
            voice?.accepted &&
            !voice.pending &&
            target?.sourceId === voice.sourceId
          )
            syncVoice(voice, target, true);
        }
        if (targets.some(Boolean) && latest.transport.playingIntent)
          ensureGate();
      },
      get status() {
        return status;
      },
      get message() {
        return message;
      },
      sync,
      tick() {
        const transport = latest.transport;
        const live = transport.getSnapshot?.();
        // Wait for an edit's matching model/options before touching decoders.
        if (live && live.generation !== transport.generation) return;
        if (transport.playingIntent) sync();
      },
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
          if (typeof ctx.createStereoPanner !== 'function') {
            block(
              'unsupported',
              'This browser cannot fully audition sound. A valid project can still be rendered.',
            );
            return false;
          }
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
        stagingOutput = false;
        outputStart = null;
        heldAtCommit = null;
        graphReady = false;
        if (graphFrame !== null) cancelAnimationFrame(graphFrame);
        graphFrame = null;
        for (const pool of pools)
          for (const voice of pool)
            if (voice) {
              release(voice);
              voice.node.disconnect();
              voice.normalizer.disconnect();
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
  const onHold = options.transport.onHold;
  useLayoutEffect(() => onHold?.(api.hold), [api, onHold]);
  useLayoutEffect(() => {
    api.commitOptions(options);
  });
  useEffect(() => {
    api.activate();
    const off = options.sources?.onBeforeClear(() => api.stop());
    // Read the existing live anchor without waiting for a UI frame commit.
    const timer = window.setInterval(api.tick, 20);
    return () => {
      window.clearInterval(timer);
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
