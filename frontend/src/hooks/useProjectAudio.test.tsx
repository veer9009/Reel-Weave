import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useProjectAudio } from './useProjectAudio';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from '../lib/advancedTimeline';
import type { EditSnapshot } from '../lib/editHistory';
import type { ProjectPlayback } from './useProjectPlayback';

const elements: HTMLMediaElement[] = [],
  nodes: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [],
  gains: {
    gain: { value: number };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
let rejectResume = false;
let graphTime = 1;
const contexts: Context[] = [];
class Context {
  state = 'suspended';
  destination = {};
  currentTime = graphTime;
  constructor() {
    contexts.push(this);
  }
  resume = vi.fn(async () => {
    if (rejectResume)
      throw new DOMException('User gesture required', 'NotAllowedError');
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createGain() {
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    gains.push(gain);
    return gain;
  }
  createMediaElementSource(element: HTMLMediaElement) {
    elements.push(element);
    const node = { connect: vi.fn(), disconnect: vi.fn() };
    nodes.push(node);
    return node;
  }
}
beforeEach(() => {
  elements.length = 0;
  contexts.length = 0;
  nodes.length = 0;
  gains.length = 0;
  rejectResume = false;
  graphTime = 1;
  vi.stubGlobal('AudioContext', Context);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (blob) => `blob:${(blob as File).name}`,
  );
});
function setup() {
  const f = advancedFixture(),
    file = f.sources.register(new File(['sound'], 'dialogue.wav'), 'audio');
  f.sources.markReady(file, { duration: 6, sampleCount: 288000 });
  const snapshot: EditSnapshot = {
    ...f.snapshot,
    video2: [],
    independentAudio: [
      {
        id: 'dialogue',
        timelineStartFrame: 0,
        durationFrames: 150,
        sourceStartSample: 0,
        source: { kind: 'audio-file', sourceId: file.sourceId },
      },
    ],
    musicSourceId: file.sourceId,
    music: [
      {
        id: 'song',
        sourceId: file.sourceId,
        timelineStartFrame: 0,
        durationFrames: 150,
        sourceStartSample: 0,
      },
    ],
    audio: {
      originalVolume: 0.5,
      originalMuted: false,
      musicVolume: 0.2,
      musicMuted: false,
    },
  };
  const transport = {
    frame: 0,
    playing: true,
    playingIntent: true,
    generation: 1,
    positionRevision: 0,
    status: 'playing',
    suspend: vi.fn(),
    ready: vi.fn(),
    pause: vi.fn(),
    fail: vi.fn(),
    captureAnchor: () => ({
      frame: 0,
      projectSeconds: 0,
      playingIntent: true,
      occurrenceId: 'base',
      sourceId: f.base.sourceId,
      sourceTime: 0,
    }),
  } as unknown as ProjectPlayback;
  const projection = buildAdvancedTimeline(snapshot, f.sources, {
    image: null,
    video: null,
  });
  const props = { snapshot, sources: f.sources, projection, transport };
  return {
    ...f,
    file,
    props,
    ...renderHook((options) => useProjectAudio(options), {
      initialProps: props,
    }),
  };
}
const ready = (element: HTMLMediaElement, duration = 6) => {
  Object.defineProperties(element, {
    duration: { configurable: true, value: duration },
    readyState: { configurable: true, value: 4 },
    seeking: { configurable: true, value: false },
  });
  element.dispatchEvent(new Event('loadedmetadata'));
  element.dispatchEvent(new Event('canplay'));
};
it('play_intent_gates_transport_before_the_audio_context_is_created', () => {
  const h = setup();
  expect(h.props.transport.suspend).toHaveBeenCalled();
  expect(h.result.current.status).toBe('preparing');
  expect(h.props.transport.ready).not.toHaveBeenCalled();
});
it('initial_context_readiness_releases_the_gate_registered_before_creation', async () => {
  const h = setup();
  const token = vi.mocked(h.props.transport.suspend).mock.calls[0][0];
  await act(async () => {
    await h.result.current.resumeAudio();
    elements.forEach((e) => ready(e));
  });
  expect(h.props.transport.ready).toHaveBeenCalledWith(token);
});
it('resuming_a_prepared_voice_does_not_seek_to_elapsed_render_time', async () => {
  const h = setup();
  h.rerender({ ...h.props, transport: { ...h.props.transport, playing: false, status: 'preparing' } });
  await act(async () => {
    await h.result.current.resumeAudio();
    elements.forEach((e) => ready(e));
  });
  const writes = elements.map((e) => vi.spyOn(e, 'currentTime', 'set'));
  h.rerender({ ...h.props, transport: { ...h.props.transport,
    captureAnchor: () => ({ ...h.props.transport.captureAnchor(), projectSeconds: 0.08 }) } });
  for (const write of writes) expect(write).not.toHaveBeenCalled();
});
it('audio_ownership_uses_the_live_position_when_the_rendered_frame_precedes_a_split', async () => {
  const h = setup();
  const first = h.props.snapshot.video1[0];
  const snapshot = { ...h.props.snapshot, independentAudio: [], music: [],
    video1: [{ ...first, trim: { startFrame: 0, endFrame: 24 } },
      { ...first, id: 'right', trim: { startFrame: 25, endFrame: 149 } }] };
  const props = { ...h.props, snapshot,
    projection: buildAdvancedTimeline(snapshot, h.sources, { image: null, video: null }) };
  h.rerender(props);
  await act(async () => {
    await h.result.current.resumeAudio();
    elements.forEach((e) => ready(e));
  });
  const voice = elements[0], url = voice.getAttribute('src');
  voice.currentTime = 1.01;
  h.rerender({ ...props, transport: { ...props.transport, frame: 24,
    captureAnchor: () => ({ ...props.transport.captureAnchor(), projectSeconds: 1.01 }) } });
  expect(voice.getAttribute('src')).toBe(url);
  expect(elements).toHaveLength(1);
});
it.each(['independentAudio', 'music'] as const)(
  'same_file_%s_boundary_seeks_to_the_next_segment_source_window',
  async (lane) => {
    const h = setup();
    const first = h.props.snapshot[lane][0];
    const snapshot = {
      ...h.props.snapshot,
      [lane]: [
        { ...first, durationFrames: 25 },
        {
          ...first,
          id: 'later',
          timelineStartFrame: 25,
          durationFrames: 25,
          sourceStartSample: 192000,
        },
      ],
    };
    h.rerender({ ...h.props, snapshot });
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, 'paused', {
        configurable: true,
        value: false,
      });
      return Promise.resolve();
    });
    await act(async () => {
      await h.result.current.resumeAudio();
      elements.forEach((e) => ready(e));
    });
    elements.forEach((e) => {
      e.currentTime = 1;
    });
    h.rerender({
      ...h.props,
      snapshot,
      transport: {
        ...h.props.transport,
        frame: 25,
        captureAnchor: () => ({
          ...h.props.transport.captureAnchor(),
          frame: 25,
          projectSeconds: 1,
        }),
      },
    });
    expect(elements[lane === 'independentAudio' ? 0 : 1].currentTime).toBe(4);
    expect(elements[lane === 'independentAudio' ? 1 : 0].currentTime).toBe(1);
  },
);
it('continuous_edits_do_not_reseek_a_running_native_voice_but_explicit_seek_repositions_it', async () => {
  const h = setup();
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return Promise.resolve();
  });
  await act(async () => {
    await h.result.current.resumeAudio();
    elements.forEach((e) => ready(e));
  });
  elements.forEach((e) => {
    e.currentTime = 0.12;
  });
  const writes = elements.map((e) => vi.spyOn(e, 'currentTime', 'set'));
  const transport = {
    ...h.props.transport,
    generation: 2,
    positionRevision: 0,
    frame: 2,
    captureAnchor: () => ({
      ...h.props.transport.captureAnchor(),
      frame: 2,
      projectSeconds: 0.06,
    }),
  };
  h.rerender({ ...h.props, transport });
  for (const write of writes) expect(write).not.toHaveBeenCalled();
  h.rerender({
    ...h.props,
    transport: {
      ...transport,
      positionRevision: 1,
      playing: false,
      playingIntent: false,
    },
  });
  h.rerender({
    ...h.props,
    transport: { ...transport, positionRevision: 1, generation: 3 },
  });
  for (const element of elements)
    expect(element.currentTime).toBeCloseTo(0.06, 5);
});
it('a_running_context_with_a_stalled_render_clock_cannot_claim_audible_readiness', async () => {
  vi.useFakeTimers();
  graphTime = 0;
  const h = setup();
  try {
    await act(async () => {
      await h.result.current.resumeAudio();
      elements.forEach((e) => ready(e));
    });
    expect(h.props.transport.ready).not.toHaveBeenCalled();
    expect(h.result.current.status).toBe('preparing');
    await act(async () => {
      contexts.at(-1)!.currentTime = 0.02;
      vi.advanceTimersByTime(20);
    });
    expect(h.props.transport.ready).toHaveBeenCalled();
  } finally {
    h.unmount();
    vi.useRealTimers();
  }
});
it('preparing_does_not_repeat_native_play_trials_after_a_successful_trial_and_seek', async () => {
  const h = setup();
  h.rerender({
    ...h.props,
    transport: { ...h.props.transport, playing: false, status: 'preparing' },
  });
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.currentTime += 0.04;
    return Promise.resolve();
  });
  await act(async () => {
    await h.result.current.resumeAudio();
    elements.forEach((e) => ready(e));
  });
  await act(async () => {
    elements.forEach((e) => e.dispatchEvent(new Event('canplay')));
  });
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  expect(elements.every((e) => Math.abs(e.currentTime) < 0.05)).toBe(true);
});
it('buffering_does_not_reseek_a_paused_voice_within_the_native_preview_tolerance', async () => {
  const h = setup();
  h.rerender({
    ...h.props,
    transport: { ...h.props.transport, playing: false, status: 'preparing' },
  });
  await act(async () => {
    await h.result.current.resumeAudio();
    elements.forEach((e) => ready(e));
  });
  elements.forEach((e) => {
    e.currentTime = 0.02;
  });
  const writes = elements.map((e) => vi.spyOn(e, 'currentTime', 'set'));
  await act(async () => {
    elements.forEach((e) => e.dispatchEvent(new Event('canplay')));
  });
  for (const spy of writes) expect(spy).not.toHaveBeenCalled();
});
it('a_cancelled_session_ignores_a_late_AudioContext_resume_rejection', async () => {
  const h = setup();
  let reject: (error: Error) => void = () => {};
  vi.spyOn(Context.prototype, 'createGain');
  const original = Context;
  class PendingContext extends original {
    resume = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
  }
  vi.stubGlobal('AudioContext', PendingContext);
  let pending: Promise<boolean>;
  act(() => {
    pending = h.result.current.resumeAudio();
  });
  act(() => h.result.current.stop());
  await act(async () => {
    reject(new Error('Old context closed'));
    await pending!;
  });
  expect(h.result.current.status).toBe('ready');
  expect(h.props.transport.pause).not.toHaveBeenCalled();
});
it('a_continuous_newer_edit_does_not_pause_an_already_playing_voice_when_an_old_play_promise_finishes', async () => {
  const h = setup(),
    finishes: (() => void)[] = [];
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return new Promise<void>((resolve) => finishes.push(resolve));
  });
  await act(async () => {
    await h.result.current.resumeAudio();
    elements.forEach((e) => ready(e));
  });
  h.rerender({
    ...h.props,
    transport: { ...h.props.transport, generation: 2 },
  });
  const paused = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length;
  await act(async () => {
    finishes.forEach((finish) => finish());
  });
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length).toBe(
    paused,
  );
});
it('user_play_initializes_two_buses_independent_ownership_suppresses_linked_audio_and_gains_apply_once', async () => {
  const h = setup();
  expect(gains).toHaveLength(0);
  await act(async () => {
    await h.result.current.resumeAudio();
  });
  expect(gains).toHaveLength(2);
  expect(gains.map((v) => v.gain.value)).toEqual([0.5, 0.2]);
  expect(
    elements.filter((e) => e.getAttribute('src') === `blob:dialogue.wav`),
  ).toHaveLength(2);
  expect(elements.some((e) => e.getAttribute('src') === `blob:base.mp4`)).toBe(
    false,
  );
  for (const node of nodes) expect(node.connect).toHaveBeenCalledTimes(1);
  await act(async () => {
    elements.forEach((e) => ready(e));
  });
  expect(h.props.transport.ready).toHaveBeenCalled();
  h.rerender({
    ...h.props,
    snapshot: {
      ...h.props.snapshot,
      audio: {
        ...h.props.snapshot.audio,
        originalMuted: true,
        musicMuted: true,
      },
    },
  });
  expect(gains.map((v) => v.gain.value)).toEqual([0, 0]);
  h.unmount();
  expect(h.sources.externalOwners.size).toBe(0);
});
it('frozen_video_recipe_uses_its_own_speed_sample_offset_and_source_after_owner_deletion', async () => {
  const h = setup(),
    snapshot: EditSnapshot = {
      ...h.props.snapshot,
      fpsSelection: '60',
      musicSourceId: null,
      music: [],
      independentAudio: [
        {
          id: 'detached',
          timelineStartFrame: 60,
          durationFrames: 120,
          sourceStartSample: 48000,
          source: {
            kind: 'video-edit',
            sourceId: h.take.sourceId,
            sourceStartFrame: 0,
            sourceEndFrame: 59,
            speed: 0.5,
            normalizationFps: 25,
          },
          detachedFrom: { track: 'video2', clipId: 'deleted-owner' },
        },
      ],
    };
  const transport = {
    ...h.props.transport,
    frame: 84,
    captureAnchor: () => ({
      frame: 84,
      projectSeconds: 1.4,
      playingIntent: true,
      occurrenceId: 'base',
      sourceId: h.base.sourceId,
      sourceTime: 1.4,
    }),
  };
  h.rerender({
    ...h.props,
    snapshot,
    transport,
    projection: buildAdvancedTimeline(snapshot, h.sources, {
      image: null,
      video: null,
    }),
  });
  await act(async () => {
    await h.result.current.resumeAudio();
  });
  const voice = elements.find(
    (e) => e.getAttribute('src') === 'blob:take.mp4',
  )!;
  act(() => ready(voice, 2.4));
  expect(voice.currentTime).toBeCloseTo(0.7, 5);
  expect(voice.playbackRate).toBe(0.5);
  expect(voice.preservesPitch).toBe(true);
});
it('autoplay_rejection_is_visible_and_pause_wins_over_late_play_completion', async () => {
  const h = setup();
  rejectResume = true;
  await act(async () => {
    await h.result.current.resumeAudio();
  });
  expect(h.result.current.status).toBe('resume-required');
  rejectResume = false;
  await act(async () => {
    await h.result.current.resumeAudio();
  });
  const finishes: (() => void)[] = [];
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishes.push(resolve);
      }),
  );
  act(() => elements.forEach((e) => ready(e)));
  h.rerender({
    ...h.props,
    transport: {
      ...h.props.transport,
      playing: false,
      playingIntent: false,
      generation: 2,
      status: 'paused',
    },
  });
  vi.mocked(h.props.transport.ready).mockClear();
  const paused = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length;
  await act(async () => {
    finishes.forEach((finish) => finish());
  });
  expect(h.props.transport.ready).not.toHaveBeenCalled();
  expect(
    vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length,
  ).toBeGreaterThan(paused);
  expect(nodes.length).toBeLessThanOrEqual(4);
});
it('detached_silence_has_no_base_or_PIP_fallback_and_repeated_source_changes_keep_nodes_bounded', async () => {
  const h = setup(),
    snapshot: EditSnapshot = {
      ...h.props.snapshot,
      video1: h.props.snapshot.video1.map((v) => ({
        ...v,
        originalAudio: 'detached',
      })),
      independentAudio: [],
      musicSourceId: null,
      music: [],
    };
  h.rerender({ ...h.props, snapshot });
  await act(async () => {
    await h.result.current.resumeAudio();
  });
  expect(elements).toHaveLength(0);
  for (let index = 0; index < 8; index++) {
    const source = h.sources.register(
      new File(['tone'], `voice-${index}.wav`),
      'audio',
    );
    h.sources.markReady(source, { duration: 6, sampleCount: 288000 });
    const next = {
      ...snapshot,
      independentAudio: [
        {
          ...h.props.snapshot.independentAudio[0],
          source: { kind: 'audio-file' as const, sourceId: source.sourceId },
        },
      ],
    };
    h.rerender({ ...h.props, snapshot: next });
    await act(async () => {
      elements.forEach((e) => ready(e));
    });
  }
  expect(elements.length).toBeLessThanOrEqual(2);
  for (const node of nodes) expect(node.connect).toHaveBeenCalledTimes(1);
  h.unmount();
  expect(h.sources.externalOwners.size).toBe(0);
});
