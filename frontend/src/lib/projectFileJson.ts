import {
  resolveProjectFps,
  SUPPORTED_PROJECT_FPS,
  validateTrim,
} from './clips';
import type { ClipSpeed, Limits, ProjectFps } from './clips';
import { projectFrameCount } from './overlays';
import { projectFailure } from './projectFileTypes';
import type {
  PortableAudioRecipe,
  PortableClipMetadata,
  PortableIndependentAudio,
  PortableMusic,
  PortableVideo1,
  PortableVideo2,
  ProjectDocumentV1,
  ProjectIssue,
  ProjectResult,
  ProjectSourceV1,
} from './projectFileTypes';

export const MAX_PROJECT_BYTES = 5242880;
export const MAX_PROJECT_SOURCES = 1000;
export const MAX_PROJECT_OCCURRENCES = 10000;
export const MAX_PROJECT_DEPTH = 16;
const formats = ['mp4', 'mov', 'wav', 'mp3'] as const;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
class InvalidProject extends Error {
  constructor(readonly issue: ProjectIssue) {
    super(issue.message);
  }
}
function fail(
  path: string,
  reason: string,
  code: ProjectIssue['code'] = 'invalid',
): never {
  throw new InvalidProject({
    code,
    path,
    message: `Invalid project: ${path}: ${reason}`,
  });
}
function object(
  value: unknown,
  path: string,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(path, 'Expected an object.');
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result))
    if (forbidden.has(key) || ![...required, ...optional].includes(key))
      fail(path, 'Unknown or forbidden property.');
  for (const key of required)
    if (!Object.hasOwn(result, key))
      fail(`${path}.${key}`, 'Required property is missing.');
  return result;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array.');
  return value;
}
function number(value: unknown, path: string, positive = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (positive && value <= 0)
  )
    fail(path, 'Expected a finite number in range.');
  return value;
}
function integer(value: unknown, path: string, positive = false): number {
  const n = number(value, path);
  if (!Number.isSafeInteger(n) || n < (positive ? 1 : 0))
    fail(path, 'Expected a safe whole number.');
  return n;
}
function text(
  value: unknown,
  path: string,
  max: number,
  empty = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.length)
  )
    fail(path, 'Invalid text value.');
  return value;
}
function id(value: unknown, path: string): string {
  const s = text(value, path, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) fail(path, 'Invalid identity.');
  return s;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'Expected true or false.');
  return value;
}
function choice<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  const found = allowed.find((v) => v === value);
  if (found === undefined) fail(path, 'Unsupported value.');
  return found;
}
const fps = (value: unknown, path: string) =>
  choice(value, SUPPORTED_PROJECT_FPS, path);
const speed = (value: unknown, path: string) =>
  choice(value, [1, 0.75, 0.5] as const, path);
