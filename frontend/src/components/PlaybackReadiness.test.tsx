import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from '../lib/advancedTimeline';
import { EditingWorkspace } from './EditingWorkspace';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Keep the passing muted/base control from the readiness investigation.
// jsdom has no decoder or Web Audio graph; keep the application hooks real
// and supply only those browser boundaries.
it.each([false, true])(
  'muted base preview preserves position with delayed audio initialization: %s',
  async (delayed) => {
    let releaseResume: (() => void) | undefined;
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    class Context {
      state = 'suspended';
      currentTime = 1;
      destination = {};
      async resume() {
        if (delayed)
          await new Promise<void>((resolve) => {
            releaseResume = resolve;
          });
        this.state = 'running';
      }
      async close() {
        this.state = 'closed';
      }
      createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }
      createMediaElementSource() {
        return { connect() {}, disconnect() {} };
      }
      createStereoPanner() {
        return { pan: { value: 0 }, connect() {}, disconnect() {} };
      }
    }
    vi.stubGlobal('AudioContext', Context);
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    const times = new WeakMap<HTMLMediaElement, number>();
    const starts: HTMLVideoElement[] = [];
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(6);
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
      4,
    );
    vi.spyOn(HTMLMediaElement.prototype, 'seeking', 'get').mockReturnValue(
      false,
    );
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
      function (this: HTMLMediaElement) {
        return paused.get(this) ?? true;
      },
    );
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'get',
    ).mockImplementation(function (this: HTMLMediaElement) {
      return times.get(this) ?? 0;
    });
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'set',
    ).mockImplementation(function (this: HTMLMediaElement, value) {
      times.set(this, value);
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      paused.set(this, true);
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      paused.set(this, false);
      if (this instanceof HTMLVideoElement) {
        starts.push(this);
        return Promise.resolve();
      }
      return Promise.resolve();
    });
    const f = advancedFixture();
    const snapshot = {
      ...f.snapshot,
      video2: [],
      video1: [{ ...f.snapshot.video1[0], speed: 1 as const }],
      audio: { ...f.snapshot.audio, originalMuted: true },
    };
    const overlays = { image: null, video: null };
    const projection = buildAdvancedTimeline(snapshot, f.sources, overlays);
    render(
      <EditingWorkspace
        clips={projection.base.items.map((item) => item.clip)}
        timeline={projection.base}
        overlays={overlays}
        backgroundAudio={null}
        audioSettings={snapshot.audio}
        audioActions={{
          snapshot,
          sources: f.sources,
          onEdit: () => false,
          onSave: () => false,
          onDetach: () => false,
          onReplaceFile: () => {},
          onBegin: () => null,
          onPreview: () => false,
          onEnd: () => {},
          onError: () => {},
        }}
        fpsSelection="25"
        structuralRevision={0}
        editingLocked={false}
        onFpsSelectionChange={() => {}}
        mediaContent={null}
        clipContent={null}
        overlayContent={null}
        audioContent={null}
        deliveryContent={null}
        resultContent={null}
      />,
    );
    const video = screen.getByLabelText(
      'Uploaded clip preview',
    ) as HTMLVideoElement;
    const toggle = screen.getByRole('button', { name: 'Play preview' });
    const position = screen.getByLabelText(
      'Timeline position',
    ) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(position.value).toBe('0');
    if (delayed) {
      expect(starts).toEqual([]);
      expect(video.paused).toBe(true);
      releaseResume!();
    }
    await act(async () => {});
    expect(video.paused).toBe(false);
    expect(starts).toEqual([video]);
    expect(screen.queryByText('Preparing Preview')).toBeNull();
    act(() => {
      times.set(video, 0.8);
      vi.advanceTimersByTime(800);
    });
    fireEvent.click(toggle);
    expect(position.value).toBe('20');
    expect(video.paused).toBe(true);
    fireEvent.click(toggle);
    expect(position.value).toBe('20');
    if (delayed) releaseResume!();
    await act(async () => {});
    expect(starts).toEqual([video, video]);
    expect(video.paused).toBe(false);
    expect(position.value).toBe('20');
    expect(screen.queryByText('Preparing Preview')).toBeNull();
  },
);
