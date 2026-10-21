import type { EditSnapshot, Video1Occurrence } from './editHistory';
import type { Clip, Limits } from './clips';
import { resolveProjectFps } from './clips';
import type { ProjectSources } from './projectSources';
import type { EditResult } from './positionedEdits';
import { occurrenceClip } from './overwriteEdits';
import { validateRestoration } from './historyProjection';
import { buildTimeline } from './timeline';

export function moveVideo1Insert(
  snapshot: EditSnapshot,
  sources: ProjectSources,
  id: string,
  frame: number,
  limits: Limits,
  allocateId: (derivedFrom: string) => string,
): EditResult<EditSnapshot> {
  const fail = (message: string): EditResult<EditSnapshot> => ({
    error: { code: 'invalid_range', message, lane: 'video1', segmentId: id },
  });
  const placed = snapshot.video1.find((v) => v.id === id);
  if (!placed) return fail('Missing Video 1 clip.');
  const invalid = validateRestoration(snapshot, sources, limits);
  if (invalid) return fail(invalid);
  const clips = snapshot.video1.map((v) => occurrenceClip(v, sources));
  if (clips.some((v) => !v)) return fail('Missing Video 1 source.');
  const before = buildTimeline(clips as Clip[], snapshot.fpsSelection);
  if (before.status !== 'ready' || !before.fps)
    return fail('Video source timing is unavailable.');
  const moved = before.items.find((v) => v.clip.id === id)!;
  const remaining = buildTimeline(
    (clips as Clip[]).filter((v) => v.id !== id),
    `${before.fps}`,
  );
  if (
    !Number.isSafeInteger(frame) ||
    frame < 0 ||
    frame > remaining.totalFrames
  )
    return fail('Choose a whole insertion frame within Video 1.');
  if (frame === moved.startFrame) return { value: snapshot };

  // Video 1 is sequential. Removing the occurrence closes its old range;
  // inserting into the remaining sequence ripples the suffix by its duration.
  const video1: Video1Occurrence[] = [];
  let inserted = false;
  for (const item of remaining.items) {
    const original = snapshot.video1.find((v) => v.id === item.clip.id)!;
    if (!inserted && frame <= item.startFrame) {
      video1.push(placed);
      inserted = true;
    }
    if (!inserted && frame <= item.endFrame) {
      const start = original.outputWindow?.outputInFrame ?? 0;
      const cut = start + frame - item.startFrame;
      video1.push(
        {
          ...original,
          outputWindow: { outputInFrame: start, outputOutFrame: cut },
        },
        placed,
        {
          ...original,
          id: allocateId(original.id),
          outputWindow: {
            outputInFrame: cut,
            outputOutFrame: start + item.frameCount,
          },
        },
      );
      inserted = true;
    } else video1.push(original);
  }
  if (!inserted) video1.push(placed);
  const next: EditSnapshot = {
    ...snapshot,
    video1,
    // Auto follows the first source. Pin the existing timing only when moving
    // a different-FPS source to the front would change project durations.
    fpsSelection:
      resolveProjectFps(
        snapshot.fpsSelection,
        sources.get(video1[0].sourceId)?.metadata?.fps,
      ) === before.fps
        ? snapshot.fpsSelection
        : `${before.fps}`,
  };
  const error = validateRestoration(next, sources, limits);
  return error ? fail(error) : { value: next };
}
