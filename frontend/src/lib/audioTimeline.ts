import type { ClipSpeed, ProjectFps } from './clips';
import { SUPPORTED_PROJECT_FPS, validateTrim } from './clips';
import type { EditSnapshot } from './editHistory';
import type { ProjectSources } from './projectSources';
import type { EditIssue, EditResult } from './positionedEdits';
import type { AdvancedTimelineProjection } from './advancedTimeline';
import { projectFrameCount } from './overlays';

export type AudioRecipe =
  | { kind: 'audio-file'; sourceId: string }
  | {
      kind: 'video-edit';
      sourceId: string;
      sourceStartFrame: number;
      sourceEndFrame: number;
      speed: ClipSpeed;
      normalizationFps: ProjectFps;
    };
export type IndependentAudioSegment = {
  id: string;
  timelineStartFrame: number;
  durationFrames: number;
  sourceStartSample: number;
  source: AudioRecipe;
  detachedFrom?: { track: 'video1' | 'video2'; clipId: string };
};

export function validateIndependentAudio(
  snapshot: EditSnapshot,
  sources: ProjectSources,
  fps: ProjectFps,
): EditIssue | null {
  const lane = [...snapshot.independentAudio].sort(
    (a, b) => a.timelineStartFrame - b.timelineStartFrame,
  );
  let previousEnd = 0;
  const ids = new Set<string>();
  for (const segment of lane) {
    const issue = (message: string, code = 'invalid_range'): EditIssue => ({
      message,
      code,
      lane: 'independent',
      segmentId: segment.id,
      sourceId: segment.source.sourceId,
    });
    const {
      timelineStartFrame: start,
      durationFrames: duration,
      sourceStartSample: offset,
      source: recipe,
    } = segment;
    if (
      ![start, duration, offset].every(Number.isSafeInteger) ||
      start < 0 ||
      duration < 1 ||
      offset < 0 ||
      !Number.isSafeInteger(start + duration) ||
      !Number.isSafeInteger(offset + duration * (48000 / fps)) ||
      ids.has(segment.id)
    )
      return issue('Invalid independent audio range or identity.');
    if (start < previousEnd)
      return issue(
        'This range overlaps another clip on Original/Replacement Audio. Move it to a free range.',
        'invalid_overlap',
      );
    const source = sources.get(recipe.sourceId);
    if (!source || source.status !== 'ready')
      return issue('Missing or unready audio source.', 'missing_source');
    let samples: number;
    if (recipe.kind === 'audio-file') {
      if (source.mediaType !== 'audio' || !source.sampleCount)
        return issue('Missing or incompatible audio source.', 'missing_source');
      samples = source.sampleCount;
    } else {
      if (
        source.mediaType !== 'video' ||
        !source.metadata ||
        !SUPPORTED_PROJECT_FPS.includes(recipe.normalizationFps) ||
        ![1, 0.75, 0.5].includes(recipe.speed) ||
        validateTrim(
          {
            startFrame: recipe.sourceStartFrame,
            endFrame: recipe.sourceEndFrame,
          },
          source.metadata.totalFrames,
        )
      )
        return issue('Invalid frozen video audio recipe.');
      samples =
        projectFrameCount(
          recipe.sourceEndFrame - recipe.sourceStartFrame + 1,
          source.metadata.fps,
          recipe.speed,
          recipe.normalizationFps,
        ) *
        (48000 / recipe.normalizationFps);
    }
    if (
      offset >= samples ||
      offset + duration * (48000 / fps) - samples >= 48000 / fps
    )
      return issue('Audio range exceeds source EOF. Repair its source window.');
    ids.add(segment.id);
    previousEnd = start + duration;
  }
  return null;
}

