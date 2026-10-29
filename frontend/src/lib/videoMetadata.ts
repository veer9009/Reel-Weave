import { apiUrl } from './api';
import type { ClipMetadata } from './clips';

export async function inspectVideoMetadata(
  file: File,
  signal: AbortSignal,
): Promise<ClipMetadata | null> {
  signal.throwIfAborted();
  const body = new FormData();
  body.append('files', file);
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/video-metadata'), {
      method: 'POST',
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
  } catch (error) {
    signal.throwIfAborted();
    // Preserve local playback when the backend is unavailable.
    if (error instanceof TypeError) return null;
    throw error;
  }
  if (response.status === 404 || response.status === 503) return null;
  if (!response.ok) throw new Error('Could not inspect video metadata.');
  const value = (await response.json()) as ClipMetadata;
  signal.throwIfAborted();
  if (
    !value ||
    value.source !== 'backend' ||
    ![value.fps, value.duration, value.width, value.height].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    !Number.isSafeInteger(value.totalFrames) ||
    value.totalFrames < 1
  )
    throw new Error('Invalid video metadata.');
  return value;
}
