import type { EditSnapshot, Video1Occurrence } from './editHistory';
import type { Limits } from './clips';
import type { ProjectSources } from './projectSources';
import type { Clip } from './clips';
import { resolveProjectFps } from './clips';
import type { EditResult } from './positionedEdits';
import { buildTimeline } from './timeline';
import { validateRestoration } from './historyProjection';
import type { ClipTrim, ClipSpeed, ProjectFps } from './clips';
import { validateTrim } from './clips';

export function changeBaseSourceEdit(
  snapshot: EditSnapshot,
  id: string,
  trim: ClipTrim,
  speed: ClipSpeed,
  kind: 'trim' | 'speed',
  sources: ProjectSources,
  fps: ProjectFps,
): EditResult<EditSnapshot> {
  const target = snapshot.video1.find((v) => v.id === id);
  const metadata = target && sources.get(target.sourceId)?.metadata;
  if (
    !target ||
    !metadata ||
    ![24, 25, 30, 50, 60].includes(fps) ||
    validateTrim(trim, metadata.totalFrames) ||
    ![1, 0.75, 0.5].includes(speed)
  )
    return {
      error: {
        code: 'invalid_range',
        message: 'Invalid Video 1 source trim or speed.',
        lane: 'video1',
        segmentId: id,
      },
    };
  const outputWindow =
    kind === 'trim'
      ? undefined
      : target.outputWindow && {
          outputInFrame: Math.floor(
            (target.outputWindow.outputInFrame * target.speed) / speed + 0.5,
          ),
          outputOutFrame: Math.floor(
            (target.outputWindow.outputOutFrame * target.speed) / speed + 0.5,
          ),
        };
  const next = {
    ...snapshot,
    video1: snapshot.video1.map((v) =>
      v.id === id
        ? {
            ...v,
            trim,
            trimSaved: kind === 'trim' ? true : v.trimSaved,
            speed,
            outputWindow,
          }
        : v,
    ),
  };
  const error = validateRestoration(next, sources, {
    max_clips: Number.MAX_SAFE_INTEGER,
    max_file_size_mb: Number.MAX_SAFE_INTEGER,
  });
  return error
    ? {
        error: {
          code: 'invalid_range',
          message: error,
          lane: 'video1',
          segmentId: id,
        },
      }
    : { value: next };
}

// Metadata projection only: rejected edits must not allocate object URLs.
export function occurrenceClip(
  occurrence: Video1Occurrence,
  sources: ProjectSources,
): Clip | null {
  const source = sources.get(occurrence.sourceId);
  return source?.mediaType === 'video'
    ? {
        ...occurrence,
        file: source.file,
        url: source.url ?? '',
        metadata: source.metadata,
        metadataStatus: source.status,
        trim: occurrence.trim ?? undefined,
      }
    : null;
}

export function overwriteVideo1(
  snapshot: EditSnapshot,
  sources: ProjectSources,
  placed: Video1Occurrence,
  startFrame: number,
  limits: Limits,
  allocateId: () => string,
): EditResult<EditSnapshot> {
  const fail = (
    message: string,
    code = 'invalid_range',
  ): EditResult<EditSnapshot> => ({
    error: { code, message, lane: 'video1', sourceId: placed.sourceId },
  });
  const oldClips = snapshot.video1.map((v) => occurrenceClip(v, sources));
  const incoming = occurrenceClip(placed, sources);
  if (!incoming || oldClips.some((v) => !v))
    return fail('Missing video source.', 'missing_source');
  const fps = resolveProjectFps(
    snapshot.fpsSelection,
    oldClips[0]?.metadata?.fps ?? incoming.metadata?.fps,
  );
  if (!fps) return fail('Video source timing is unavailable.');
  const before = buildTimeline(oldClips as Clip[], `${fps}`);
  const added = buildTimeline([incoming], `${fps}`);
  if (
    (snapshot.video1.length && before.status !== 'ready') ||
    added.status !== 'ready'
  )
    return fail('Video source window is unavailable. Repair trim or metadata.');
  const n = before.totalFrames,
    duration = added.totalFrames,
    end = startFrame + duration;
  if (
    !Number.isSafeInteger(startFrame) ||
    startFrame < 0 ||
    startFrame > n ||
    duration < 1 ||
    !Number.isSafeInteger(end)
  )
    return fail('Choose a whole start frame within Video 1.');
  const positioned: { start: number; occurrence: Video1Occurrence }[] = [];
  for (const item of before.items) {
    const original = snapshot.video1.find((v) => v.id === item.clip.id)!;
    const a = item.startFrame,
      b = item.endFrame + 1;
    const c = original.outputWindow?.outputInFrame ?? 0,
      d = c + item.frameCount;
    if (b <= startFrame || a >= end)
      positioned.push({ start: a, occurrence: original });
    else {
      if (a < startFrame)
        positioned.push({
          start: a,
          occurrence: {
            ...original,
            id: allocateId(),
            outputWindow: {
              outputInFrame: c,
              outputOutFrame: c + startFrame - a,
            },
          },
        });
      if (b > end)
        positioned.push({
          start: end,
          occurrence: {
            ...original,
            id: allocateId(),
            outputWindow: { outputInFrame: c + end - a, outputOutFrame: d },
          },
        });
    }
  }
  positioned.push({
    start: startFrame,
    occurrence: {
      ...placed,
      id: allocateId(),
      originalAudio: placed.originalAudio ?? 'linked',
    },
  });
  const next: EditSnapshot = {
    ...snapshot,
    video1: positioned
      .sort((a, b) => a.start - b.start)
      .map((v) => v.occurrence),
  };
  if (
    snapshot.video1.length &&
    snapshot.fpsSelection === 'auto' &&
    resolveProjectFps(
      'auto',
      sources.get(next.video1[0].sourceId)?.metadata?.fps,
    ) !== fps
  )
    return fail(
      'This overwrite changes Auto FPS. Choose an explicit project FPS before placing this clip.',
      'auto_fps_change',
    );
  const error = validateRestoration(next, sources, limits);
  return error
    ? fail(
        error,
        error.includes('limit') ? 'capacity_exceeded' : 'invalid_range',
      )
    : { value: next };
}
