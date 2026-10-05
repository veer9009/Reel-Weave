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
  limits: {
    max_clips: 10,
    max_file_size_mb: 200,
    max_audio_file_size_mb: 100,
    max_overlay_image_file_size_mb: 20,
    max_overlay_video_file_size_mb: 200,
  },
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
  it('removes the marketing headline while keeping the merge workspace available', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
    );
    expect(
      screen.queryByRole('heading', {
        name: /Turn your clips into one story/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Merge workspace' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeVisible();
    for (const copy of [
      'Ad Assembly Timeline',
      'SMALL CLIPS. BIGGER STORIES.',
      'Bring your favorite moments together in one seamless video.',
      'Upload, arrange, and let your story unfold.',
      'Your clips. Your story.',
    ])
      expect(
        screen.queryByText(copy, { exact: false }),
      ).not.toBeInTheDocument();
  });
  it('opens the timeline with uploaded clips and preserves merge edits when returning', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.selectOptions(
      screen.getByLabelText('Speed for first.mp4'),
      '0.5',
    );
    await user.click(screen.getByRole('button', { name: 'Timeline Demo' }));
    expect(screen.getByRole('region', { name: 'VIDEO 1' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Preview clip 1: first.mp4' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Preview clip 2: second.mov' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /merge clips/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to Merge' }));
    expect(screen.getByLabelText('Speed for first.mp4')).toHaveValue('0.5');
    expect(screen.getByRole('button', { name: /merge clips/i })).toBeEnabled();
  }, 15_000);
  it('submits the real Video 1 timeline plan through the existing merge flow', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.click(screen.getByRole('button', { name: 'Trim first.mp4' }));
    fireEvent.change(screen.getByLabelText(/trim end frame/i), {
      target: { value: '39' },
    });
    await user.click(screen.getByRole('button', { name: /save trim/i }));
    await user.selectOptions(
      screen.getByLabelText('Speed for first.mp4'),
      '0.5',
    );
    await user.click(
      screen.getByRole('button', { name: 'Move second.mov up' }),
    );
    await user.click(screen.getByRole('button', { name: 'Timeline Demo' }));
    await user.selectOptions(screen.getByLabelText('Timeline FPS'), '25');
    await user.click(
      screen.getByRole('button', { name: 'Merge current timeline' }),
    );

    const mergeCall = vi
      .mocked(fetch)
      .mock.calls.find((call) => String(call[0]).endsWith('/api/merge'));
    const body = mergeCall?.[1]?.body as FormData;
    expect(body.getAll('files').map((entry) => (entry as File).name)).toEqual([
      'second.mov',
      'first.mp4',
    ]);
    const manifest = JSON.parse(String(body.get('manifest')));
    expect(manifest.output_fps).toBe(25);
    expect(manifest.order).toEqual(
      manifest.clips.map((clip: { client_id: string }) => clip.client_id),
    );
    expect(manifest.clips).toHaveLength(2);
    expect(manifest.clips[1]).toMatchObject({
      start_frame: 0,
      end_frame: 39,
      speed: 0.5,
      trim_saved: true,
    });
    expect(manifest.audio).toEqual({
      original_volume: 1,
      original_muted: false,
      music_volume: 0.3,
      music_muted: false,
    });
    expect(manifest.overlays).toEqual({ image: null, video: null });
    expect(JSON.stringify(manifest)).not.toMatch(
      /Opening shot|SAMPLE AD|VIDEO 2|MOV/,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'VIDEO 1' }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Your story, together.')).toBeVisible();
  }, 15_000);
  it('validates, edits, and submits one image and one PIP overlay', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.upload(
      screen.getByLabelText('Choose image overlay'),
      new File(['logo'], 'logo.png', { type: 'image/png' }),
    );
    await user.upload(
      screen.getByLabelText('Choose video overlay'),
      new File(['pip'], 'pip.mp4', { type: 'video/mp4' }),
    );
    fireEvent.load(document.querySelector('.overlay-editor img')!);
    const pip = document.querySelector<HTMLVideoElement>(
      '.overlay-editor video',
    )!;
    Object.defineProperty(pip, 'duration', { configurable: true, value: 1 });
    fireEvent.loadedMetadata(pip);
    await user.clear(screen.getByLabelText('Image overlay start frame'));
    await user.type(screen.getByLabelText('Image overlay start frame'), '5');
    await user.selectOptions(screen.getByLabelText('Video overlay position'), [
      'centre',
    ]);
    await user.selectOptions(screen.getByLabelText('Video overlay size'), [
      'large',
    ]);
    await user.click(
      screen.getByRole('button', { name: 'Move second.mov up' }),
    );
    await user.click(screen.getByRole('button', { name: /merge clips/i }));

    const mergeCall = vi
      .mocked(fetch)
      .mock.calls.find((call) => String(call[0]).endsWith('/api/merge'));
    const body = mergeCall?.[1]?.body as FormData;
    expect((body.get('overlay_image') as File).name).toBe('logo.png');
    expect((body.get('overlay_video') as File).name).toBe('pip.mp4');
    const manifest = JSON.parse(String(body.get('manifest')));
    expect(manifest.overlays.image).toMatchObject({
      start_frame: 5,
      position: 'top-right',
      size: 'small',
    });
    expect(manifest.overlays.video).toMatchObject({
      position: 'centre',
      size: 'large',
    });
  }, 15_000);
  it('rejects invalid overlays and revokes a replaced overlay URL once', async () => {
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce('blob:clip-one')
      .mockReturnValueOnce('blob:clip-two')
      .mockReturnValueOnce('blob:old-logo')
      .mockReturnValueOnce('blob:new-logo');
    render(<App />);
    const user = await selectTwo();
    const invalid = new File(['text'], 'logo.gif', { type: 'image/gif' });
    const unrestrictedUser = userEvent.setup({ applyAccept: false });
    await unrestrictedUser.upload(
      screen.getByLabelText('Choose image overlay'),
      invalid,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/PNG or JPG/i);

    await user.upload(
      screen.getByLabelText('Choose image overlay'),
      new File(['old'], 'old.png', { type: 'image/png' }),
    );
    await user.upload(
      screen.getByLabelText('Replace image overlay'),
      new File(['new'], 'new.jpg', { type: 'image/jpeg' }),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-logo');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:new-logo');
    expect(screen.getByText('new.jpg')).toBeVisible();
  });
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
