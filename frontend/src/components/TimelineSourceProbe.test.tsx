import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { TimelineSourceProbe } from './TimelineSourceProbe';
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
