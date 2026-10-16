import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { usePreviewMedia } from './usePreviewMedia';
import { advancedFixture } from '../test/historyFixtures';
import {
  buildAdvancedTimeline,
  resolveProgramFrame,
} from '../lib/advancedTimeline';
import { useProjectPlayback } from './useProjectPlayback';
it('a_real_readiness_resume_realigns_picture_drift_before_starting_the_clock_again', () => {
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(
      { ...f.snapshot, video2: [] },
      f.sources,
      { image: null, video: null },
    );
  function Harness({ playing }: { playing: boolean }) {
    const media = usePreviewMedia({
      current: resolveProgramFrame(projection, 0),
      projection,
      frame: 0,
      playing,
      generation: 1,
      positionRevision: 0,
      onSuspend: () => {},
      onReady: () => {},
    });
    return (
      <>
        {media.slots.map((slot, index) => (
          <video
            key={index}
            ref={media.bind[index]}
            src={slot.url}
            aria-label={
              index === media.active ? 'Active picture' : 'Upcoming picture'
            }
            {...media.events[index]}
          />
        ))}
      </>
    );
  }
  const view = render(<Harness playing={true} />),
    video = screen.getByLabelText('Active picture') as HTMLVideoElement;
  Object.defineProperties(video, {
    duration: { configurable: true, value: 6 },
    readyState: { configurable: true, value: 4 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.loadedMetadata(video);
  view.rerender(<Harness playing={false} />);
  video.currentTime = 0.2;
  view.rerender(<Harness playing={true} />);
  expect(video.currentTime).toBe(0);
});
it('a_new_picture_request_retires_the_previous_unready_gate', () => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (blob) => `blob:${(blob as File).name}`,
  );
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(f.snapshot, f.sources, {
      image: null,
      video: null,
    });
  function Harness({ frame }: { frame: number }) {
    const transport = useProjectPlayback(projection.base, 0, projection);
    const media = usePreviewMedia({
      current: resolveProgramFrame(projection, frame),
      projection,
      frame,
      playing: transport.playing,
      generation: transport.generation,
      sources: f.sources,
      onSuspend: transport.suspend,
      onReady: transport.ready,
    });
    return (
      <>
        <button onClick={transport.toggle}>Play</button>
        <output aria-label="Playback state">{transport.status}</output>
        {media.slots.map((slot, index) => (
          <video
            key={index}
            ref={media.bind[index]}
            src={slot.url}
            aria-label={
              index === media.active ? 'Active picture' : 'Upcoming picture'
            }
            {...media.events[index]}
          />
        ))}
      </>
    );
  }
  const view = render(<Harness frame={0} />);
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(screen.getByLabelText('Playback state')).toHaveTextContent(
    'preparing',
  );
  view.rerender(<Harness frame={40} />);
  const next = screen.getByLabelText('Upcoming picture');
  Object.defineProperties(next, {
    readyState: { configurable: true, value: 4 },
    duration: { configurable: true, value: 2.4 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.loadedMetadata(next);
  fireEvent.canPlay(next);
  expect(screen.getByLabelText('Playback state')).toHaveTextContent('playing');
});
it('a_presented_frame_callback_from_an_older_edit_cannot_move_the_new_clock', () => {
  const prototype = HTMLVideoElement.prototype,
    originalRequest = Object.getOwnPropertyDescriptor(
      prototype,
      'requestVideoFrameCallback',
    ),
    originalCancel = Object.getOwnPropertyDescriptor(
      prototype,
      'cancelVideoFrameCallback',
    );
  const callbacks: VideoFrameRequestCallback[] = [],
    presented = vi.fn();
  Object.defineProperty(prototype, 'requestVideoFrameCallback', {
    configurable: true,
    value: (callback: VideoFrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
  });
  Object.defineProperty(prototype, 'cancelVideoFrameCallback', {
    configurable: true,
    value: () => {},
  });
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(
      { ...f.snapshot, video2: [] },
      f.sources,
      { image: null, video: null },
    );
  function Harness({ generation }: { generation: number }) {
    const media = usePreviewMedia({
      current: resolveProgramFrame(projection, 0),
      projection,
      frame: 0,
      projectSeconds: 0,
      playing: true,
      generation,
      positionRevision: 0,
      onPresented: presented,
      onSuspend: () => {},
      onReady: () => {},
    });
    return (
      <>
        {media.slots.map((slot, index) => (
          <video
            key={index}
            ref={media.bind[index]}
            src={slot.url}
            aria-label={
              index === media.active ? 'Active picture' : 'Upcoming picture'
            }
            {...media.events[index]}
          />
        ))}
      </>
    );
  }
  const view = render(<Harness generation={1} />),
    video = screen.getByLabelText('Active picture');
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 4 },
    paused: { configurable: true, value: false },
    seeking: { configurable: true, value: false },
  });
  const stale = callbacks.at(-1)!;
  try {
    view.rerender(<Harness generation={2} />);
    stale(20, {
      mediaTime: 0.8,
      expectedDisplayTime: 20,
    } as VideoFrameCallbackMetadata);
    expect(presented).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    if (originalRequest)
      Object.defineProperty(
        prototype,
        'requestVideoFrameCallback',
        originalRequest,
      );
    else Reflect.deleteProperty(prototype, 'requestVideoFrameCallback');
    if (originalCancel)
      Object.defineProperty(
        prototype,
        'cancelVideoFrameCallback',
        originalCancel,
      );
    else Reflect.deleteProperty(prototype, 'cancelVideoFrameCallback');
  }
});
it('a_continuous_edit_or_buffering_does_not_seek_the_active_source_but_an_explicit_seek_does', () => {
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(
      { ...f.snapshot, video2: [] },
      f.sources,
      { image: null, video: null },
    );
  function Harness({
    generation,
    positionRevision,
    frame,
    playing = true,
  }: {
    generation: number;
    positionRevision: number;
    frame: number;
    playing?: boolean;
  }) {
    const media = usePreviewMedia({
      current: resolveProgramFrame(projection, frame),
      projection,
      frame,
      playing,
      generation,
      positionRevision,
      sources: f.sources,
      onSuspend: () => {},
      onReady: () => {},
    });
    return (
      <>
        {media.slots.map((slot, index) => (
          <video
            key={index}
            ref={media.bind[index]}
            src={slot.url}
            aria-label={
              index === media.active ? 'Active picture' : 'Upcoming picture'
            }
            {...media.events[index]}
          />
        ))}
      </>
    );
  }
  const view = render(
      <Harness generation={1} positionRevision={0} frame={0} />,
    ),
    video = screen.getByLabelText('Active picture') as HTMLVideoElement;
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 4 },
    duration: { configurable: true, value: 6 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.loadedMetadata(video);
  video.currentTime = 0.1;
  const writes = vi.spyOn(video, 'currentTime', 'set');
  view.rerender(<Harness generation={2} positionRevision={0} frame={0} />);
  view.rerender(
    <Harness generation={2} positionRevision={0} frame={0} playing={false} />,
  );
  expect(writes).not.toHaveBeenCalled();
  view.rerender(
    <Harness generation={3} positionRevision={1} frame={10} playing={false} />,
  );
  expect(video.currentTime).toBe(0.4);
});
it('an_already_ready_preloaded_take_hands_off_without_waiting_for_another_event', () => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (blob) => `blob:${(blob as File).name}`,
  );
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(f.snapshot, f.sources, {
      image: null,
      video: null,
    }),
    ready = vi.fn(),
    suspend = vi.fn();
  function Harness({ frame }: { frame: number }) {
    const media = usePreviewMedia({
      current: resolveProgramFrame(projection, frame),
      projection,
      frame,
      playing: true,
      generation: 1,
      sources: f.sources,
      onSuspend: suspend,
      onReady: ready,
    });
    return (
      <>
        {media.slots.map((slot, index) => (
          <video
            key={index}
            ref={media.bind[index]}
            src={slot.url}
            aria-label={
              index === media.active ? 'Active picture' : 'Upcoming picture'
            }
            {...media.events[index]}
          />
        ))}
      </>
    );
  }
  const view = render(<Harness frame={30} />),
    take = screen.getByLabelText('Upcoming picture');
  Object.defineProperties(take, {
    readyState: { configurable: true, value: 4 },
    duration: { configurable: true, value: 2.4 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.loadedMetadata(take);
  fireEvent.canPlay(take);
  expect(screen.getByLabelText('Active picture')).not.toBe(take);
  view.rerender(<Harness frame={40} />);
  expect(screen.getByLabelText('Active picture')).toBe(take);
});
it('uses_a_bounded_pair_and_requires_current_real_readiness_before_source_handoff', () => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    (blob) => `blob:${(blob as File).name}`,
  );
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(f.snapshot, f.sources, {
      image: null,
      video: null,
    });
  const suspend = vi.fn(),
    ready = vi.fn(),
    fail = vi.fn();
  function Harness({ frame }: { frame: number }) {
    const media = usePreviewMedia({
      current: resolveProgramFrame(projection, frame),
      projection,
      frame,
      playing: true,
      generation: 1,
      sources: f.sources,
      onSuspend: suspend,
      onReady: ready,
      onFailure: fail,
    });
    return (
      <>
        {media.slots.map((slot, index) => (
          <video
            key={index}
            ref={media.bind[index]}
            src={slot.url}
            aria-label={
              index === media.active ? 'Active picture' : 'Upcoming picture'
            }
            {...media.events[index]}
          />
        ))}
      </>
    );
  }
  const view = render(<Harness frame={0} />),
    base = screen.getByLabelText('Active picture');
  expect(document.querySelectorAll('video')).toHaveLength(2);
  view.rerender(<Harness frame={40} />);
  expect(suspend).toHaveBeenCalled();
  expect(screen.getByLabelText('Active picture')).toBe(base);
  const next = screen.getByLabelText('Upcoming picture');
  Object.defineProperties(next, {
    readyState: { configurable: true, value: 3 },
    duration: { configurable: true, value: 2.4 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.loadedMetadata(next);
  fireEvent.canPlay(next);
  expect(screen.getByLabelText('Active picture')).toBe(next);
  expect(ready).toHaveBeenCalled();
  view.rerender(<Harness frame={45} />);
  expect(document.querySelectorAll('video')).toHaveLength(2);
  view.unmount();
  f.sources.reconcileUrls(new Set());
  expect(f.sources.externalOwners.size).toBe(0);
});
