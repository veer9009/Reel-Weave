import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
const health = {
  status: 'ok',
  ffmpeg_available: true,
  ffprobe_available: true,
  limits: { max_clips: 10, max_file_size_mb: 200, max_audio_file_size_mb: 100 },
};
const job = {
  job_id: '00000000-0000-4000-8000-000000000001',
  status: 'queued',
  error: null,
};
function serve(
  mode: 'success' | 'error' | 'network' | 'failed' | 'pollError' = 'success',
) {
  let pollCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return new Response(JSON.stringify(health));
      if (url.endsWith('/api/merge')) {
        if (mode === 'network') throw new TypeError('Failed to fetch');
        if (mode === 'error')
          return new Response(
            JSON.stringify({
              error: {
                code: 'busy',
                message: 'The merge queue is full. Please try again shortly.',
              },
            }),
            { status: 503 },
          );
        const names = (init?.body as FormData)
          .getAll('files')
          .map((f) => (f as File).name);
        expect(names).toEqual(['second.mov', 'first.mp4']);
        return new Response(JSON.stringify(job), { status: 202 });
      }
      if (url.includes('/api/jobs/')) {
        if (mode === 'pollError' && pollCount++ === 0)
          throw new TypeError('offline');
        return new Response(
          JSON.stringify({
            ...job,
            status: mode === 'failed' ? 'failed' : 'completed',
            error: mode === 'failed' ? 'One clip could not be read.' : null,
          }),
        );
      }
      throw new Error('Unexpected URL ' + url);
    }),
  );
}
async function selectTwo() {
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
  );
  await user.upload(screen.getByLabelText('Choose video clips'), [
    new File(['a'], 'first.mp4', { type: 'video/mp4' }),
    new File(['b'], 'second.mov', { type: 'video/quicktime' }),
  ]);
  for (const video of document.querySelectorAll<HTMLVideoElement>(
    '.clip-thumbnail video',
  )) {
    Object.defineProperty(video, 'duration', { configurable: true, value: 3 });
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(video, 'videoHeight', {
      configurable: true,
      value: 1080,
    });
    fireEvent.loadedMetadata(video);
  }
  return user;
}
describe('ReelWeave', () => {
  beforeEach(() => serve());
  it('keeps missing-tool guidance visible while arranging and can reconnect', async () => {
    let checks = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...health,
              ffmpeg_available: checks++ > 0,
            }),
          ),
      ),
    );
    render(<App />);
    const user = await selectTwo();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /processing is unavailable/i,
    );
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /retry connection/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /merge clips/i }),
      ).toBeEnabled(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('disables merge until two clips are selected', async () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeDisabled();
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
    );
    await user.upload(
      screen.getByLabelText('Choose video clips'),
      new File(['a'], 'one.mp4', { type: 'video/mp4' }),
    );
    expect(screen.getByText('one.mp4')).toBeVisible();
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeDisabled();
  });
  it('renders, reorders and removes clips without uploading', async () => {
    render(<App />);
    const user = await selectTwo();
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeEnabled();
    await user.click(
      screen.getByRole('button', { name: 'Move second.mov up' }),
    );
    const list = screen.getByRole('list', { name: 'Clip order' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'second.mov',
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every((c) => String(c[0]).endsWith('/api/health')),
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove first.mp4' }));
    await user.click(screen.getByRole('button', { name: 'Remove second.mov' }));
    expect(screen.getByText(/Your story starts here/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeDisabled();
  });
  it('shows validation errors on unsupported selection', async () => {
    render(<App />);
    const user = userEvent.setup({ applyAccept: false });
    await waitFor(() =>
      expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
    );
    await user.upload(
      screen.getByLabelText('Choose video clips'),
      new File(['a'], 'notes.txt', { type: 'text/plain' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/MP4.*MOV.*WebM.*MKV/);
  });
  it.each(['error', 'network'] as const)(
    'shows %s request failures and keeps clips for retry',
    async (mode) => {
      serve(mode);
      render(<App />);
      const user = await selectTwo();
      await user.click(
        screen.getByRole('button', { name: 'Move second.mov up' }),
      );
      await user.click(screen.getByRole('button', { name: /merge clips/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        mode === 'error' ? /queue is full/ : /connect|network|reach/i,
      );
      expect(screen.getByText('first.mp4')).toBeVisible();
    },
  );
  it('shows completed preview and download, then starts fresh', async () => {
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce('blob:reset-first')
      .mockReturnValueOnce('blob:reset-second');
    render(<App />);
    const user = await selectTwo();
    await user.click(
      screen.getByRole('button', { name: 'Move second.mov up' }),
    );
    await user.click(screen.getByRole('button', { name: /merge clips/i }));
    expect(await screen.findByText('Your story, together.')).toBeVisible();
    expect(screen.getByLabelText('Merged video preview')).toHaveAttribute(
      'src',
      `/api/jobs/${job.job_id}/video`,
    );
    expect(screen.getByRole('link', { name: /download mp4/i })).toHaveAttribute(
      'href',
      `/api/jobs/${job.job_id}/download`,
    );
    await user.click(screen.getByRole('button', { name: /start new merge/i }));
    expect(screen.getByText(/Your story starts here/i)).toBeVisible();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reset-first');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reset-second');
  });
  it('releases removed clip URLs and remaining URLs on unmount', async () => {
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const view = render(<App />);
    const user = await selectTwo();
    await user.click(screen.getByRole('button', { name: 'Remove first.mp4' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:second');
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second');
  });
  it('shows failed processing and allows correction', async () => {
    serve('failed');
    render(<App />);
    const user = await selectTwo();
    await user.click(
      screen.getByRole('button', { name: 'Move second.mov up' }),
    );
    await user.click(screen.getByRole('button', { name: /merge clips/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One clip could not be read.',
    );
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeEnabled();
  });
  it('retries status without creating a second merge', async () => {
    serve('pollError');
    render(<App />);
    const user = await selectTwo();
    await user.click(
      screen.getByRole('button', { name: 'Move second.mov up' }),
    );
    await user.click(screen.getByRole('button', { name: /merge clips/i }));
    await user.click(
      await screen.findByRole('button', { name: /retry status/i }),
    );
    expect(await screen.findByText('Your story, together.')).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter((c) => String(c[0]).endsWith('/api/merge')),
    ).toHaveLength(1);
  });

  it('edits an inclusive frame range with one-frame controls and preserves it across speed changes', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.click(screen.getByRole('button', { name: 'Trim first.mp4' }));
    expect(
      screen.getByRole('dialog', { name: /trim first.mp4/i }),
    ).toBeVisible();
    expect(
      within(document.querySelector('[data-readout="playhead"]')!).getByText(
        'Frame 0',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: /next frame/i }));
    expect(
      within(document.querySelector('[data-readout="playhead"]')!).getByText(
        'Frame 1',
      ),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText(/trim start frame/i), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText(/trim end frame/i), {
      target: { value: '39' },
    });
    await user.click(screen.getByRole('button', { name: /save trim/i }));
    expect(screen.getByText(/Frames 10–39/)).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText('Speed for first.mp4'),
      '0.5',
    );
    expect(screen.getByText(/Frames 10–39/)).toBeVisible();
    expect(screen.getByText('0:02')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Trim first.mp4' }));
    expect(
      document.querySelector<HTMLVideoElement>('.trim-preview')?.playbackRate,
    ).toBe(0.5);
    expect(
      screen.getByRole('button', { name: /previous frame/i }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /next frame/i }));
    expect(
      within(document.querySelector('[data-readout="playhead"]')!).getByText(
        'Frame 11',
      ),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Playhead frame'), {
      target: { value: '39' },
    });
    expect(screen.getByRole('button', { name: /next frame/i })).toBeDisabled();
  }, 10_000);

  it('marks a saved trim as manual in the merge manifest', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.click(screen.getByRole('button', { name: 'Trim first.mp4' }));
    fireEvent.change(screen.getByLabelText(/trim end frame/i), {
      target: { value: '39' },
    });
    await user.click(screen.getByRole('button', { name: /save trim/i }));
    await user.click(screen.getByRole('button', { name: /merge clips/i }));
    const mergeCall = vi
      .mocked(fetch)
      .mock.calls.find((call) => String(call[0]).endsWith('/api/merge'));
    const manifest = JSON.parse(
      String((mergeCall?.[1]?.body as FormData).get('manifest')),
    );
    expect(manifest.clips[0]).toMatchObject({
      start_frame: 0,
      end_frame: 39,
      trim_saved: true,
    });
  });

  it('shows a useful error when browser media metadata cannot be read', async () => {
    render(<App />);
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
    );
    await user.upload(
      screen.getByLabelText('Choose video clips'),
      new File(['bad'], 'broken.mp4', { type: 'video/mp4' }),
    );
    fireEvent.error(document.querySelector('.clip-thumbnail video')!);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /metadata.*broken\.mp4/i,
    );
  });

  it('manages one background-audio track and sends the manifest with ordered files', async () => {
    render(<App />);
    const user = await selectTwo();
    const audioFile = new File(['music'], 'theme.mp3', { type: 'audio/mpeg' });
    await user.upload(
      screen.getByLabelText(/choose background audio/i),
      audioFile,
    );
    const audio = document.querySelector<HTMLAudioElement>('audio');
    expect(audio).not.toBeNull();
    Object.defineProperty(audio!, 'duration', {
      configurable: true,
      value: 12,
    });
    fireEvent.loadedMetadata(audio!);
    expect(screen.getByText('theme.mp3')).toBeVisible();
    expect(
      screen.getByLabelText('Original audio volume', { selector: 'input' }),
    ).toHaveValue('100');
    expect(
      screen.getByLabelText('Music volume', { selector: 'input' }),
    ).toHaveValue('30');
    await user.click(screen.getByLabelText(/mute original audio/i));
    await user.click(
      screen.getByRole('button', { name: 'Move second.mov up' }),
    );
    await user.click(screen.getByRole('button', { name: /merge clips/i }));
    const mergeCall = vi
      .mocked(fetch)
      .mock.calls.find((call) => String(call[0]).endsWith('/api/merge'));
    const body = mergeCall?.[1]?.body as FormData;
    expect((body.get('background_audio') as File).name).toBe('theme.mp3');
    const manifest = JSON.parse(String(body.get('manifest')));
    expect(manifest.clips).toEqual(
      expect.arrayContaining([expect.objectContaining({ trim_saved: false })]),
    );
    expect(
      manifest.clips.map((clip: { client_id: string }) => clip.client_id),
    ).toHaveLength(2);
    expect(manifest.audio).toMatchObject({
      original_muted: true,
      music_volume: 0.3,
    });
  });

  it('rejects background audio with unusable duration metadata', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.upload(
      screen.getByLabelText(/choose background audio/i),
      new File(['music'], 'broken.mp3', { type: 'audio/mpeg' }),
    );
    const audio = document.querySelector<HTMLAudioElement>('audio')!;
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: Number.NaN,
    });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /background-audio metadata/i,
    );
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeDisabled();
  });
});
