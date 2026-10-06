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
describe('AVStudio', { timeout: 15000 }, () => {
  beforeEach(() => serve());
  it('drops one PIP through existing controls and safely validates replacement', async () => {
    render(<App />);
    await selectTwo();
    const target = screen.getByLabelText('PIP video drop target');
    const drop = (file: File) =>
      fireEvent.drop(target, {
        dataTransfer: { types: ['Files'], files: [file] },
      });
    expect(screen.getByText('Drop PIP video here')).toBeVisible();
    drop(new File(['pip'], 'pip.mp4'));
    expect(
      screen.getByRole('button', { name: 'Select PIP overlay: pip.mp4' }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Video overlay start frame'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Video overlay end frame'), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByLabelText('Video overlay position'), {
      target: { value: 'top-left' },
    });
    fireEvent.change(screen.getByLabelText('Video overlay size'), {
      target: { value: 'large' },
    });
    const oldVideo = document.querySelector<HTMLVideoElement>(
      '.overlay-slot video',
    )!;
    expect(oldVideo.muted).toBe(true);
    Object.defineProperty(oldVideo, 'duration', {
      configurable: true,
      value: 2,
    });
    fireEvent.loadedMetadata(oldVideo);
    const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    drop(new File(['bad'], 'bad.png'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose an MP4, MOV, WebM, or MKV video overlay.',
    );
    const big = new File(['big'], 'big.mp4');
    Object.defineProperty(big, 'size', { value: 201 * 1024 * 1024 });
    drop(big);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Video overlay exceeds the 200 MB limit.',
    );
    drop(new File([], 'empty.mp4'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Video overlay is empty.',
    );
    expect(
      screen.getByRole('button', { name: 'Select PIP overlay: pip.mp4' }),
    ).toBeVisible();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls).toHaveLength(revoked);
    fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Replace PIP video')).toBeVisible();
    drop(new File(['new'], 'replacement.mov'));
    expect(
      screen.queryByRole('button', { name: 'Select PIP overlay: pip.mp4' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Select PIP overlay: replacement.mov',
      }),
    ).toBeVisible();
    expect(screen.getByLabelText('Video overlay start frame')).toHaveValue(10);
    expect(screen.getByLabelText('Video overlay end frame')).toHaveValue(30);
    expect(screen.getByLabelText('Video overlay position')).toHaveValue(
      'top-left',
    );
    expect(screen.getByLabelText('Video overlay size')).toHaveValue('large');
    expect(screen.getByLabelText('Replace video overlay')).toBeEnabled();
    expect(
      within(screen.getByRole('region', { name: 'VIDEO 1' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: 'AUDIO 1' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(2);
    expect(
      screen.getByLabelText('Original audio volume', { selector: 'input' }),
    ).toHaveValue('100');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove replacement.mov' }),
    );
    expect(screen.getByText('Drop PIP video here')).toBeVisible();
  });
  it('outside_file_drop_prevents_navigation_and_preserves_project', async () => {
    render(<App />);
    await selectTwo();
    const target = screen.getByRole('region', { name: 'Sequence timeline' });
    for (const type of ['dragover', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], files: [new File(['c'], 'outside.mp4')] },
      });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(
      screen.getByRole('button', { name: 'Trim first.mp4' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Trim second.mov' }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Trim outside.mp4' }),
    ).toBeNull();
    const text = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(text, 'dataTransfer', {
      value: { types: ['text/plain'] },
    });
    fireEvent(target, text);
    expect(text.defaultPrevented).toBe(false);
    fireEvent.drop(document.querySelector('.dropzone')!, {
      dataTransfer: {
        types: ['Files'],
        files: [new File(['c'], 'outside.mp4', { type: 'video/mp4' })],
      },
    });
    expect(
      screen.getAllByRole('button', { name: 'Trim outside.mp4' }),
    ).toHaveLength(1);
  });
  it('pending_clip_disables_overlay_upload_without_compressed_timing', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.upload(
      screen.getByLabelText('Choose video clips'),
      new File(['pending'], 'pending.mp4', { type: 'video/mp4' }),
    );
    expect(screen.getByLabelText('Timeline position')).toBeDisabled();
    expect(screen.getByLabelText('Choose image overlay')).toBeDisabled();
    expect(screen.getByLabelText('Choose video overlay')).toBeDisabled();
    expect(
      within(screen.getByRole('region', { name: 'VIDEO 1' })).queryAllByRole(
        'button',
      ),
    ).toHaveLength(0);
  });
  it('AVStudio branding has one accessible workspace link and no demo entry', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
    );
    expect(
      screen.getByRole('link', { name: 'AVStudio workspace' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Timeline Demo' })).toBeNull();
    expect(document.body).not.toHaveTextContent('ReelWeave');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Render MP4' })).toHaveAttribute(
      'aria-describedby',
      'render-hint',
    );
  });
  it(
    'keeps the timeline visible and locks completed editing until New project',
    { timeout: 15000 },
    async () => {
      render(<App />);
      const user = await selectTwo();
      await user.click(
        screen.getByRole('button', { name: 'Move second.mov up' }),
      );
      await user.click(screen.getByRole('button', { name: 'Render MP4' }));
      await screen.findByText('MP4 ready');
      expect(
        screen.getByRole('region', { name: 'Sequence timeline' }),
      ).toBeVisible();
      expect(screen.getByLabelText('Speed for first.mp4')).toBeDisabled();
      expect(screen.getByLabelText('Timeline FPS')).toBeDisabled();
      expect(screen.getByLabelText('Choose video clips')).toBeDisabled();
      const target = screen.getByLabelText('PIP video drop target');
      expect(target).toHaveAttribute('aria-disabled', 'true');
      fireEvent.drop(target, {
        dataTransfer: {
          types: ['Files'],
          files: [new File(['pip'], 'locked.mp4')],
        },
      });
      expect(
        screen.queryByRole('button', {
          name: 'Select PIP overlay: locked.mp4',
        }),
      ).toBeNull();
      await user.click(screen.getByRole('button', { name: 'New project' }));
      expect(
        within(screen.getByRole('region', { name: 'VIDEO 1' })).queryAllByRole(
          'button',
        ),
      ).toHaveLength(0);
      expect(screen.getByLabelText('Timeline FPS')).toHaveValue('auto');
      expect(screen.queryByLabelText('Merged video preview')).toBeNull();
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some((call) => call[1]?.method === 'DELETE'),
      ).toBe(false);
    },
  );
  it(
    'structural overlay edits pause the shared preview without changing schedules',
    { timeout: 15000 },
    async () => {
      render(<App />);
      const user = await selectTwo();
      await user.upload(
        screen.getByLabelText('Choose image overlay'),
        new File(['logo'], 'logo.png', { type: 'image/png' }),
      );
      const image = document.querySelector('.overlay-slot img')!;
      fireEvent.load(image);
      await user.click(screen.getByRole('button', { name: 'Play preview' }));
      expect(
        screen.getByRole('button', { name: 'Pause preview' }),
      ).toBeVisible();
      fireEvent.change(screen.getByLabelText('Image overlay end frame'), {
        target: { value: '20' },
      });
      expect(
        screen.getByRole('button', { name: 'Play preview' }),
      ).toBeVisible();
      expect(screen.getByLabelText('Image overlay end frame')).toHaveValue(20);
      await user.click(screen.getByRole('button', { name: 'Play preview' }));
      await user.upload(
        screen.getByLabelText('Replace image overlay'),
        new File(['replacement'], 'new-logo.png', { type: 'image/png' }),
      );
      expect(
        screen.getByRole('button', { name: 'Play preview' }),
      ).toBeVisible();
    },
  );
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
      screen.getByRole('region', { name: 'Sequence timeline' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeVisible();
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
  it('defaults to the timeline with uploaded clips and preserves edits', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.selectOptions(
      screen.getByLabelText('Speed for first.mp4'),
      '0.5',
    );
    expect(screen.getByRole('region', { name: 'VIDEO 1' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Preview clip 1: first.mp4' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Preview clip 2: second.mov' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeVisible();
    expect(screen.getByLabelText('Speed for first.mp4')).toHaveValue('0.5');
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeEnabled();
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
    await user.selectOptions(screen.getByLabelText('Timeline FPS'), '25');
    await user.click(screen.getByRole('button', { name: 'Render MP4' }));

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
      expect(screen.getByRole('region', { name: 'VIDEO 1' })).toBeVisible(),
    );
    expect(await screen.findByText('MP4 ready')).toBeVisible();
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
    await user.click(screen.getByRole('button', { name: /render mp4/i }));

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
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /retry connection/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /render mp4/i })).toBeEnabled(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('enables rendering for one ready clip but rejects empty, pending and invalid metadata', async () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeDisabled();
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
    );
    await user.upload(
      screen.getByLabelText('Choose video clips'),
      new File(['a'], 'one.mp4', { type: 'video/mp4' }),
    );
    expect(
      within(screen.getByRole('region', { name: 'Media' })).getByText(
        'one.mp4',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeDisabled();
    const video = document.querySelector<HTMLVideoElement>(
      '.clip-thumbnail video',
    )!;
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
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeEnabled();
    fireEvent.error(video);
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeDisabled();
  });
  it('renders, reorders and removes clips without uploading', async () => {
    render(<App />);
    const user = await selectTwo();
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeEnabled();
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
    expect(screen.getByText(/No video clips/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeDisabled();
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
      await user.click(screen.getByRole('button', { name: /render mp4/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        mode === 'error' ? /queue is full/ : /connect|network|reach/i,
      );
      expect(
        within(screen.getByRole('region', { name: 'Media' })).getByText(
          'first.mp4',
        ),
      ).toBeVisible();
    },
  );
  it(
    'shows completed preview and download, then starts fresh',
    { timeout: 15000 },
    async () => {
      vi.mocked(URL.createObjectURL)
        .mockReturnValueOnce('blob:reset-first')
        .mockReturnValueOnce('blob:reset-second');
      render(<App />);
      const user = await selectTwo();
      await user.click(
        screen.getByRole('button', { name: 'Move second.mov up' }),
      );
      await user.click(screen.getByRole('button', { name: /render mp4/i }));
      expect(await screen.findByText('MP4 ready')).toBeVisible();
      expect(screen.getByLabelText('Merged video preview')).toHaveAttribute(
        'src',
        `/api/jobs/${job.job_id}/video`,
      );
      expect(
        screen.getByRole('link', { name: /download mp4/i }),
      ).toHaveAttribute('href', `/api/jobs/${job.job_id}/download`);
      await user.click(screen.getByRole('button', { name: /new project/i }));
      expect(screen.getByText(/No video clips/i)).toBeVisible();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reset-first');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reset-second');
    },
  );
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
    await user.click(screen.getByRole('button', { name: /render mp4/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One clip could not be read.',
    );
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeEnabled();
  });
  it('retries status without creating a second merge', async () => {
    serve('pollError');
    render(<App />);
    const user = await selectTwo();
    await user.click(
      screen.getByRole('button', { name: 'Move second.mov up' }),
    );
    await user.click(screen.getByRole('button', { name: /render mp4/i }));
    await user.click(
      await screen.findByRole('button', { name: /retry status/i }),
    );
    expect(await screen.findByText('MP4 ready')).toBeVisible();
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
  }, 15_000);

  it('marks a saved trim as manual in the merge manifest', async () => {
    render(<App />);
    const user = await selectTwo();
    await user.click(screen.getByRole('button', { name: 'Trim first.mp4' }));
    fireEvent.change(screen.getByLabelText(/trim end frame/i), {
      target: { value: '39' },
    });
    await user.click(screen.getByRole('button', { name: /save trim/i }));
    await user.click(screen.getByRole('button', { name: /render mp4/i }));
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
    expect(
      within(
        screen.getByRole('region', { name: 'Background audio' }),
      ).getByText('theme.mp3'),
    ).toBeVisible();
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
    await user.click(screen.getByRole('button', { name: /render mp4/i }));
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
    expect(screen.getByRole('button', { name: /render mp4/i })).toBeDisabled();
  });
});