export type AudioOwnershipInterval = {
  startFrame: number;
  endFrameExclusive: number;
  source: AudioRecipe | null;
  sourceStartSample: number;
  ownerId: string | null;
};
export type AudioTarget = { track: 'video1' | 'video2'; id: string };
export function resolveAudioOwnership(
  snapshot: EditSnapshot,
  projection: AdvancedTimelineProjection,
): readonly AudioOwnershipInterval[] {
  const fps = projection.base.fps,
    n = projection.base.totalFrames;
  if (!fps || n < 1) return [];
  const points = new Set([0, n]);
  for (const v of projection.resolved) {
    points.add(v.startFrame);
    points.add(v.endFrameExclusive);
  }
  for (const v of snapshot.independentAudio) {
    points.add(v.timelineStartFrame);
    points.add(v.timelineStartFrame + v.durationFrames);
  }
  const boundaries = [...points]
    .filter((v) => v >= 0 && v <= n)
    .sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((a, i) => {
    const b = boundaries[i + 1],
      segment = snapshot.independentAudio.find(
        (v) =>
          v.timelineStartFrame <= a &&
          a < v.timelineStartFrame + v.durationFrames,
      );
    if (segment)
      return {
        startFrame: a,
        endFrameExclusive: b,
        source: segment.source,
        sourceStartSample:
          segment.sourceStartSample +
          (a - segment.timelineStartFrame) * (48000 / fps),
        ownerId: segment.id,
      };
    const picture = projection.resolved.find(
      (v) => v.startFrame <= a && a < v.endFrameExclusive,
    );
    const owner =
      picture &&
      snapshot[picture.track].find((v) => v.id === picture.occurrenceId);
    if (!picture || !owner?.trim || owner.originalAudio === 'detached')
      return {
        startFrame: a,
        endFrameExclusive: b,
        source: null,
        sourceStartSample: 0,
        ownerId: null,
      };
    const recipe: AudioRecipe = {
      kind: 'video-edit',
      sourceId: owner.sourceId,
      sourceStartFrame: owner.trim.startFrame,
      sourceEndFrame: owner.trim.endFrame,
      speed: owner.speed,
      normalizationFps: fps,
    };
    return {
      startFrame: a,
      endFrameExclusive: b,
      source: recipe,
      sourceStartSample:
        (picture.contentStartFrame + a - picture.startFrame) * (48000 / fps),
      ownerId: owner.id,
    };
  });
}
export function canDetach(
  target: AudioTarget,
  snapshot: EditSnapshot,
  projection: AdvancedTimelineProjection,
): EditResult<true> {
  const fail = (message: string): EditResult<true> => ({
    error: {
      code: 'detach_unavailable',
      message,
      lane: target.track,
      segmentId: target.id,
    },
  });
  if (projection.renderErrors.length || projection.base.status !== 'ready')
    return fail('Repair the timeline before detaching audio.');
  const owner = snapshot[target.track].find((v) => v.id === target.id);
  if (!owner) return fail('Select an available Video 1 or Video 2 clip.');
  if (owner.originalAudio === 'detached')
    return fail('This clip already has detached audio.');
  if (
    !resolveAudioOwnership(snapshot, projection).some(
      (v) => v.ownerId === target.id && v.source,
    )
  )
    return fail(
      'This clip has no exposed linked audio. Select its covering take or audio segment.',
    );
  return { value: true };
}
export function detachAudio(
  snapshot: EditSnapshot,
  sources: ProjectSources,
  projection: AdvancedTimelineProjection,
  target: AudioTarget,
  allocateId: () => string,
): EditResult<EditSnapshot> {
  const eligibility = canDetach(target, snapshot, projection);
  if ('error' in eligibility) return eligibility;
  const segments = resolveAudioOwnership(snapshot, projection)
    .filter((v) => v.ownerId === target.id && v.source)
    .map((v): IndependentAudioSegment => ({
      id: allocateId(),
      timelineStartFrame: v.startFrame,
      durationFrames: v.endFrameExclusive - v.startFrame,
      sourceStartSample: v.sourceStartSample,
      source: { ...v.source! },
      detachedFrom: { track: target.track, clipId: target.id },
    }));
  const next: EditSnapshot = {
    ...snapshot,
    [target.track]: snapshot[target.track].map((v) =>
      v.id === target.id ? { ...v, originalAudio: 'detached' } : v,
    ),
    independentAudio: [...snapshot.independentAudio, ...segments].sort(
      (a, b) => a.timelineStartFrame - b.timelineStartFrame,
    ),
  };
  const issue = validateIndependentAudio(next, sources, projection.base.fps!);
  return issue ? { error: issue } : { value: next };
}
export type AudioSegmentEdit =
  | { action: 'place'; segment: IndependentAudioSegment }
  | { action: 'move'; id: string; startFrame: number }
  | { action: 'trim'; id: string; edge: 'start' | 'end'; deltaFrames: number }
  | { action: 'split'; id: string; frame: number }
  | { action: 'lift' | 'ripple-delete'; id: string }
  | {
      action: 'replace';
      id: string;
      source: AudioRecipe;
      sourceStartSample: number;
    };
