import { beforeEach, expect, it, vi } from 'vitest';
import { preparePreviewAudioRecipe } from './previewAudioRecipe';
vi.mock('./api', () => ({ apiUrl: (path: string) => path }));
const recipe = {
  kind: 'video-edit' as const,
  sourceId: 'camera',
  sourceStartFrame: 10,
  sourceEndFrame: 59,
  speed: 0.5 as const,
  normalizationFps: 60 as const,
};
const source = {
  file: new File(['video'], 'camera.mp4'),
  metadata: { fps: 25 },
};
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('pcm', { headers: { 'Content-Type': 'audio/wav' } }),
    ),
  );
});
it('requests precisely the frozen recipe from the audio-only preparation route', async () => {
  const signal = new AbortController().signal;
  const audio = await preparePreviewAudioRecipe(source, recipe, signal);
  expect(await audio.text()).toBe('pcm');
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('/api/preview-audio');
  expect(init?.signal).toBe(signal);
  const body = init!.body as FormData;
  const manifest = JSON.parse(body.get('manifest') as string);
  expect((body.get('files') as File).name).toBe('camera.mp4');
  expect(manifest.clips[0]).toMatchObject({
    start_frame: 10,
    end_frame: 59,
    speed: 0.5,
    duration_frames: 240,
    output_out_frame: 240,
  });
  expect(manifest.audio.original_volume).toBe(1);
});
it('surfaces a preparation error rather than caching invalid sound', async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ error: { message: 'bad source' } }), {
      status: 422,
    }),
  );
  await expect(
    preparePreviewAudioRecipe(source, recipe, new AbortController().signal),
  ).rejects.toThrow('bad source');
});
it('does not upload an already cancelled project', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    preparePreviewAudioRecipe(source, recipe, controller.signal),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
