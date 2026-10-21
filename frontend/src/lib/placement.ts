import type { ClipTrim, ClipSpeed, Limits, ProjectFps } from './clips';
import type { SourceToken, ProjectSources } from './projectSources';
import type { EditSnapshot } from './editHistory';
import type { EditResult } from './positionedEdits';
import { validateRestoration } from './historyProjection';
import { buildTimeline } from './timeline';
import { occurrenceClip, overwriteVideo1 } from './overwriteEdits';
import { projectFrameCount } from './overlays';
import { resolveProjectFps, validateTrim } from './clips';
import { editIndependentAudio } from './audioTimeline';
export type PlacementDraft = {
  token: SourceToken;
  track: 'video1' | 'video2' | 'independent' | 'music';
  timelineStartFrame: number;
  trim?: ClipTrim;
  speed?: ClipSpeed;
  sourceStartSample?: number;
  durationFrames?: number;
};
export const SOURCE_DRAG_MIME = 'application/x-avstudio-source';
export function dropFrame(
  clientX: number,
  contentRectLeft: number,
  pixelsPerFrame: number,
): EditResult<number> {
  const position = (clientX - contentRectLeft) / pixelsPerFrame;
  if (
    ![clientX, contentRectLeft, pixelsPerFrame].every(Number.isFinite) ||
    pixelsPerFrame <= 0 ||
    position < 0 ||
    !Number.isSafeInteger(Math.floor(position + 0.5))
  )
    return {
      error: {
        code: 'invalid_drop',
        message: 'Drop inside a valid timeline lane at a nonnegative frame.',
      },
    };
  return { value: Math.floor(position + 0.5) };
}
export function timecodeFrame(
  text: string,
  fps: ProjectFps,
): EditResult<number> {
  const parts = text.trim().split(':');
  let seconds: number;
  if (parts.length === 4 && parts.every((v) => /^\d+$/.test(v))) {
    const [h, m, s, f] = parts.map(Number);
    if (m >= 60 || s >= 60 || f >= fps)
      return {
        error: {
          code: 'invalid_timecode',
          message: 'Use a valid project timecode.',
        },
      };
    seconds = h * 3600 + m * 60 + s + f / fps;
  } else if (
    (parts.length === 2 || parts.length === 3) &&
    parts.slice(0, -1).every((v) => /^\d+$/.test(v)) &&
    /^\d{1,2}(\.\d{1,3})?$/.test(parts.at(-1)!)
  ) {
    const s = Number(parts.at(-1)),
      m = Number(parts.at(-2)),
      h = parts.length === 3 ? Number(parts[0]) : 0;
    if (s >= 60 || (parts.length === 3 && m >= 60))
      return {
        error: {
          code: 'invalid_timecode',
          message: 'Use a valid project timecode.',
        },
      };
    seconds = h * 3600 + m * 60 + s;
  } else
    return {
      error: {
        code: 'invalid_timecode',
        message: 'Use mm:ss.mmm or hh:mm:ss:ff.',
      },
    };
  return dropFrame(seconds * fps, 0, 1);
}
export function sourceDragData(draft: PlacementDraft): string {
  const { session, sourceId, requestId } = draft.token;
  return JSON.stringify({
    version: 1,
    draft: {
      token: { session, sourceId, requestId },
      track: draft.track,
      timelineStartFrame: draft.timelineStartFrame,
      trim: draft.trim,
      speed: draft.speed,
      sourceStartSample: draft.sourceStartSample,
      durationFrames: draft.durationFrames,
    },
  });
}
export function parseSourceDragData(
  raw: unknown,
  sources: ProjectSources,
): EditResult<PlacementDraft> {
  const fail = (): EditResult<PlacementDraft> => ({
    error: {
      code: 'invalid_drop',
      message: 'Use a ready media-bin source from this project.',
    },
  });
  try {
    if (typeof raw !== 'string') return fail();
    const envelope = JSON.parse(raw),
      d = envelope?.draft;
    if (
      envelope?.version !== 1 ||
      Object.keys(envelope).some((k) => !['version', 'draft'].includes(k)) ||
      !d ||
      Object.keys(d).some(
        (k) =>
          ![
            'token',
            'track',
            'timelineStartFrame',
            'trim',
            'speed',
            'sourceStartSample',
            'durationFrames',
          ].includes(k),
      ) ||
      !['video1', 'video2', 'independent', 'music'].includes(d.track) ||
      !d.token
    )
      return fail();
    const t = d.token,
      source = sources.get(t.sourceId);
    if (
      Object.keys(t).some(
        (k) => !['session', 'sourceId', 'requestId'].includes(k),
      ) ||
      !source ||
      source.status !== 'ready' ||
      source.token.session !== t.session ||
      source.token.requestId !== t.requestId
    )
      return fail();
    return { value: d as PlacementDraft };
  } catch {
    return fail();
  }
}
export function placementDuration(
  snapshot: EditSnapshot,
  sources: ProjectSources,
  draft: PlacementDraft,
): number {
  const source = sources.get(draft.token.sourceId),
    fps = resolveProjectFps(
      snapshot.fpsSelection,
      sources.get(snapshot.video1[0]?.sourceId)?.metadata?.fps ??
        source?.metadata?.fps,
    );
  if (!source || !fps) return 0;
  if (source.mediaType === 'audio')
    return (
      draft.durationFrames ??
      Math.ceil(
        ((source.sampleCount ?? 0) - (draft.sourceStartSample ?? 0)) /
          (48000 / fps),
      )
    );
  const trim = draft.trim ?? {
    startFrame: 0,
    endFrame: (source.metadata?.totalFrames ?? 1) - 1,
  };
  return source.metadata
    ? projectFrameCount(
        trim.endFrame - trim.startFrame + 1,
        source.metadata.fps,
        draft.speed ?? 1,
        fps,
      )
    : 0;
}
export function validatePlacement(
  snapshot: EditSnapshot,
  sources: ProjectSources,
  draft: PlacementDraft,
  limits: Limits,
): EditResult<EditSnapshot> {
  const fail = (
    message: string,
    code = 'invalid_range',
  ): EditResult<EditSnapshot> => ({
    error: { code, message, lane: draft.track, sourceId: draft.token.sourceId },
  });
  const source = sources.get(draft.token.sourceId);
  if (
    !source ||
    source.status !== 'ready' ||
    source.token.session !== draft.token.session ||
    source.token.requestId !== draft.token.requestId
  )
    return fail('Missing, pending or stale project source.', 'missing_source');
  if (
    !['video1', 'video2', 'independent', 'music'].includes(draft.track) ||
    (draft.speed !== undefined && ![1, 0.75, 0.5].includes(draft.speed)) ||
    (draft.trim !== undefined &&
      (!source.metadata ||
        validateTrim(draft.trim, source.metadata.totalFrames))) ||
    (draft.sourceStartSample !== undefined &&
      (!Number.isSafeInteger(draft.sourceStartSample) ||
        draft.sourceStartSample < 0)) ||
    (draft.durationFrames !== undefined &&
      (!Number.isSafeInteger(draft.durationFrames) || draft.durationFrames < 1))
  )
    return fail('Invalid placement range, speed or track.');
  if (
    !Number.isSafeInteger(draft.timelineStartFrame) ||
    draft.timelineStartFrame < 0
  )
    return fail('Choose a whole nonnegative start frame.');
  const id = () => crypto.randomUUID();
  if (draft.track === 'video1') {
    if (source.mediaType !== 'video' || !source.metadata)
      return fail('Video 1 accepts video sources.', 'wrong_media_type');
    return overwriteVideo1(
      snapshot,
      sources,
      {
        id: 'draft',
        sourceId: source.token.sourceId,
        trim: draft.trim ?? {
          startFrame: 0,
          endFrame: source.metadata.totalFrames - 1,
        },
        trimSaved: Boolean(draft.trim),
        speed: draft.speed ?? 1,
        originalAudio: 'linked',
      },
      draft.timelineStartFrame,
      limits,
      id,
    );
  }
  const clips = snapshot.video1.map((v) => occurrenceClip(v, sources));
  if (clips.some((v) => !v))
    return fail('Missing Video 1 source.', 'missing_source');
  const timeline = buildTimeline(
      clips as NonNullable<ReturnType<typeof occurrenceClip>>[],
      snapshot.fpsSelection,
    ),
    fps = timeline.fps;
  if (!fps || timeline.status !== 'ready')
    return fail('Add ready Video 1 media before placing clips on this lane.');
  const duration = placementDuration(snapshot, sources, draft);
  let next: EditSnapshot;
  if (draft.track === 'video2') {
    if (source.mediaType !== 'video' || !source.metadata)
      return fail('Video 2 accepts video sources.', 'wrong_media_type');
    if (draft.timelineStartFrame + duration > timeline.totalFrames)
      return fail('Replacement clips must fit within Video 1.');
    if (
      snapshot.video2.some(
        (v) =>
          draft.timelineStartFrame <
            v.timelineStartFrame + v.contentOutFrame - v.contentInFrame &&
          v.timelineStartFrame < draft.timelineStartFrame + duration,
      )
    )
      return fail(
        'This range overlaps another clip on Video 2. Move it to a free range.',
        'invalid_overlap',
      );
    next = {
      ...snapshot,
      video2: [
        ...snapshot.video2,
        {
          id: id(),
          sourceId: source.token.sourceId,
          trim: draft.trim ?? {
            startFrame: 0,
            endFrame: source.metadata.totalFrames - 1,
          },
          trimSaved: Boolean(draft.trim),
          speed: draft.speed ?? 1,
          originalAudio: 'linked',
          timelineStartFrame: draft.timelineStartFrame,
          contentInFrame: 0,
          contentOutFrame: duration,
          contentFullSource: true,
        },
      ],
    };
  } else {
    if (source.mediaType !== 'audio' || !source.sampleCount)
      return fail(
        'Place an audio file here, or use Detach Audio on a selected video.',
        'wrong_media_type',
      );
    const offset = draft.sourceStartSample ?? 0;
    if (draft.track === 'independent') {
      const edited = editIndependentAudio(
        snapshot,
        {
          action: 'place',
          segment: {
            id: id(),
            timelineStartFrame: draft.timelineStartFrame,
            durationFrames: duration,
            sourceStartSample: offset,
            source: { kind: 'audio-file', sourceId: source.token.sourceId },
          },
        },
        fps,
        sources,
        id,
      );
      if ('error' in edited) return edited;
      next = edited.value;
    } else {
      next = {
        ...snapshot,
        music: [
          ...snapshot.music,
          {
            id: id(),
            sourceId: source.token.sourceId,
            timelineStartFrame: draft.timelineStartFrame,
            durationFrames: duration,
            sourceStartSample: offset,
          },
        ],
      };
    }
  }
  const error = validateRestoration(next, sources, limits);
  return error
    ? fail(
        error,
        error.includes('overlap') ? 'invalid_overlap' : 'invalid_range',
      )
    : { value: next };
}