export function editIndependentAudio(
  snapshot: EditSnapshot,
  edit: AudioSegmentEdit,
  fps: ProjectFps,
  sources: ProjectSources,
  allocateId: () => string,
): EditResult<EditSnapshot> {
  let segments: readonly IndependentAudioSegment[] = snapshot.independentAudio;
  const fail = (message: string): EditResult<EditSnapshot> => ({
    error: {
      code: 'invalid_range',
      message,
      lane: 'independent',
      ...('id' in edit ? { segmentId: edit.id } : {}),
    },
  });
  if (edit.action === 'place') segments = [...segments, edit.segment];
  else {
    const target = segments.find((v) => v.id === edit.id);
    if (!target) return fail('Missing audio segment.');
    if (edit.action === 'split') {
      const left = edit.frame - target.timelineStartFrame;
      if (
        !Number.isSafeInteger(edit.frame) ||
        left < 1 ||
        left >= target.durationFrames
      )
        return fail('Move the playhead strictly inside the audio segment.');
      segments = segments.flatMap((v) =>
        v.id === target.id
          ? [
              { ...v, id: allocateId(), durationFrames: left },
              {
                ...v,
                id: allocateId(),
                timelineStartFrame: edit.frame,
                durationFrames: v.durationFrames - left,
                sourceStartSample: v.sourceStartSample + left * (48000 / fps),
              },
            ]
          : [v],
      );
    } else if (edit.action === 'lift' || edit.action === 'ripple-delete') {
      segments = segments
        .filter((v) => v.id !== target.id)
        .map((v) =>
          edit.action === 'ripple-delete' &&
          v.timelineStartFrame > target.timelineStartFrame
            ? {
                ...v,
                timelineStartFrame:
                  v.timelineStartFrame - target.durationFrames,
              }
            : v,
        );
    } else
      segments = segments.map((v) => {
        if (v.id !== target.id) return v;
        if (edit.action === 'move')
          return { ...v, timelineStartFrame: edit.startFrame };
        if (edit.action === 'replace')
          return {
            ...v,
            source: { ...edit.source },
            sourceStartSample: edit.sourceStartSample,
            detachedFrom: undefined,
          };
        if (edit.action === 'trim')
          return {
            ...v,
            timelineStartFrame:
              v.timelineStartFrame +
              (edit.edge === 'start' ? edit.deltaFrames : 0),
            sourceStartSample:
              v.sourceStartSample +
              (edit.edge === 'start' ? edit.deltaFrames * (48000 / fps) : 0),
            durationFrames:
              v.durationFrames +
              (edit.edge === 'start' ? -edit.deltaFrames : edit.deltaFrames),
          };
        return v;
      });
  }
  const next = {
    ...snapshot,
    independentAudio: [...segments].sort(
      (a, b) => a.timelineStartFrame - b.timelineStartFrame,
    ),
  };
  const issue = validateIndependentAudio(next, sources, fps);
  return issue ? { error: issue } : { value: next };
}
