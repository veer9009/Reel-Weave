import type { ClipEdit, Limits, MergeManifest } from './clips';
import type { buildAdvancedMergeRequest } from './advancedManifest';
import type { V3MergeRequest, V4MergeRequest } from './advancedManifest';
import { validateManifestSize } from './advancedManifest';

export type ExportFormat = 'mp4' | 'mov' | 'wav' | 'mp3';
export type ExportState = {
  status: 'queued' | 'processing' | 'ready' | 'failed';
  error: string | null;
  download_url?: string;
};

export type Job = {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error: string | null;
  exports?: Partial<Record<ExportFormat, ExportState>>;
};
export type Health = {
  status: string;
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  limits: Limits;
  export_capabilities?: Partial<Record<ExportFormat, boolean>>;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public lane?: string,
    public segmentId?: string,
    public sourceId?: string,
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
      'Could not reach AVStudio. Check your connection and make sure the backend is running.',
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
  if (!response.ok) {
    const lane = body?.error?.lane ?? body?.error?.track;
    throw new ApiError(
      typeof body?.error?.message === 'string'
        ? body.error.message
        : 'Something went wrong. Please try again.',
      response.status,
      typeof body?.error?.code === 'string' ? body.error.code : undefined,
      lane === 'independent_audio'
        ? 'independent'
        : typeof lane === 'string'
          ? lane
          : undefined,
      typeof body?.error?.segment_id === 'string'
        ? body.error.segment_id
        : undefined,
      typeof body?.error?.source_id === 'string'
        ? body.error.source_id
        : undefined,
    );
  }
  return body as T;
}
export const getHealth = (signal?: AbortSignal) =>
  request<Health>('/api/health', {
    signal: signal ?? AbortSignal.timeout(15000),
  });
export const getJob = (id: string, signal?: AbortSignal) =>
  request<Job>(`/api/jobs/${encodeURIComponent(id)}`, { signal });
export type MergeUploads = {
  backgroundAudio?: File;
  overlayImage?: File;
  overlayVideo?: File;
};
export function submitMerge(
  clips: ClipEdit[],
  manifest: MergeManifest,
  uploads: MergeUploads = {},
  signal?: AbortSignal,
): Promise<Job> {
  const body = new FormData();
  clips.forEach((clip) => body.append('files', clip.file));
  body.append('manifest', JSON.stringify(manifest));
  if (uploads.backgroundAudio)
    body.append('background_audio', uploads.backgroundAudio);
  if (uploads.overlayImage) body.append('overlay_image', uploads.overlayImage);
  if (uploads.overlayVideo) body.append('overlay_video', uploads.overlayVideo);
  return request<Job>('/api/merge', { method: 'POST', body, signal });
}
export function submitAdvancedMerge(
  render: ReturnType<typeof buildAdvancedMergeRequest>,
  signal?: AbortSignal,
): Promise<Job> {
  const body = new FormData();
  render.videoFiles.forEach((file) => body.append('files', file));
  body.append('manifest', JSON.stringify(render.manifest));
  if (render.uploads.backgroundAudio)
    body.append('background_audio', render.uploads.backgroundAudio);
  if (render.uploads.overlayImage)
    body.append('overlay_image', render.uploads.overlayImage);
  if (render.uploads.overlayVideo)
    body.append('overlay_video', render.uploads.overlayVideo);
  return request<Job>('/api/merge', { method: 'POST', body, signal });
}

export function submitV3Merge(
  render: V3MergeRequest | V4MergeRequest,
  signal?: AbortSignal,
): Promise<Job> {
  const json = JSON.stringify(render.manifest);
  validateManifestSize(json);
  const body = new FormData();
  render.videoFiles.forEach((file) => body.append('files', file));
  render.audioFiles.forEach((file) => body.append('audio_files', file));
  body.append('manifest', json);
  if (render.uploads.overlayImage)
    body.append('overlay_image', render.uploads.overlayImage);
  if (render.uploads.overlayVideo)
    body.append('overlay_video', render.uploads.overlayVideo);
  return request<Job>('/api/merge', { method: 'POST', body, signal });
}

export function submitV4Merge(
  render: V4MergeRequest,
  signal?: AbortSignal,
): Promise<Job> {
  return submitV3Merge(render, signal);
}
