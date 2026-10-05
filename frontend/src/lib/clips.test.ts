import { describe, it, expect } from 'vitest';
import {
  buildMergeManifest,
  formatTimestamp,
  outputDuration,
  selectedFrameCount,
  selectedSourceDuration,
  validateTrim,
  validateSelection,
  moveClip,
  formatSize,
  formatDuration,
  estimateFrameRate,
  frameCountFromDuration,
  resolveProjectFps,
} from './clips';
import type { ClipEdit } from './clips';
const file = (name: string, size = 1) =>
  new File([new Uint8Array(size)], name, { type: 'video/mp4' });
const limits = { max_clips: 10, max_file_size_mb: 200 };
describe('clip selection', () => {
  it('accepts all supported extensions regardless of browser MIME', () =>
    expect(
      validateSelection(
        [file('a.MP4'), file('b.mov'), file('c.webm'), file('d.mkv')],
        0,
        limits,
      ),
    ).toBeNull());
  it('rejects unsupported extensions', () =>
    expect(validateSelection([file('a.exe')], 0, limits)).toMatch(
      /MP4.*MOV.*WebM.*MKV/i,
    ));
  it('rejects empty files', () =>
    expect(validateSelection([file('a.mp4', 0)], 0, limits)).toMatch(/empty/i));
  it('counts existing clips against the limit', () =>
    expect(validateSelection([file('a.mp4')], 10, limits)).toMatch(/10/));
  it('rejects files above configured limit', () =>
    expect(
      validateSelection([file('a.mp4', 1025)], 0, {
        ...limits,
        max_file_size_mb: 1 / 1024,
      }),
    ).toMatch(/size|large|limit/i));
  it('accepts a file exactly at the size limit', () =>
    expect(
      validateSelection([file('a.mp4', 1024)], 0, {
        ...limits,
        max_file_size_mb: 1 / 1024,
      }),
    ).toBeNull());
  it('moves clips without mutating the original', () => {
    const a = ['a', 'b', 'c'];
    expect(moveClip(a, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(a).toEqual(['a', 'b', 'c']);
    expect(moveClip(a, 0, -1)).toEqual(a);
  });
  it('formats useful size and duration labels', () => {
    expect(formatSize(1048576)).toBe('1.0 MB');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(undefined)).toBe('Duration unavailable');
  });
});

describe('clip edits', () => {
  const edit = (
    id: string,
    startFrame: number,
    endFrame: number,
    speed = 1,
    trimSaved = false,
  ) =>
    ({
      id,
      file: file(`${id}.mp4`),
      url: `blob:${id}`,
      metadata: {
        duration: 3,
        fps: 30,
        totalFrames: 90,
        width: 1920,
        height: 1080,
        source: 'browser',
      },
      trim: { startFrame, endFrame },
      trimSaved,
      speed,
      metadataStatus: 'ready',
    }) as ClipEdit;

  it('uses inclusive frame ranges, including one-frame and final-frame selections', () => {
    expect(selectedFrameCount({ startFrame: 14, endFrame: 14 })).toBe(1);
    expect(
      selectedSourceDuration({ startFrame: 89, endFrame: 89 }, 30),
    ).toBeCloseTo(1 / 30);
    expect(validateTrim({ startFrame: 89, endFrame: 89 }, 90)).toBeNull();
  });

  it('rejects reversed and out-of-bounds trim ranges', () => {
    expect(validateTrim({ startFrame: 8, endFrame: 7 }, 90)).toMatch(/start/i);
    expect(validateTrim({ startFrame: 0, endFrame: 90 }, 90)).toMatch(/range/i);
  });

  it('applies speed after calculating selected source duration', () => {
    const trim = { startFrame: 0, endFrame: 89 };
    expect(outputDuration(trim, 30, 1)).toBe(3);
    expect(outputDuration(trim, 30, 0.75)).toBe(4);
    expect(outputDuration(trim, 30, 0.5)).toBe(6);
  });

  it('formats exact frame timestamps with milliseconds', () => {
    expect(formatTimestamp(0)).toBe('00:00.000');
    expect(formatTimestamp(65.25)).toBe('01:05.250');
  });

  it('infers common source frame rates without assuming the 30 fps output rate', () => {
    expect(estimateFrameRate([0, 1 / 24, 2 / 24, 3 / 24])).toBeCloseTo(24);
    expect(
      estimateFrameRate([0, 1001 / 30000, 2002 / 30000, 3003 / 30000]),
    ).toBeCloseTo(30000 / 1001);
    expect(frameCountFromDuration(0.7, 24)).toBe(17);
  });

  it('resolves Auto to the nearest supported project frame rate', () => {
    expect(resolveProjectFps('auto', 24)).toBe(24);
    expect(resolveProjectFps('auto', 29.97)).toBe(30);
    expect(resolveProjectFps('auto', 59.94)).toBe(60);
    expect(resolveProjectFps('auto', undefined)).toBeNull();
    expect(resolveProjectFps('25', 60)).toBe(25);
  });

  it('builds the merge manifest in current clip order', () => {
    const overlays = {
      image: {
        kind: 'image' as const,
        file: new File(['image'], 'logo.png'),
        url: 'blob:logo',
        metadataStatus: 'ready' as const,
        startFrame: 0,
        endFrame: 49,
        position: 'top-right' as const,
        size: 'small' as const,
      },
      video: null,
    };
    const manifest = buildMergeManifest(
      [edit('second', 15, 44, 0.75, true), edit('first', 0, 89, 0.5)],
      {
        originalVolume: 1,
        originalMuted: false,
        musicVolume: 0.3,
        musicMuted: true,
      },
      25,
      overlays,
      ['first', 'second'],
    );
    expect(manifest.output_fps).toBe(25);
    expect(manifest.order).toEqual(['first', 'second']);
    expect(manifest.clips.map(({ client_id }) => client_id)).toEqual([
      'second',
      'first',
    ]);
    expect(manifest.clips).toEqual([
      {
        client_id: 'second',
        start_frame: 15,
        end_frame: 44,
        speed: 0.75,
        trim_saved: true,
      },
      {
        client_id: 'first',
        start_frame: 0,
        end_frame: 89,
        speed: 0.5,
        trim_saved: false,
      },
    ]);
    expect(manifest.audio).toEqual({
      original_volume: 1,
      original_muted: false,
      music_volume: 0.3,
      music_muted: true,
    });
    expect(manifest.overlays).toEqual({
      image: {
        start_frame: 0,
        end_frame: 49,
        position: 'top-right',
        size: 'small',
      },
      video: null,
    });
  });
});
