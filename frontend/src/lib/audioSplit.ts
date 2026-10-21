import type { EditSnapshot } from './editHistory';
import type { ProjectSources } from './projectSources';
import type { AdvancedTimelineProjection } from './advancedTimeline';
import type { Limits } from './clips';
import { SUPPORTED_PROJECT_FPS } from './clips';
import type { EditIssue, EditResult } from './positionedEdits';
import { splitPositioned, validatePositioned } from './positionedEdits';
import { editIndependentAudio } from './audioTimeline';

export type AudioSplitTarget = { kind: 'independent' | 'music'; id: string };
export type AudioSplitRequest = {
  snapshot: EditSnapshot;
  sources: ProjectSources;
  projection: AdvancedTimelineProjection;
  target: AudioSplitTarget | null;
  frame: number | null;
  editingLocked: boolean;
  gestureActive: boolean;
  modalOpen: boolean;
  limits: Limits;
};
export type AudioSplitPlan = {
  nextSnapshot: EditSnapshot;
  leftId: string;
  rightId: string;
};

export function audioSplitIssue(r: AudioSplitRequest): EditIssue | null {
  const fail = (message: string, code = 'invalid_range'): EditIssue => ({
    code,
    message,
    lane: r.target?.kind,
    segmentId: r.target?.id,
  });
  if (r.editingLocked)
    return fail(
      'Audio editing is locked while rendering or opening a project.',
      'edit_locked',
    );
  if (r.gestureActive)
    return fail(
      'Finish the current edit gesture before splitting audio.',
      'edit_locked',
    );
  if (r.modalOpen)
    return fail('Close the dialog before splitting audio.', 'edit_locked');
  if (!r.target)
    return fail('Select an editable audio segment. Detach linked audio first.');
  const fps = r.projection.base.fps;
  if (
    !fps ||
    !SUPPORTED_PROJECT_FPS.includes(fps) ||
    r.projection.base.status !== 'ready' ||
    r.projection.renderErrors.length
  )
    return fail('Repair the timeline and source media before splitting audio.');
  const segment = (
    r.target.kind === 'music' ? r.snapshot.music : r.snapshot.independentAudio
  ).find((v) => v.id === r.target!.id);
  if (!segment)
    return fail('Select an available audio segment.', 'missing_source');
  const problem = validatePositioned(r.snapshot, r.sources, fps);
  if (problem) return fail(problem);
  if (segment.durationFrames === 1)
    return fail('A one-frame audio segment cannot be split.');
  if (
    !Number.isSafeInteger(r.frame) ||
    r.frame! <= segment.timelineStartFrame ||
    r.frame! >= segment.timelineStartFrame + segment.durationFrames
  )
    return fail(
      'Move the playhead strictly inside the selected audio segment, away from its start and end.',
    );
  const limit = r.limits.max_music_segments ?? 10 * r.limits.max_clips;
  if (r.snapshot.music.length + r.snapshot.independentAudio.length >= limit)
    return fail(
      'Audio segment limit reached. Remove an audio segment before splitting.',
      'limit',
    );
  return null;
}

export function planAudioSplit(
  r: AudioSplitRequest,
  allocateId: () => string,
): EditResult<AudioSplitPlan> {
  const issue = audioSplitIssue(r);
  if (issue) return { error: issue };
  const target = r.target!;
  const ids = [allocateId(), allocateId()];
  const occupied = new Set(
    [
      ...r.snapshot.video1,
      ...r.snapshot.video2,
      ...r.snapshot.independentAudio,
      ...r.snapshot.music,
      ...(r.snapshot.pip ? [r.snapshot.pip] : []),
    ].map((v) => v.id),
  );
  if (
    ids.some(
      (id) =>
        !id.trim() ||
        occupied.has(id) ||
        new TextEncoder().encode(id).byteLength > 128,
    ) ||
    ids[0] === ids[1]
  )
    return {
      error: {
        code: 'invalid_range',
        message: 'Cannot allocate unique audio segment identities.',
        lane: target.kind,
        segmentId: target.id,
      },
    };
  const fps = r.projection.base.fps!;
  let next: EditResult<EditSnapshot>;
  if (target.kind === 'music')
    next = splitPositioned(
      r.snapshot,
      'music',
      target.id,
      r.frame!,
      { left: ids[0], right: ids[1] },
      fps,
    );
  else {
    let index = 0;
    next = editIndependentAudio(
      r.snapshot,
      { action: 'split', id: target.id, frame: r.frame! },
      fps,
      r.sources,
      () => ids[index++],
    );
  }
  if ('error' in next) return next;
  const error = validatePositioned(next.value, r.sources, fps);
  return error
    ? {
        error: {
          code: 'invalid_range',
          message: error,
          lane: target.kind,
          segmentId: target.id,
        },
      }
    : { value: { nextSnapshot: next.value, leftId: ids[0], rightId: ids[1] } };
}
