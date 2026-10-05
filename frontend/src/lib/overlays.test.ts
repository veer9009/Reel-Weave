import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitMerge } from './api';
import {
  defaultOverlaySchedule,
  projectFrameCount,
  projectTotalFrames,
  validateOverlaySchedule,
} from './overlays';
import type { ClipEdit, MergeManifest } from './clips';

const clip = (frames: number, fps: number, speed: 1 | 0.75 | 0.5) =>
  ({
    id: crypto.randomUUID(),
    file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
    url: 'blob:clip',
    metadataStatus: 'ready',
    metadata: {
      duration: frames / fps,
      fps,
      totalFrames: frames,
      width: 1280,
      height: 720,
      source: 'browser',
    },
    trim: { startFrame: 0, endFrame: frames - 1 },
    trimSaved: true,
    speed,
  }) as ClipEdit;

describe('overlay project data', () => {
  it('uses explicit half-up frame rounding and a one-frame minimum', () => {
    expect(projectFrameCount(5, 2, 1, 1)).toBe(3);
    expect(projectFrameCount(1, 60, 1, 24)).toBe(1);
    expect(projectFrameCount(30, 30, 0.5, 30)).toBe(60);
    expect(projectTotalFrames([clip(30, 30, 1), clip(30, 30, 0.5)], 30)).toBe(
      90,
    );
  });

  it('creates kind-specific full-timeline defaults', () => {
    expect(defaultOverlaySchedule('image', 90)).toEqual({
      startFrame: 0,
      endFrame: 89,
      position: 'top-right',
      size: 'small',
    });
    expect(defaultOverlaySchedule('video', 90)).toEqual({
      startFrame: 0,
      endFrame: 89,
      position: 'bottom-right',
      size: 'medium',
    });
  });

  it('validates inclusive first, final, and one-frame ranges', () => {
    expect(
      validateOverlaySchedule(
        { startFrame: 0, endFrame: 0, position: 'centre', size: 'large' },
        10,
      ),
    ).toBeNull();
    expect(
      validateOverlaySchedule(
        { startFrame: 9, endFrame: 9, position: 'centre', size: 'large' },
        10,
      ),
    ).toBeNull();
    expect(
      validateOverlaySchedule(
        { startFrame: 0, endFrame: 10, position: 'centre', size: 'large' },
        10,
      ),
    ).toMatch(/outside/i);
    expect(
      validateOverlaySchedule(
        { startFrame: 2, endFrame: 1, position: 'centre', size: 'large' },
        10,
      ),
    ).toMatch(/start/i);
  });
});

describe('overlay multipart submission', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('appends optional files under distinct names and not primary files', async () => {
    let body: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        body = init?.body as FormData;
        return new Response(
          JSON.stringify({ job_id: 'job', status: 'queued', error: null }),
        );
      }),
    );
    const primary = clip(30, 30, 1);
    const manifest = {
      output_fps: 30,
      order: [primary.id],
      clips: [],
      overlays: { image: null, video: null },
      audio: {
        original_volume: 1,
        original_muted: false,
        music_volume: 0.3,
        music_muted: false,
      },
    } as MergeManifest;
    await submitMerge([primary], manifest, {
      backgroundAudio: new File(['music'], 'music.mp3'),
      overlayImage: new File(['image'], 'logo.png'),
      overlayVideo: new File(['pip'], 'pip.mp4'),
    });

    expect(body?.getAll('files')).toEqual([primary.file]);
    expect((body?.get('background_audio') as File).name).toBe('music.mp3');
    expect((body?.get('overlay_image') as File).name).toBe('logo.png');
    expect((body?.get('overlay_video') as File).name).toBe('pip.mp4');
  });
});