function trim(value: unknown, path: string) {
  const o = object(value, path, ['startFrame', 'endFrame']);
  const t = {
    startFrame: integer(o.startFrame, `${path}.startFrame`),
    endFrame: integer(o.endFrame, `${path}.endFrame`),
  };
  if (t.endFrame < t.startFrame) fail(path, 'Reversed trim.');
  return t;
}
function overlay(value: unknown, path: string) {
  const o = object(value, path, [
    'id',
    'sourceId',
    'startFrame',
    'endFrame',
    'position',
    'size',
  ]);
  const result = {
    id: id(o.id, `${path}.id`),
    sourceId: id(o.sourceId, `${path}.sourceId`),
    startFrame: integer(o.startFrame, `${path}.startFrame`),
    endFrame: integer(o.endFrame, `${path}.endFrame`),
    position: choice(
      o.position,
      [
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
        'centre',
      ] as const,
      `${path}.position`,
    ),
    size: choice(o.size, ['small', 'medium', 'large'] as const, `${path}.size`),
  };
  if (result.startFrame > result.endFrame) fail(path, 'Reversed schedule.');
  if (
    !Number.isSafeInteger(result.endFrame + 1) ||
    !Number.isSafeInteger(result.endFrame - result.startFrame + 1)
  )
    fail(path, 'Schedule exceeds safe frame arithmetic.');
  return result;
}
function clipMetadata(value: unknown, path: string): PortableClipMetadata {
  const o = object(value, path, [
    'duration',
    'fps',
    'totalFrames',
    'width',
    'height',
    'origin',
  ]);
  return {
    duration: number(o.duration, `${path}.duration`, true),
    fps: number(o.fps, `${path}.fps`, true),
    totalFrames: integer(o.totalFrames, `${path}.totalFrames`, true),
    width: integer(o.width, `${path}.width`, true),
    height: integer(o.height, `${path}.height`, true),
    origin: choice(o.origin, ['browser', 'backend'] as const, `${path}.origin`),
  };
}
function source(value: unknown, path: string): ProjectSourceV1 {
  const o = object(value, path, [
    'id',
    'mediaType',
    'originalName',
    'sizeBytes',
    'mimeType',
    'lastModifiedMs',
    'sha256',
    'metadata',
  ]);
  const sha256 = text(o.sha256, `${path}.sha256`, 64);
  if (!/^[a-f0-9]{64}$/.test(sha256))
    fail(`${path}.sha256`, 'Invalid SHA-256 fingerprint.');
  const common = {
    id: id(o.id, `${path}.id`),
    originalName: text(o.originalName, `${path}.originalName`, 1024),
    sizeBytes: integer(o.sizeBytes, `${path}.sizeBytes`, true),
    mimeType: text(o.mimeType, `${path}.mimeType`, 255, true),
    lastModifiedMs:
      o.lastModifiedMs === null
        ? null
        : integer(o.lastModifiedMs, `${path}.lastModifiedMs`),
    sha256,
  };
  const type = choice(
    o.mediaType,
    ['video', 'audio', 'image'] as const,
    `${path}.mediaType`,
  );
  const p = `${path}.metadata`;
  if (type === 'image') {
    const m = object(o.metadata, p, ['width', 'height']);
    return {
      ...common,
      mediaType: type,
      metadata: {
        width: integer(m.width, `${p}.width`, true),
        height: integer(m.height, `${p}.height`, true),
      },
    };
  }
  if (type === 'audio') {
    const m = object(o.metadata, p, ['durationSeconds', 'sampleCount']);
    return {
      ...common,
      mediaType: type,
      metadata: {
        durationSeconds: number(
          m.durationSeconds,
          `${p}.durationSeconds`,
          true,
        ),
        sampleCount: integer(m.sampleCount, `${p}.sampleCount`, true),
      },
    };
  }
  const m = object(
    o.metadata,
    p,
    ['durationSeconds'],
    ['clipMetadata', 'width', 'height'],
  );
  const durationSeconds = number(
    m.durationSeconds,
    `${p}.durationSeconds`,
    true,
  );
  const dimensions =
    m.width !== undefined || m.height !== undefined
      ? {
          width: integer(m.width, `${p}.width`, true),
          height: integer(m.height, `${p}.height`, true),
        }
      : {};
  const timing =
    m.clipMetadata !== undefined
      ? clipMetadata(m.clipMetadata, `${p}.clipMetadata`)
      : undefined;
  if (
    timing &&
    (dimensions.width !== timing.width ||
      dimensions.height !== timing.height ||
      Math.abs(durationSeconds - timing.duration) >
        Math.max(0.05, 1 / timing.fps))
  )
    fail(p, 'Inconsistent video metadata.');
  return {
    ...common,
    mediaType: 'video',
    metadata: {
      durationSeconds,
      ...dimensions,
      ...(timing ? { clipMetadata: timing } : {}),
    },
  };
}
function video1(value: unknown, path: string): PortableVideo1 {
  const o = object(
    value,
    path,
    ['id', 'sourceId', 'trim', 'trimSaved', 'speed', 'originalAudio'],
    ['outputWindow'],
  );
  let outputWindow;
  if (o.outputWindow !== undefined) {
    const w = object(o.outputWindow, `${path}.outputWindow`, [
      'outputInFrame',
      'outputOutFrame',
    ]);
    outputWindow = {
      outputInFrame: integer(
        w.outputInFrame,
        `${path}.outputWindow.outputInFrame`,
      ),
      outputOutFrame: integer(
        w.outputOutFrame,
        `${path}.outputWindow.outputOutFrame`,
      ),
    };
  }
  return {
    id: id(o.id, `${path}.id`),
    sourceId: id(o.sourceId, `${path}.sourceId`),
    trim: trim(o.trim, `${path}.trim`),
    trimSaved: boolean(o.trimSaved, `${path}.trimSaved`),
    speed: speed(o.speed, `${path}.speed`),
    originalAudio: choice(
      o.originalAudio,
      ['linked', 'detached'] as const,
      `${path}.originalAudio`,
    ),
    ...(outputWindow ? { outputWindow } : {}),
  };
}
function video2(value: unknown, path: string): PortableVideo2 {
  const o = object(value, path, [
    'id',
    'sourceId',
    'trim',
    'trimSaved',
    'speed',
    'originalAudio',
    'timelineStartFrame',
    'contentInFrame',
    'contentOutFrame',
    'contentFullSource',
  ]);
  return {
    id: id(o.id, `${path}.id`),
    sourceId: id(o.sourceId, `${path}.sourceId`),
    trim: trim(o.trim, `${path}.trim`),
    trimSaved: boolean(o.trimSaved, `${path}.trimSaved`),
    speed: speed(o.speed, `${path}.speed`),
    originalAudio: choice(
      o.originalAudio,
      ['linked', 'detached'] as const,
      `${path}.originalAudio`,
    ),
    timelineStartFrame: integer(
      o.timelineStartFrame,
      `${path}.timelineStartFrame`,
    ),
    contentInFrame: integer(o.contentInFrame, `${path}.contentInFrame`),
    contentOutFrame: integer(o.contentOutFrame, `${path}.contentOutFrame`),
    contentFullSource: boolean(
      o.contentFullSource,
      `${path}.contentFullSource`,
    ),
  };
}
function music(value: unknown, path: string): PortableMusic {
  const o = object(value, path, [
    'id',
    'sourceId',
    'timelineStartFrame',
    'sourceStartSample',
    'durationFrames',
  ]);
  return {
    id: id(o.id, `${path}.id`),
    sourceId: id(o.sourceId, `${path}.sourceId`),
    timelineStartFrame: integer(
      o.timelineStartFrame,
      `${path}.timelineStartFrame`,
    ),
    sourceStartSample: integer(
      o.sourceStartSample,
      `${path}.sourceStartSample`,
    ),
    durationFrames: integer(o.durationFrames, `${path}.durationFrames`, true),
  };
}
function audioRecipe(value: unknown, path: string): PortableAudioRecipe {
  const o = object(
    value,
    path,
    ['kind', 'sourceId'],
    ['sourceStartFrame', 'sourceEndFrame', 'speed', 'normalizationFps'],
  );
  const kind = choice(
    o.kind,
    ['audio-file', 'video-edit'] as const,
    `${path}.kind`,
  );
  if (kind === 'audio-file') {
    object(value, path, ['kind', 'sourceId']);
    return { kind, sourceId: id(o.sourceId, `${path}.sourceId`) };
  }
  return {
    kind,
    sourceId: id(o.sourceId, `${path}.sourceId`),
    sourceStartFrame: integer(o.sourceStartFrame, `${path}.sourceStartFrame`),
    sourceEndFrame: integer(o.sourceEndFrame, `${path}.sourceEndFrame`),
    speed: speed(o.speed, `${path}.speed`),
    normalizationFps: fps(o.normalizationFps, `${path}.normalizationFps`),
  };
}
function independent(value: unknown, path: string): PortableIndependentAudio {
  const o = object(
    value,
    path,
    [
      'id',
      'timelineStartFrame',
      'durationFrames',
      'sourceStartSample',
      'source',
    ],
    ['detachedFrom'],
  );
  const origin =
    o.detachedFrom !== undefined
      ? object(o.detachedFrom, `${path}.detachedFrom`, ['track', 'clipId'])
      : undefined;
  return {
    id: id(o.id, `${path}.id`),
    timelineStartFrame: integer(
      o.timelineStartFrame,
      `${path}.timelineStartFrame`,
    ),
    durationFrames: integer(o.durationFrames, `${path}.durationFrames`, true),
    sourceStartSample: integer(
      o.sourceStartSample,
      `${path}.sourceStartSample`,
    ),
    source: audioRecipe(o.source, `${path}.source`),
    ...(origin
      ? {
          detachedFrom: {
            track: choice(
              origin.track,
              ['video1', 'video2'] as const,
              `${path}.detachedFrom.track`,
            ),
            clipId: id(origin.clipId, `${path}.detachedFrom.clipId`),
          },
        }
      : {}),
  };
}
function validateRanges(d: ProjectDocumentV1, limits: Limits) {
  const sources = new Map(d.sources.map((s) => [s.id, s]));
  if (sources.size !== d.sources.length)
    fail('sources', 'Duplicate source identity.');
  const used = new Set<string>();
  const identities = new Set(sources.keys());
  const ref = (sourceId: string, type?: ProjectSourceV1['mediaType']) => {
    const s = sources.get(sourceId);
    if (!s || (type && s.mediaType !== type))
      fail('edit.sourceId', 'Missing or incompatible source.');
    used.add(sourceId);
    return s;
  };
  const claim = (occ: { id: string }) => {
    if (identities.has(occ.id))
      fail('edit.id', 'Conflicting occurrence identity.');
    identities.add(occ.id);
  };
  const duration = (
    sourceId: string,
    t: { startFrame: number; endFrame: number },
    rate: ClipSpeed,
    projectFps: ProjectFps,
  ) => {
    const s = ref(sourceId, 'video');
    const m = s.mediaType === 'video' ? s.metadata.clipMetadata : undefined;
    if (!m || validateTrim(t, m.totalFrames))
      fail('edit.trim', 'Missing timing or invalid source range.');
    return integer(
      projectFrameCount(t.endFrame - t.startFrame + 1, m.fps, rate, projectFps),
      'edit.duration',
      true,
    );
  };
  for (const sourceId of d.edit.binSourceIds)
    if (ref(sourceId).mediaType === 'image')
      fail('edit.binSourceIds', 'Unsupported bin category.');
  if (new Set(d.edit.binSourceIds).size !== d.edit.binSourceIds.length)
    fail('edit.binSourceIds', 'Duplicate bin source.');
  const first = sources.get(d.edit.video1[0]?.sourceId);
  const resolved = resolveProjectFps(
    d.edit.fpsSelection,
    first?.mediaType === 'video' ? first.metadata.clipMetadata?.fps : undefined,
  );
  if (resolved && resolved !== d.timingFps)
    fail('timingFps', 'FPS differs from the current selection and source.');
  const count =
    d.edit.video1.length +
    d.edit.video2.length +
    d.edit.music.length +
    d.edit.independentAudio.length +
    (d.edit.pip ? 1 : 0) +
    (d.imageOverlay ? 1 : 0);
  if (
    count > MAX_PROJECT_OCCURRENCES ||
    d.sources.length > MAX_PROJECT_SOURCES ||
    d.edit.video1.length + d.edit.video2.length > limits.max_clips ||
    d.edit.music.length + d.edit.independentAudio.length >
      10 * limits.max_clips ||
    (limits.max_music_segments !== undefined &&
      d.edit.music.length > limits.max_music_segments)
  )
    fail('edit', 'Project exceeds supported limits.', 'limit');
  if (count && !d.timingFps) fail('timingFps', 'Timed edits require an FPS.');
  const f = d.timingFps;
  let total = 0;
  for (const v of d.edit.video1) {
    claim(v);
    if (!f) fail('timingFps', 'Missing FPS.');
    const n = duration(v.sourceId, v.trim, v.speed, f);
    const w = v.outputWindow;
    if (w && (w.outputInFrame >= w.outputOutFrame || w.outputOutFrame > n))
      fail('edit.video1.outputWindow', 'Invalid normalized source window.');
    total += w ? w.outputOutFrame - w.outputInFrame : n;
    integer(total, 'edit.video1.duration');
  }
  const lane = <T extends { timelineStartFrame: number }>(
    items: T[],
    length: (v: T) => number,
    path: string,
  ) => {
    let previousEnd = 0;
    for (const v of [...items].sort(
      (a, b) => a.timelineStartFrame - b.timelineStartFrame,
    )) {
      const n = integer(length(v), path, true);
      const end = integer(v.timelineStartFrame + n, path);
      if (v.timelineStartFrame < previousEnd)
        fail(path, 'Overlapping segments.');
      previousEnd = end;
    }
  };
  for (const v of d.edit.video2) {
    claim(v);
    if (!f) fail('timingFps', 'Missing FPS.');
    const n = duration(v.sourceId, v.trim, v.speed, f);
    if (v.contentInFrame >= v.contentOutFrame || v.contentOutFrame > n)
      fail('edit.video2', 'Invalid normalized source window.');
  }
  lane(
    d.edit.video2,
    (v) => v.contentOutFrame - v.contentInFrame,
    'edit.video2',
  );
  if (Boolean(d.edit.musicSourceId) !== Boolean(d.edit.music.length))
    fail('edit.musicSourceId', 'Music selection and segments differ.');
  const audioRange = (
    offset: number,
    frames: number,
    samples: number,
    projectFps: ProjectFps,
    path: string,
  ) => {
    integer(offset + frames * (48000 / projectFps), path);
    if (
      offset >= samples ||
      offset + frames * (48000 / projectFps) - samples >= 48000 / projectFps
    )
      fail(path, 'Audio range exceeds source EOF.');
  };
  for (const v of d.edit.music) {
    claim(v);
    const s = ref(v.sourceId, 'audio');
    if (v.sourceId !== d.edit.musicSourceId || s.mediaType !== 'audio' || !f)
      fail('edit.music', 'Incompatible music source.');
    audioRange(
      v.sourceStartSample,
      v.durationFrames,
      s.metadata.sampleCount,
      f,
      'edit.music',
    );
  }
  lane(d.edit.music, (v) => v.durationFrames, 'edit.music');
  for (const v of d.edit.independentAudio) {
    claim(v);
    if (!f) fail('timingFps', 'Missing FPS.');
    const r = v.source;
    let samples;
    if (r.kind === 'audio-file') {
      const s = ref(r.sourceId, 'audio');
      if (s.mediaType !== 'audio')
        fail('edit.independentAudio', 'Wrong media type.');
      samples = s.metadata.sampleCount;
    } else
      samples =
        duration(
          r.sourceId,
          { startFrame: r.sourceStartFrame, endFrame: r.sourceEndFrame },
          r.speed,
          r.normalizationFps,
        ) *
        (48000 / r.normalizationFps);
    audioRange(
      v.sourceStartSample,
      v.durationFrames,
      samples,
      f,
      'edit.independentAudio',
    );
  }
  lane(
    d.edit.independentAudio,
    (v) => v.durationFrames,
    'edit.independentAudio',
  );
  if (d.edit.pip) {
    claim(d.edit.pip);
    ref(d.edit.pip.sourceId, 'video');
  }
  if (d.imageOverlay) {
    claim(d.imageOverlay);
    ref(d.imageOverlay.sourceId, 'image');
  }
  if (!used.size)
    fail(
      'sources',
      'This project contains no media or edits. Use New Project to start over.',
    );
  if (used.size !== sources.size) fail('sources', 'Unreferenced source.');
  for (const s of d.sources) {
    const roleLimit =
      s.mediaType === 'image'
        ? (limits.max_overlay_image_file_size_mb ?? 20)
        : s.mediaType === 'audio'
          ? (limits.max_audio_file_size_mb ?? 100)
          : limits.max_file_size_mb;
    const pipLimit =
      d.edit.pip?.sourceId === s.id
        ? (limits.max_overlay_video_file_size_mb ?? 200)
        : Infinity;
    if (s.sizeBytes > Math.min(roleLimit, pipLimit) * 1024 * 1024)
      fail(
        'sources.sizeBytes',
        'Media exceeds the current size limit.',
        'limit',
      );
  }
}
export function validateProjectDocument(
  input: unknown,
  limits: Limits,
): ProjectResult<ProjectDocumentV1> {
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      !('format' in input) ||
      input.format !== 'avstudio-project'
    )
      return projectFailure('not-project', 'Not an AVStudio project.');
    if (
      'schemaVersion' in input &&
      typeof input.schemaVersion === 'number' &&
      Number.isSafeInteger(input.schemaVersion) &&
      input.schemaVersion > 0 &&
      input.schemaVersion !== 1
    )
      return projectFailure(
        'unsupported-version',
        `Unsupported project version ${input.schemaVersion}. Use a compatible AVStudio version.`,
      );
    const root = object(input, 'project', [
      'format',
      'schemaVersion',
      'sources',
      'edit',
      'imageOverlay',
      'exportSettings',
      'timingFps',
    ]);
    if (root.schemaVersion !== 1)
      fail('schemaVersion', 'Invalid schema version.');
    const e = object(root.edit, 'edit', [
      'binSourceIds',
      'video1',
      'video2',
      'musicSourceId',
      'music',
      'independentAudio',
      'pip',
      'audio',
      'fpsSelection',
    ]);
    const a = object(e.audio, 'edit.audio', [
      'originalVolume',
      'originalMuted',
      'musicVolume',
      'musicMuted',
    ]);
    const volume = (v: unknown, p: string) => {
      const n = number(v, p);
      if (n < 0 || n > 1) fail(p, 'Volume must be between 0 and 1.');
      return n;
    };
    const x = object(root.exportSettings, 'exportSettings', ['formats']);
    const selected = list(x.formats, 'exportSettings.formats').map((v, i) =>
      choice(v, formats, `exportSettings.formats[${i}]`),
    );
    if (!selected.includes('mp4') || new Set(selected).size !== selected.length)
      fail('exportSettings.formats', 'Formats must be unique and include MP4.');
    const document: ProjectDocumentV1 = {
      format: 'avstudio-project',
      schemaVersion: 1,
      sources: list(root.sources, 'sources').map((v, i) =>
        source(v, `sources[${i}]`),
      ),
      edit: {
        binSourceIds: list(e.binSourceIds, 'edit.binSourceIds').map((v, i) =>
          id(v, `edit.binSourceIds[${i}]`),
        ),
        video1: list(e.video1, 'edit.video1').map((v, i) =>
          video1(v, `edit.video1[${i}]`),
        ),
        video2: list(e.video2, 'edit.video2').map((v, i) =>
          video2(v, `edit.video2[${i}]`),
        ),
        musicSourceId:
          e.musicSourceId === null
            ? null
            : id(e.musicSourceId, 'edit.musicSourceId'),
        music: list(e.music, 'edit.music').map((v, i) =>
          music(v, `edit.music[${i}]`),
        ),
        independentAudio: list(e.independentAudio, 'edit.independentAudio').map(
          (v, i) => independent(v, `edit.independentAudio[${i}]`),
        ),
        pip: e.pip === null ? null : overlay(e.pip, 'edit.pip'),
        audio: {
          originalVolume: volume(a.originalVolume, 'edit.audio.originalVolume'),
          originalMuted: boolean(a.originalMuted, 'edit.audio.originalMuted'),
          musicVolume: volume(a.musicVolume, 'edit.audio.musicVolume'),
          musicMuted: boolean(a.musicMuted, 'edit.audio.musicMuted'),
        },
        fpsSelection: choice(
          e.fpsSelection,
          ['auto', '24', '25', '30', '50', '60'] as const,
          'edit.fpsSelection',
        ),
      },
      imageOverlay:
        root.imageOverlay === null
          ? null
          : overlay(root.imageOverlay, 'imageOverlay'),
      exportSettings: { formats: selected },
      timingFps:
        root.timingFps === null ? null : fps(root.timingFps, 'timingFps'),
    };
    validateRanges(document, limits);
    return { ok: true, value: document };
  } catch (error) {
    return error instanceof InvalidProject
      ? { ok: false, issue: error.issue }
      : projectFailure('invalid', 'Invalid project.', 'project');
  }
}
function scanJson(textValue: string) {
  const stack: { kind: string; keys: Set<string> }[] = [];
  for (let i = 0; i < textValue.length; i++) {
    const char = textValue[i];
    if (char === '"') {
      const start = i++;
      let closed = false;
      for (; i < textValue.length; i++) {
        if (textValue[i] === '\\') i++;
        else if (textValue[i] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) fail('project', 'Unterminated JSON string.', 'corrupt');
      let next = i + 1;
      while (next < textValue.length && /[\t\n\r ]/.test(textValue[next]))
        next++;
      if (textValue[next] === ':') {
        const key: string = JSON.parse(textValue.slice(start, i + 1));
        const frame = stack.at(-1);
        if (
          !frame ||
          frame.kind !== '{' ||
          forbidden.has(key) ||
          frame.keys.has(key)
        )
          fail('project', 'Duplicate or forbidden JSON property.', 'corrupt');
        frame.keys.add(key);
      }
    } else if (char === '{' || char === '[') {
      stack.push({ kind: char, keys: new Set() });
      if (stack.length > MAX_PROJECT_DEPTH)
        fail('project', 'Project exceeds supported nesting depth.', 'limit');
    } else if (char === '}' || char === ']') stack.pop();
  }
}
export function parseProjectText(
  textValue: string,
  limits: Limits,
): ProjectResult<ProjectDocumentV1> {
  if (new TextEncoder().encode(textValue).byteLength > MAX_PROJECT_BYTES)
    return projectFailure('limit', 'Project exceeds supported limits.');
  const value = textValue.startsWith('\uFEFF') ? textValue.slice(1) : textValue;
  try {
    scanJson(value);
    return validateProjectDocument(JSON.parse(value), limits);
  } catch (error) {
    return error instanceof InvalidProject
      ? { ok: false, issue: error.issue }
      : projectFailure('corrupt', 'Project JSON is corrupt.');
  }
}
export async function readProjectFile(
  file: File,
  limits: Limits,
  signal: AbortSignal,
): Promise<ProjectResult<ProjectDocumentV1>> {
  if (signal.aborted) return projectFailure('cancelled', 'Open cancelled.');
  if (file.size > MAX_PROJECT_BYTES)
    return projectFailure('limit', 'Project exceeds supported limits.');
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return projectFailure('read', 'Could not read project file.');
  }
  if (signal.aborted) return projectFailure('cancelled', 'Open cancelled.');
  try {
    return parseProjectText(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      limits,
    );
  } catch {
    return projectFailure('corrupt', 'Project JSON is corrupt: invalid UTF-8.');
  }
}
export function stringifyProjectDocument(
  document: ProjectDocumentV1,
  limits: Limits,
): ProjectResult<string> {
  const checked = validateProjectDocument(document, limits);
  if (!checked.ok) return checked;
  const value = checked.value;
  value.sources.sort((a, b) => a.id.localeCompare(b.id));
  value.exportSettings.formats = formats.filter((f) =>
    value.exportSettings.formats.includes(f),
  );
  const result = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(result).byteLength <= MAX_PROJECT_BYTES
    ? { ok: true, value: result }
    : projectFailure('limit', 'Project exceeds supported limits.');
}
