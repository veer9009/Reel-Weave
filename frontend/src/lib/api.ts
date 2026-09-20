import type { ClipEdit, Limits, MergeManifest } from './clips';

export type Job = {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error: string | null;
};
export type Health = {
  status: string;
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  limits: Limits;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export const apiUrl = (path: string) => `${base}${path}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    throw new ApiError(
      'Could not reach ReelWeave. Check your connection and make sure the backend is running.',
      0,
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      'The server returned an unexpected response. Please try again.',
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      typeof body?.error?.message === 'string'
        ? body.error.message
        : 'Something went wrong. Please try again.',
      response.status,
    );
  return body as T;
}
export const getHealth = (signal?: AbortSignal) =>
  request<Health>('/api/health', {
    signal: signal ?? AbortSignal.timeout(15000),
  });
export const getJob = (id: string, signal?: AbortSignal) =>
  request<Job>(`/api/jobs/${encodeURIComponent(id)}`, { signal });
export function submitMerge(
  clips: ClipEdit[],
  manifest: MergeManifest,
  backgroundAudio?: File,
  signal?: AbortSignal,
): Promise<Job> {
  const body = new FormData();
  clips.forEach((clip) => body.append('files', clip.file));
  body.append('manifest', JSON.stringify(manifest));
  if (backgroundAudio) body.append('background_audio', backgroundAudio);
  return request<Job>('/api/merge', { method: 'POST', body, signal });
}
