import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it, vi, beforeEach } from 'vitest';
import App from './App';
import type { AdvancedMergeManifest } from './lib/advancedManifest';
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ffmpeg_available: true,
            ffprobe_available: true,
            export_capabilities: { mp4: true, mov: true, wav: true, mp3: true },
            limits: {
              max_clips: 10,
              max_file_size_mb: 200,
              max_audio_file_size_mb: 100,
            },
          }),
        ),
    ),
  ),
);
async function readyBase() {
  render(<App />);
  await waitFor(() =>
    expect(screen.getByLabelText('Choose video clips')).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Choose video clips'), {
    target: { files: [new File(['base'], 'base.mp4')] },
  });
  const video = document.querySelector('.clip-thumbnail video')!;
  Object.defineProperties(video, {
    duration: { value: 6 },
    videoWidth: { value: 320 },
    videoHeight: { value: 180 },
  });
  fireEvent.loadedMetadata(video);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Render MP4' })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Timeline FPS'), {
    target: { value: '25' },
  });
}
it('detached_v3_submission_freezes_formats_and_New_Project_restores_defaults', async () => {
  await readyBase();
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview clip 1: base.mp4' }),
  );
  fireEvent.keyDown(document, { key: 'l', ctrlKey: true, altKey: true });
  fireEvent.click(screen.getByLabelText('WAV'));
  fireEvent.click(screen.getByLabelText('MP3'));
  let body: FormData | undefined,
    resolve: (response: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, init) => {
      body = init.body;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  await waitFor(() => expect(body).toBeDefined());
  const manifest = JSON.parse(body!.get('manifest') as string);
  expect(manifest.schema_version).toBe(3);
  expect(manifest.exports).toEqual(['mp4', 'wav', 'mp3']);
  expect(manifest.clips[0].original_audio).toBe('detached');
  expect(manifest.independent_audio).toHaveLength(1);
  expect(body!.getAll('files')).toHaveLength(1);
  expect(body!.has('background_audio')).toBe(false);
  expect(screen.getByLabelText('WAV')).toBeDisabled();
  resolve(
    new Response(
      JSON.stringify({
        job_id: 'v3',
        status: 'completed',
        error: null,
        exports: {
          mp4: { status: 'ready', error: null },
          wav: { status: 'ready', error: null },
          mp3: { status: 'failed', error: 'MP3 encoding failed.' },
        },
      }),
    ),
  );
  await screen.findByRole('link', { name: 'Download WAV' });
  expect(screen.getByText(/MP3 encoding failed/)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Download MP3' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New project' }));
  expect(screen.getByLabelText('WAV')).not.toBeChecked();
  expect(screen.getByLabelText('MP3')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Render MP4' })).toBeDisabled();
}, 30000);
it('replacement_pointer_move_commits_through_history_and_undo_restores_position', async () => {
  await readyBase();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 150,
    left: 0,
  } as DOMRect);
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '40' },
  });
  fireEvent.change(screen.getByLabelText('Choose replacement video'), {
    target: { files: [new File(['take'], 'take.mp4')] },
  });
  const probe = screen.getByLabelText('Loading replacement candidate');
  Object.defineProperties(probe, {
    duration: { value: 2.4 },
    videoWidth: { value: 320 },
    videoHeight: { value: 180 },
  });
  fireEvent.loadedMetadata(probe);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save replacement' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save replacement' }));
  const take = screen.getByRole('button', { name: /Select Video 2 take.mp4/ });
  fireEvent.pointerDown(take, { button: 0, clientX: 40 });
  fireEvent.pointerMove(take, { clientX: 50 });
  fireEvent.pointerUp(take);
  expect(
    screen.getByRole('button', {
      name: /Select Video 2 take.mp4.*frames 50–109/,
    }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(
    screen.getByRole('button', {
      name: /Select Video 2 take.mp4.*frames 40–99/,
    }),
  ).toBeInTheDocument();
}, 30000);
it('replacement_add_split_ripple_and_undo_preserve_separate_PIP_track', async () => {
  await readyBase();
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '40' },
  });
  fireEvent.change(screen.getByLabelText('Choose replacement video'), {
    target: { files: [new File(['take'], 'take.mp4')] },
  });
  const video = screen.getByLabelText('Loading replacement candidate');
  Object.defineProperties(video, {
    duration: { value: 2.4 },
    videoWidth: { value: 320 },
    videoHeight: { value: 180 },
  });
  fireEvent.loadedMetadata(video);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save replacement' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save replacement' }));
  fireEvent.click(
    screen.getByRole('button', { name: /Select Video 2 take.mp4/ }),
  );
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '60' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Split Video' }));
  expect(
    within(screen.getByRole('region', { name: 'VIDEO 2' })).getAllByRole(
      'button',
      { name: /Select Video 2/ },
    ),
  ).toHaveLength(2);
  fireEvent.keyDown(document, { key: 'Delete' });
  expect(
    within(screen.getByRole('region', { name: 'VIDEO 2' })).getAllByRole(
      'button',
      { name: /Select Video 2/ },
    ),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(
    within(screen.getByRole('region', { name: 'VIDEO 2' })).getAllByRole(
      'button',
      { name: /Select Video 2/ },
    ),
  ).toHaveLength(2);
  expect(
    screen.getByRole('region', { name: 'Overlay/PIP' }),
  ).toBeInTheDocument();
}, 30000);
it('render_after_undo_redo_submits_exact_music_segments_and_unique_current_sources', async () => {
  await readyBase();
  fireEvent.change(screen.getByLabelText('Choose background audio'), {
    target: { files: [new File(['song'], 'song.wav')] },
  });
  const audio = document.querySelector('audio')!;
  Object.defineProperty(audio, 'duration', { value: 2.4 });
  fireEvent.loadedMetadata(audio);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Select Background music/ }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Select Background music/ }),
  );
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '25' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Split Audio' }));
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '40' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Split Audio' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: /Select Background music.*frames 25–39/,
    }),
  );
  fireEvent.keyDown(document, { key: 'Delete' });
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  let body: FormData | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, init) => {
      body = init.body;
      return new Response(
        JSON.stringify({ error: { message: 'Render unavailable' } }),
        { status: 503 },
      );
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  await waitFor(() => expect(body).not.toBeNull());
  const submitted = body! as FormData;
  const manifest = JSON.parse(
    submitted.get('manifest') as string,
  ) as AdvancedMergeManifest;
  expect(manifest.schema_version).toBe(2);
  expect(
    manifest.music!.segments.map((v) => [
      v.timeline_start_frame,
      v.source_start_sample,
      v.duration_frames,
    ]),
  ).toEqual([
    [0, 0, 25],
    [25, 76800, 20],
  ]);
  expect(submitted.getAll('files')).toHaveLength(1);
  expect((submitted.get('background_audio') as File).name).toBe('song.wav');
}, 30000);
it('base_trim_draft_blocks_render_submission', async () => {
  await readyBase();
  fireEvent.click(screen.getByRole('button', { name: 'Trim base.mp4' }));
  expect(screen.getByRole('button', { name: 'Render MP4' })).toBeDisabled();
}, 30000);
it('music_middle_split_delete_ripples_only_music', async () => {
  await readyBase();
  fireEvent.change(screen.getByLabelText('Choose background audio'), {
    target: { files: [new File(['song'], 'song.wav')] },
  });
  const audio = document.querySelector('audio')!;
  Object.defineProperty(audio, 'duration', { value: 2.4 });
  fireEvent.loadedMetadata(audio);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Select Background music/ }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Select Background music/ }),
  );
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '25' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Split Audio' }));
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '40' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Split Audio' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: /Select Background music.*frames 25–39/,
    }),
  );
  fireEvent.keyDown(document, { key: 'Delete' });
  expect(
    screen.getByRole('button', {
      name: /Select Background music.*frames 25–44/,
    }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Timeline position')).toHaveAttribute(
    'max',
    '149',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(
    screen.getByRole('button', {
      name: /Select Background music.*frames 25–39/,
    }),
  ).toBeInTheDocument();
}, 30000);
it('music_selection_reveals_its_range_when_replacement_inspector_is_collapsed', async () => {
  await readyBase();
  fireEvent.change(screen.getByLabelText('Choose background audio'), {
    target: { files: [new File(['song'], 'song.wav')] },
  });
  const audio = document.querySelector('audio')!;
  Object.defineProperty(audio, 'duration', { value: 2 });
  fireEvent.loadedMetadata(audio);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Select Background music/ }),
    ).toBeInTheDocument(),
  );
  const details = within(
    screen.getByRole('complementary', { name: 'Inspector' }),
  )
    .getByText('Video 2 — Replacement')
    .closest('details')!;
  details.open = false;
  fireEvent.click(
    screen.getByRole('button', { name: /Select Background music/ }),
  );
  expect(screen.getByLabelText('Timeline start frame')).toBeVisible();
}, 30000);
