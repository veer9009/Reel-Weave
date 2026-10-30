import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { TimelineSourceProbe } from './TimelineSourceProbe';

it.each(['video2', 'bin-video'] as const)(
  '%s uses decoded video frames instead of browser duration including the audio tail',
  async (track) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            duration: 169 / 30,
            fps: 30,
            totalFrames: 169,
            width: 478,
            height: 850,
            source: 'backend',
          }),
        ),
      ),
    );
    const ready = vi.fn();
    const token = { sourceId: 'video', session: 0, requestId: 1 };
    render(
      <TimelineSourceProbe
        token={token}
        file={new File(['v'], 'portrait.mp4')}
        url="blob:video"
        track={track}
        onReady={ready}
        onError={vi.fn()}
      />,
    );
    const video = screen.getByLabelText(
      track === 'video2'
        ? 'Loading replacement candidate'
        : 'Loading bin video candidate',
    );
    Object.defineProperties(video, {
      duration: { value: 5.8 },
      videoWidth: { value: 478 },
      videoHeight: { value: 850 },
    });
    fireEvent.loadedMetadata(video);
    await waitFor(() =>
      expect(ready).toHaveBeenCalledWith(token, {
        clipMetadata: {
          duration: 169 / 30,
          fps: 30,
          totalFrames: 169,
          width: 478,
          height: 850,
          source: 'backend',
        },
      }),
    );
  },
);

it.each([404, 503, 422])(
  'handles metadata endpoint status %s',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status })),
    );
    const ready = vi.fn(),
      error = vi.fn();
    const token = { sourceId: 'video', session: 0, requestId: 1 };
    render(
      <TimelineSourceProbe
        token={token}
        file={new File(['v'], 'video.mp4')}
        url="blob:video"
        track="video2"
        onReady={ready}
        onError={error}
      />,
    );
    const video = screen.getByLabelText('Loading replacement candidate');
    Object.defineProperties(video, {
      duration: { value: 1 },
      videoWidth: { value: 320 },
      videoHeight: { value: 180 },
    });
    fireEvent.loadedMetadata(video);
    if (status === 422) {
      await waitFor(() => expect(error).toHaveBeenCalledWith(token));
      expect(ready).not.toHaveBeenCalled();
    } else {
      await waitFor(() =>
        expect(ready).toHaveBeenCalledWith(token, {
          clipMetadata: {
            duration: 1,
            fps: 30,
            totalFrames: 30,
            width: 320,
            height: 180,
            source: 'browser',
          },
        }),
      );
      expect(error).not.toHaveBeenCalled();
    }
  },
);

it('does not publish metadata after its source probe unmounts', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const ready = vi.fn(),
    error = vi.fn();
  const { unmount } = render(
    <TimelineSourceProbe
      token={{ sourceId: 'old', session: 0, requestId: 1 }}
      file={new File(['v'], 'old.mp4')}
      url="blob:old"
      track="video2"
      onReady={ready}
      onError={error}
    />,
  );
  const video = screen.getByLabelText('Loading replacement candidate');
  Object.defineProperties(video, {
    duration: { value: 1 },
    videoWidth: { value: 320 },
    videoHeight: { value: 180 },
  });
  fireEvent.loadedMetadata(video);
  unmount();
  resolve(
    new Response(
      JSON.stringify({
        duration: 1,
        fps: 25,
        totalFrames: 25,
        width: 320,
        height: 180,
        source: 'backend',
      }),
    ),
  );
  await new Promise((done) => setTimeout(done, 0));
  expect(ready).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
it('music_probe_reports_sample_count_and_bad_duration', async () => {
  const ready = vi.fn(),
    error = vi.fn();
  const token = { sourceId: 'song', session: 0, requestId: 1 };
  render(
    <TimelineSourceProbe
      token={token}
      file={new File(['a'], 'a.wav')}
      url="blob:song"
      track="music"
      onReady={ready}
      onError={error}
    />,
  );
  const audio = screen.getByLabelText('Loading music candidate');
  Object.defineProperty(audio, 'duration', { value: 0.41, configurable: true });
  fireEvent.loadedMetadata(audio);
  await waitFor(() =>
    expect(ready).toHaveBeenCalledWith(
      token,
      expect.objectContaining({ sampleCount: 19680 }),
    ),
  );
  Object.defineProperty(audio, 'duration', { value: NaN });
  fireEvent.loadedMetadata(audio);
  expect(error).toHaveBeenCalledWith(token);
});
