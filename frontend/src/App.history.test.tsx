import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import App from './App';
import type { MergeManifest } from './lib/clips';
let submitted: FormData | null;
let maxClips = 20;
beforeEach(() => {
  submitted = null;
  maxClips = 20;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/health'))
        return new Response(
          JSON.stringify({
            ffmpeg_available: true,
            ffprobe_available: true,
            limits: { max_clips: maxClips, max_file_size_mb: 200 },
          }),
        );
      submitted = init!.body as FormData;
      return new Response(
        JSON.stringify({ error: { code: 'busy', message: 'Delivery failed' } }),
        { status: 503 },
      );
    }),
  );
});
async function ready(names = ['a.mp4', 'b.mp4']) {
  await waitFor(() =>
    expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
  );
  const files = names.map((n) => new File(['video'], n, { type: 'video/mp4' }));
  fireEvent.change(screen.getByLabelText('Choose video clips'), {
    target: {
      files,
    },
  });
  document.querySelectorAll('.clip-thumbnail video').forEach((v) => {
    Object.defineProperties(v, {
      duration: { configurable: true, value: 2 },
      videoWidth: { configurable: true, value: 1280 },
      videoHeight: { configurable: true, value: 720 },
    });
    fireEvent.loadedMetadata(v);
  });
  return files;
}
const undo = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
const redo = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
describe('App edit history', { timeout: 30000 }, () => {
  it('split_history restores exact identities and inclusive ranges', async () => {
    render(<App />);
    await ready(['a.mp4']);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
    );
    fireEvent.change(screen.getByLabelText('Timeline position'), {
      target: { value: '19' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Split at playhead' }));
    expect(document.querySelectorAll('.clip-item')).toHaveLength(2);
    undo();
    expect(document.querySelectorAll('.clip-item')).toHaveLength(1);
    redo();
    expect(document.querySelectorAll('.clip-item')).toHaveLength(2);
  });
  it('version_replace_history restores donor order', async () => {
    render(<App />);
    await ready();
    const ids = Array.from(
      document.querySelectorAll<HTMLElement>('.clip-item'),
      (e) => e.dataset.clipId!,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview clip 2: b.mp4' }),
    );
    fireEvent.change(screen.getByLabelText('Timeline position'), {
      target: { value: '79' },
    });
    fireEvent.change(screen.getByLabelText('Version 2 source'), {
      target: { value: ids[0] },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace after playhead' }),
    );
    undo();
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('.clip-item'),
        (e) => e.dataset.clipId,
      ),
    ).toEqual(ids);
    redo();
    expect(document.querySelectorAll('.clip-item')).toHaveLength(2);
  });
  it('history_toolbar remains visible and disabled without edits', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Y Control+Shift+Z',
    );
  });
  it('ripple_delete_history restores final clip without selection', async () => {
    render(<App />);
    await ready(['a.mp4']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.mp4' }));
    expect(
      screen.queryByRole('button', { name: 'Preview clip 1: a.mp4' }),
    ).toBeNull();
    undo();
    expect(
      screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
    ).toBeInTheDocument();
    redo();
    expect(
      screen.queryByRole('button', { name: 'Preview clip 1: a.mp4' }),
    ).toBeNull();
  });
  it('reorder_history restores order and import rebasing preserves new clips', async () => {
    render(<App />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Move b.mp4 up' }));
    expect(
      screen.getByRole('button', { name: 'Preview clip 1: b.mp4' }),
    ).toBeInTheDocument();
    await ready(['c.mp4']);
    undo();
    expect(
      screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Preview clip 3: c.mp4' }),
    ).toBeInTheDocument();
  });
  it('saved_trim_history includes the saved flag and Cancel does not record', async () => {
    render(<App />);
    await ready(['a.mp4']);
    fireEvent.click(screen.getByRole('button', { name: 'Trim a.mp4' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Save trim/ }));
    undo();
    redo();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });
  it('audio_history and fps_history restore visible settings', async () => {
    render(<App />);
    await ready(['a.mp4']);
    fireEvent.change(
      screen.getByLabelText('Original audio volume', { selector: 'input' }),
      { target: { value: '50' } },
    );
    undo();
    expect(
      screen.getByLabelText('Original audio volume', { selector: 'input' }),
    ).toHaveValue('100');
    redo();
    expect(
      screen.getByLabelText('Original audio volume', { selector: 'input' }),
    ).toHaveValue('50');
    fireEvent.change(screen.getByLabelText('Timeline FPS'), {
      target: { value: '25' },
    });
    undo();
    expect(screen.getByLabelText('Timeline FPS')).toHaveValue('auto');
    redo();
    expect(screen.getByLabelText('Timeline FPS')).toHaveValue('25');
  });
  it('history_delivery serializes current files and exact IDs after Undo and Redo; delivery errors survive', async () => {
    render(<App />);
    await ready();
    const ids = Array.from(
      document.querySelectorAll<HTMLElement>('.clip-item'),
      (e) => e.dataset.clipId!,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move b.mp4 up' }));
    undo();
    fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
    await screen.findByText('Delivery failed');
    let manifest = JSON.parse(
      String(submitted!.get('manifest')),
    ) as MergeManifest;
    expect(manifest.order).toEqual(ids);
    expect(submitted!.getAll('files').map((f) => (f as File).name)).toEqual([
      'a.mp4',
      'b.mp4',
    ]);
    expect(
      manifest.clips.map((c) => [
        c.start_frame,
        c.end_frame,
        c.speed,
        c.trim_saved,
      ]),
    ).toEqual([
      [0, 59, 1, false],
      [0, 59, 1, false],
    ]);
    redo();
    expect(screen.getByRole('alert')).toHaveTextContent('Delivery failed');
    fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
    await waitFor(() =>
      expect(JSON.parse(String(submitted!.get('manifest'))).order).toEqual(
        [...ids].reverse(),
      ),
    );
    manifest = JSON.parse(String(submitted!.get('manifest')));
    expect(manifest.output_fps).toBe(30);
    expect(submitted!.getAll('files').map((f) => (f as File).name)).toEqual([
      'b.mp4',
      'a.mp4',
    ]);
  });
  it('pip_history preserves committed placement during replacement and round trips settings/removal', async () => {
    render(<App />);
    await ready(['a.mp4']);
    fireEvent.change(screen.getByLabelText('Choose video overlay'), {
      target: { files: [new File(['p'], 'pip.mp4')] },
    });
    expect(
      screen.queryByRole('button', { name: 'Select PIP overlay: pip.mp4' }),
    ).toBeNull();
    const candidate = screen.getByLabelText('Loading PIP candidate');
    Object.defineProperty(candidate, 'duration', { value: 2 });
    fireEvent.loadedMetadata(candidate);
    fireEvent.change(screen.getByLabelText('Video overlay position'), {
      target: { value: 'top-left' },
    });
    fireEvent.change(screen.getByLabelText('Video overlay size'), {
      target: { value: 'large' },
    });
    undo();
    expect(screen.getByLabelText('Video overlay size')).toHaveValue('medium');
    redo();
    expect(screen.getByLabelText('Video overlay size')).toHaveValue('large');
    fireEvent.change(screen.getByLabelText('Replace video overlay'), {
      target: { files: [new File(['p'], 'replacement.mp4')] },
    });
    expect(
      screen.getByRole('button', { name: 'Select PIP overlay: pip.mp4' }),
    ).toBeInTheDocument();
    fireEvent.error(screen.getByLabelText('Loading PIP candidate'));
    expect(
      screen.getByRole('button', { name: 'Select PIP overlay: pip.mp4' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove pip.mp4' }));
    undo();
    expect(screen.getByLabelText('Video overlay position')).toHaveValue(
      'top-left',
    );
    redo();
    expect(
      screen.queryByRole('button', { name: 'Select PIP overlay: pip.mp4' }),
    ).toBeNull();
  });
  it('history_shortcuts match toolbar and selection/transport do not clear Redo', async () => {
    render(<App />);
    await ready(['a.mp4']);
    fireEvent.click(screen.getByLabelText('Mute original audio'));
    fireEvent.keyDown(document, { key: 'Z', ctrlKey: true });
    expect(screen.getByLabelText('Mute original audio')).not.toBeChecked();
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
    );
    fireEvent.change(screen.getByLabelText('Timeline position'), {
      target: { value: '19' },
    });
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByLabelText('Mute original audio')).toBeChecked();
    undo();
    fireEvent.keyDown(document, { key: 'y', ctrlKey: true });
    expect(screen.getByLabelText('Mute original audio')).toBeChecked();
  });
  it('delayed source metadata updates its registered source even after deletion', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Choose video clips'), {
      target: { files: [new File(['v'], 'late.mp4')] },
    });
    const video = document.querySelector<HTMLVideoElement>(
      '.clip-thumbnail video',
    )!;
    let callback: VideoFrameRequestCallback | undefined;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      videoWidth: { configurable: true, value: 1280 },
      videoHeight: { configurable: true, value: 720 },
      requestVideoFrameCallback: {
        configurable: true,
        value: (next: VideoFrameRequestCallback) => {
          callback = next;
          return 1;
        },
      },
      cancelVideoFrameCallback: { configurable: true, value: vi.fn() },
    });
    fireEvent.loadedMetadata(video);
    fireEvent.click(screen.getByRole('button', { name: 'Remove late.mp4' }));
    await act(async () => {
      for (let i = 0; i < 6; i++)
        callback!(i, { mediaTime: i / 30 } as VideoFrameCallbackMetadata);
    });
    undo();
    expect(screen.getByRole('button', { name: 'Render MP4' })).toBeEnabled();
  });
  it('split preserves the selected source identity when the same File is imported twice', async () => {
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce('blob:first-source')
      .mockReturnValueOnce('blob:second-source');
    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
    );
    const file = new File(['video'], 'same.mp4');
    fireEvent.change(screen.getByLabelText('Choose video clips'), {
      target: { files: [file, file] },
    });
    document.querySelectorAll('.clip-thumbnail video').forEach((v) => {
      Object.defineProperties(v, {
        duration: { configurable: true, value: 2 },
        videoWidth: { configurable: true, value: 1280 },
        videoHeight: { configurable: true, value: 720 },
      });
      fireEvent.loadedMetadata(v);
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview clip 2: same.mp4' }),
    );
    fireEvent.change(screen.getByLabelText('Timeline position'), {
      target: { value: '79' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Split at playhead' }));
    expect(
      Array.from(document.querySelectorAll('.clip-thumbnail video'), (v) =>
        v.getAttribute('src'),
      ),
    ).toEqual([
      'blob:first-source',
      'blob:second-source',
      'blob:second-source',
    ]);
  });
  it('pure audio Undo does not seek the current preview', async () => {
    render(<App />);
    await ready(['a.mp4']);
    const preview = screen.getByLabelText('Uploaded clip preview');
    const seek = vi.fn();
    Object.defineProperties(preview, {
      duration: { configurable: true, value: 2 },
      currentTime: { configurable: true, get: () => 0, set: seek },
    });
    fireEvent.loadedMetadata(preview);
    fireEvent.click(screen.getByLabelText('Mute original audio'));
    seek.mockClear();
    undo();
    expect(seek).not.toHaveBeenCalled();
  });
  it('a blocked restoration keeps delivery errors and the current project intact', async () => {
    maxClips = 2;
    render(<App />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.mp4' }));
    await ready(['c.mp4']);
    const ids = Array.from(
      document.querySelectorAll<HTMLElement>('.clip-item'),
      (e) => e.dataset.clipId,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
    await screen.findByText('Delivery failed');
    undo();
    expect(screen.getByText('Delivery failed')).toBeInTheDocument();
    expect(
      screen.getByText('Clip limit prevents restoring this edit.'),
    ).toBeInTheDocument();
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('.clip-item'),
        (e) => e.dataset.clipId,
      ),
    ).toEqual(ids);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
  it('history_delivery uses original Files and current split ranges, speed, mix, PIP and FPS', async () => {
    render(<App />);
    const files = await ready();
    fireEvent.change(screen.getByLabelText('Speed for a.mp4'), {
      target: { value: '0.5' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
    );
    fireEvent.change(screen.getByLabelText('Timeline position'), {
      target: { value: '39' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Split at playhead' }));
    const ids = Array.from(
      document.querySelectorAll<HTMLElement>('.clip-item'),
      (e) => e.dataset.clipId!,
    );
    fireEvent.change(
      screen.getByLabelText('Original audio volume', { selector: 'input' }),
      { target: { value: '50' } },
    );
    fireEvent.click(screen.getByLabelText('Mute original audio'));
    fireEvent.change(screen.getByLabelText('Choose video overlay'), {
      target: { files: [new File(['p'], 'p.mp4')] },
    });
    const probe = screen.getByLabelText('Loading PIP candidate');
    Object.defineProperty(probe, 'duration', { value: 2 });
    fireEvent.loadedMetadata(probe);
    fireEvent.change(screen.getByLabelText('Video overlay end frame'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText('Video overlay position'), {
      target: { value: 'top-left' },
    });
    fireEvent.change(screen.getByLabelText('Timeline FPS'), {
      target: { value: '25' },
    });
    undo();
    for (const fps of [30, 25]) {
      fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
      await screen.findByText('Delivery failed');
      const manifest = JSON.parse(
        String(submitted!.get('manifest')),
      ) as MergeManifest;
      expect(manifest.order).toEqual(ids);
      expect(manifest.clips).toEqual([
        {
          client_id: ids[0],
          start_frame: 0,
          end_frame: 19,
          speed: 0.5,
          trim_saved: true,
        },
        {
          client_id: ids[1],
          start_frame: 20,
          end_frame: 59,
          speed: 0.5,
          trim_saved: true,
        },
        {
          client_id: ids[2],
          start_frame: 0,
          end_frame: 59,
          speed: 1,
          trim_saved: false,
        },
      ]);
      const uploads = submitted!.getAll('files');
      expect(uploads[0]).toBe(files[0]);
      expect(uploads[1]).toBe(files[0]);
      expect(uploads[2]).toBe(files[1]);
      expect(manifest.output_fps).toBe(fps);
      expect(manifest.audio).toEqual({
        original_volume: 0.5,
        original_muted: true,
        music_volume: 0.3,
        music_muted: false,
      });
      expect(manifest.overlays.video).toEqual({
        start_frame: 0,
        end_frame: 100,
        position: 'top-left',
        size: 'medium',
      });
      if (fps === 30) redo();
    }
  });
});
