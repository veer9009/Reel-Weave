import { beforeEach, expect, it, vi } from 'vitest';
import { inspectVideoMetadata } from './videoMetadata';
vi.mock('./api', () => ({ apiUrl: (path: string) => path }));
const file = new File(['actual-video-bytes'], 'portrait.mp4', {
  type: 'video/mp4',
});
const metadata = {
  duration: 169 / 30,
  fps: 30,
  totalFrames: 169,
  width: 478,
  height: 850,
  source: 'backend',
};
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(metadata))),
  ),
);
it('uploads original bytes and returns decoded source bounds', async () => {
  expect(
    await inspectVideoMetadata(file, new AbortController().signal),
  ).toEqual(metadata);
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('/api/video-metadata');
  const uploaded = (init!.body as FormData).get('files') as File;
  expect(uploaded.name).toBe('portrait.mp4');
  expect(uploaded.size).toBe(18);
});
it('does not silently restore browser frame estimates when a busy probe times out', async () => {
  vi.mocked(fetch).mockRejectedValue(
    new DOMException('probe timed out', 'TimeoutError'),
  );
  await expect(
    inspectVideoMetadata(file, new AbortController().signal),
  ).rejects.toThrow('probe timed out');
});
it('does not upload metadata for a cancelled source', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(inspectVideoMetadata(file, controller.signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([404, 503])(
  'retains local playback compatibility for an unavailable backend (%s)',
  async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status }));
    expect(
      await inspectVideoMetadata(file, new AbortController().signal),
    ).toBeNull();
  },
);
it('rejects malformed authoritative frame bounds', async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ ...metadata, totalFrames: 0 })),
  );
  await expect(
    inspectVideoMetadata(file, new AbortController().signal),
  ).rejects.toThrow('Invalid video metadata');
});
