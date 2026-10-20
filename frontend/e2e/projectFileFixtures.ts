import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { generateAdvancedMedia } from './mediaFixtures';
import type {
  ProjectDocumentV1,
  ProjectSourceV1,
} from '../src/lib/projectFileTypes';
export function generateProjectFileMedia(folder: string) {
  const media = generateAdvancedMedia(folder);
  const renamedBase = join(folder, 'renamed.mp4'),
    duplicateBase = join(folder, 'duplicate.mp4'),
    sameSizeWrongBase = join(folder, 'wrong-base.mp4');
  copyFileSync(media.base, renamedBase);
  copyFileSync(media.base, duplicateBase);
  const changed = Buffer.from(readFileSync(media.base));
  const marker = changed.indexOf(Buffer.from('Lavf'));
  if (marker < 0)
    throw new Error('Fixture MP4 has no fixed-width encoder metadata marker.');
  changed[marker] = 88;
  // The generated media directory owns every test artifact.
  writeFileSync(sameSizeWrongBase, changed);
  return { ...media, renamedBase, duplicateBase, sameSizeWrongBase };
}
export type ProjectFileMedia = ReturnType<typeof generateProjectFileMedia>;
function identity(path: string, id: string) {
  const bytes = readFileSync(path);
  return {
    id,
    originalName: basename(path),
    sizeBytes: bytes.length,
    mimeType: path.endsWith('.png')
      ? 'image/png'
      : path.endsWith('.wav')
        ? 'audio/wav'
        : 'video/mp4',
    lastModifiedMs: Math.trunc(statSync(path).mtimeMs),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
function video(path: string, id: string, frames: number): ProjectSourceV1 {
  return {
    ...identity(path, id),
    mediaType: 'video',
    metadata: {
      durationSeconds: frames / 25,
      width: 320,
      height: 180,
      clipMetadata: {
        duration: frames / 25,
        fps: 25,
        totalFrames: frames,
        width: 320,
        height: 180,
        origin: 'browser',
      },
    },
  };
}
export function createBrowserProject(
  media: ProjectFileMedia,
  full = false,
): ProjectDocumentV1 {
  const d: ProjectDocumentV1 = {
    format: 'avstudio-project',
    schemaVersion: 1,
    sources: [video(media.base, 'source_base', 150)],
    edit: {
      binSourceIds: [],
      video1: [
        {
          id: 'occ_base',
          sourceId: 'source_base',
          trim: { startFrame: 0, endFrame: 149 },
          trimSaved: true,
          speed: 1,
          originalAudio: 'linked',
        },
      ],
      video2: [],
      musicSourceId: null,
      music: [],
      independentAudio: [],
      pip: null,
      audio: {
        originalVolume: 1,
        originalMuted: false,
        musicVolume: 0.3,
        musicMuted: false,
      },
      fpsSelection: '25',
    },
    imageOverlay: null,
    exportSettings: { formats: ['mp4'] },
    timingFps: 25,
  };
  if (!full) return d;
  d.sources.push(
    video(media.takeA, 'source_take', 60),
    video(media.pip, 'source_pip', 10),
    video(media.silentTake, 'source_unused', 20),
  );
  d.sources.push(
    {
      ...identity(media.music, 'source_music'),
      mediaType: 'audio',
      metadata: { durationSeconds: 8, sampleCount: 384000 },
    },
    {
      ...identity(media.image, 'source_image'),
      mediaType: 'image',
      metadata: { width: 32, height: 32 },
    },
  );
  d.edit.binSourceIds = ['source_unused', 'source_base'];
  d.edit.video1 = [
    {
      id: 'occ_left',
      sourceId: 'source_base',
      trim: { startFrame: 0, endFrame: 74 },
      trimSaved: true,
      speed: 1,
      originalAudio: 'detached',
      outputWindow: { outputInFrame: 5, outputOutFrame: 70 },
    },
    {
      id: 'occ_right',
      sourceId: 'source_base',
      trim: { startFrame: 75, endFrame: 149 },
      trimSaved: true,
      speed: 0.5,
      originalAudio: 'linked',
    },
  ];
  d.edit.video2 = [
    {
      id: 'occ_take',
      sourceId: 'source_take',
      trim: { startFrame: 0, endFrame: 59 },
      trimSaved: true,
      speed: 0.75,
      originalAudio: 'detached',
      timelineStartFrame: 25,
      contentInFrame: 10,
      contentOutFrame: 50,
      contentFullSource: false,
    },
  ];
  d.edit.pip = {
    id: 'occ_pip',
    sourceId: 'source_pip',
    startFrame: 5,
    endFrame: 14,
    position: 'bottom-right',
    size: 'medium',
  };
  d.imageOverlay = {
    id: 'occ_image',
    sourceId: 'source_image',
    startFrame: 0,
    endFrame: 39,
    position: 'top-right',
    size: 'small',
  };
  d.edit.musicSourceId = 'source_music';
  d.edit.music = [
    {
      id: 'music_a',
      sourceId: 'source_music',
      timelineStartFrame: 5,
      sourceStartSample: 4800,
      durationFrames: 15,
    },
    {
      id: 'music_b',
      sourceId: 'source_music',
      timelineStartFrame: 60,
      sourceStartSample: 48000,
      durationFrames: 30,
    },
  ];
  d.edit.independentAudio = [
    {
      id: 'audio_frozen',
      timelineStartFrame: 0,
      durationFrames: 25,
      sourceStartSample: 4800,
      source: {
        kind: 'video-edit',
        sourceId: 'source_take',
        sourceStartFrame: 0,
        sourceEndFrame: 59,
        speed: 0.75,
        normalizationFps: 25,
      },
      detachedFrom: { track: 'video2', clipId: 'deleted_original' },
    },
    {
      id: 'audio_voice',
      timelineStartFrame: 30,
      durationFrames: 20,
      sourceStartSample: 0,
      source: { kind: 'audio-file', sourceId: 'source_music' },
    },
  ];
  d.edit.audio = {
    originalVolume: 0.65,
    originalMuted: false,
    musicVolume: 0.2,
    musicMuted: true,
  };
  d.edit.fpsSelection = 'auto';
  d.exportSettings.formats = ['mp4', 'mov', 'wav', 'mp3'];
  return d;
}
export function projectMediaPaths(media: ProjectFileMedia, full = false) {
  return full
    ? [
        media.base,
        media.takeA,
        media.pip,
        media.silentTake,
        media.music,
        media.image,
      ]
    : [media.base];
}
export function normalizeProjectRequestIds(
  value: unknown,
  document: ProjectDocumentV1,
): unknown {
  const ids = new Map(
    document.sources.map((s) => [s.id, `source:${s.originalName}`]),
  );
  for (const lane of ['video1', 'video2', 'music', 'independentAudio'] as const)
    document.edit[lane].forEach((v, i) => ids.set(v.id, `${lane}:${i}`));
  document.edit.independentAudio.forEach((v, i) => {
    if (v.detachedFrom && !ids.has(v.detachedFrom.clipId))
      ids.set(v.detachedFrom.clipId, `historical:${v.detachedFrom.track}:${i}`);
  });
  const walk = (v: unknown): unknown =>
    typeof v === 'string'
      ? (ids.get(v) ?? v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v).map(([k, field]) => [k, walk(field)]),
            )
          : v;
  return walk(value);
}
export function parseProjectRender(body: Buffer, contentType: string) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) throw new Error('Missing multipart boundary.');
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const files: { name: string; size: number; sha256: string }[] = [];
  let manifest: unknown;
  for (let start = body.indexOf(delimiter); start >= 0;) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd < 0 || headerEnd > next) break;
    const header = body
      .subarray(start + delimiter.length, headerEnd)
      .toString();
    const data = body.subarray(headerEnd + 4, next - 2);
    const filename = /filename="([^"]+)"/.exec(header);
    if (filename)
      files.push({
        name: filename[1],
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
    else if (/name="manifest"/.test(header))
      manifest = JSON.parse(data.toString());
    start = next;
  }
  return { manifest, files };
}
