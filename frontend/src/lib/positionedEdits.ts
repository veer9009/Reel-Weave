import type { EditSnapshot } from './editHistory';
import type { ClipTrim, ClipSpeed, ProjectFps } from './clips';
import { validateTrim } from './clips';
import type { ProjectSources } from './projectSources';
import { placementLength } from './advancedTimeline';
import type { Video2Occurrence, MusicOccurrence } from './advancedTimeline';
import { projectFrameCount } from './overlays';
import { validateIndependentAudio } from './audioTimeline';
export type PositionedTrack = 'video2' | 'music';
export type EditIssue = {
  code: string;
  message: string;
  lane?: 'video1' | 'video2' | 'independent' | 'music';
  segmentId?: string;
  sourceId?: string;
};
export type EditResult<T> = { value: T } | { error: EditIssue };
export function editIssue(message: string, code = 'invalid_range'): EditIssue {
  return { code, message };
}
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function validatePositioned(
  s: EditSnapshot,
  sources?: ProjectSources,
  fps?: ProjectFps,
): string | null {
  if (sources && fps)
    for (const v of s.video1) {
      const w = v.outputWindow,
        m = sources.get(v.sourceId)?.metadata;
      if (
        w &&
        (!m ||
          !v.trim ||
          !integer(w.outputInFrame) ||
          !integer(w.outputOutFrame) ||
          w.outputOutFrame <= w.outputInFrame ||
          w.outputOutFrame >
            projectFrameCount(
              v.trim.endFrame - v.trim.startFrame + 1,
              m.fps,
              v.speed,
              fps,
            ))
      )
        return 'Invalid normalized Video 1 window.';
    }
  for (const track of ['video2', 'music'] as const) {
    const lane = [...s[track]].sort(
      (a, b) => a.timelineStartFrame - b.timelineStartFrame,
    );
    for (let i = 0; i < lane.length; i++) {
      const v = lane[i],
        length = placementLength(v);
      if (!integer(v.timelineStartFrame) || !integer(length) || length < 1)
        return `${track}: invalid timeline range.`;
      if (
        i &&
        lane[i - 1].timelineStartFrame + placementLength(lane[i - 1]) >
          v.timelineStartFrame
      )
        return `This range overlaps another clip on ${track === 'video2' ? 'Video 2' : 'Background Music'}. Move it to a free range.`;
      if ('contentInFrame' in v) {
        if (
          !integer(v.contentInFrame) ||
          !integer(v.contentOutFrame) ||
          !['boolean'].includes(typeof v.contentFullSource) ||
          ![1, 0.75, 0.5].includes(v.speed)
        )
          return 'Invalid replacement source range.';
        const source = sources?.get(v.sourceId);
        if (
          sources &&
          (!source?.metadata ||
            source.status !== 'ready' ||
            source.mediaType !== 'video')
        )
          return 'Missing or unready replacement media.';
        if (
          source?.metadata &&
          fps &&
          (validateTrim(v.trim, source.metadata.totalFrames) ||
            v.contentOutFrame >
              projectFrameCount(
                v.trim.endFrame - v.trim.startFrame + 1,
                source.metadata.fps,
                v.speed,
                fps,
              ))
        )
          return 'Replacement range exceeds its source.';
      } else {
        if (!integer(v.sourceStartSample)) return 'Invalid music source range.';
        const source = sources?.get(v.sourceId);
        if (
          sources &&
          (!source ||
            source.mediaType !== 'audio' ||
            source.status !== 'ready' ||
            !source.sampleCount)
        )
          return 'Missing or unready music media.';
        if (
          source?.sampleCount &&
          fps &&
          (v.sourceStartSample >= source.sampleCount ||
            v.sourceStartSample +
              v.durationFrames * (48000 / fps) -
              source.sampleCount >=
              48000 / fps)
        )
          return 'Music range exceeds source EOF.';
      }
    }
  }
  if (sources && fps)
    return validateIndependentAudio(s, sources, fps)?.message ?? null;
  return null;
}
const result = (
  s: EditSnapshot,
  sources?: ProjectSources,
  fps?: ProjectFps,
): EditResult<EditSnapshot> => {
  if (sources && fps) {
    const issue = validateIndependentAudio(s, sources, fps);
    if (issue) return { error: issue };
  }
  const error = validatePositioned(s, sources, fps);
  return error
    ? {
        error: editIssue(
          error,
          error.includes('overlap') ? 'invalid_overlap' : 'invalid_range',
        ),
      }
    : { value: s };
};
export function movePositioned(
  s: EditSnapshot,
  track: PositionedTrack,
  id: string,
  start: number,
): EditResult<EditSnapshot> {
  if (!s[track].some((v) => v.id === id))
    return { error: editIssue('Missing timeline clip.', 'missing_source') };
  return result({
    ...s,
    [track]: s[track].map((v) =>
      v.id === id ? { ...v, timelineStartFrame: start } : v,
    ),
  });
}
export function trimPositioned(
  s: EditSnapshot,
  track: PositionedTrack,
  id: string,
  edge: 'start' | 'end',
  delta: number,
  fps: ProjectFps,
  sources: ProjectSources,
): EditResult<EditSnapshot> {
  if (!Number.isSafeInteger(delta) || !s[track].some((v) => v.id === id))
    return { error: editIssue('Invalid trim target.') };
  const next = s[track].map((v) => {
    if (v.id !== id) return v;
    if ('contentInFrame' in v)
      return {
        ...v,
        contentFullSource: false,
        timelineStartFrame:
          v.timelineStartFrame + (edge === 'start' ? delta : 0),
        contentInFrame: v.contentInFrame + (edge === 'start' ? delta : 0),
        contentOutFrame: v.contentOutFrame + (edge === 'end' ? delta : 0),
      };
    return {
      ...v,
      timelineStartFrame: v.timelineStartFrame + (edge === 'start' ? delta : 0),
      sourceStartSample:
        v.sourceStartSample + (edge === 'start' ? (delta * 48000) / fps : 0),
      durationFrames: v.durationFrames + (edge === 'start' ? -delta : delta),
    };
  });
  return result({ ...s, [track]: next }, sources, fps);
}
export function splitPositioned(
  s: EditSnapshot,
  track: PositionedTrack,
  id: string,
  frame: number,
  ids: { left: string; right: string },
  fps: ProjectFps,
): EditResult<EditSnapshot> {
  const v = s[track].find((v) => v.id === id);
  if (
    !v ||
    !Number.isSafeInteger(frame) ||
    frame <= v.timelineStartFrame ||
    frame >= v.timelineStartFrame + placementLength(v) ||
    ids.left === ids.right
  )
    return {
      error: editIssue('Move the playhead strictly inside a clip to split.'),
    };
  const length = frame - v.timelineStartFrame;
  let halves: (Video2Occurrence | MusicOccurrence)[];
  if ('contentInFrame' in v)
    halves = [
      {
        ...v,
        id: ids.left,
        contentOutFrame: v.contentInFrame + length,
        contentFullSource: false,
      },
      {
        ...v,
        id: ids.right,
        timelineStartFrame: frame,
        contentInFrame: v.contentInFrame + length,
        contentFullSource: false,
      },
    ];
  else
    halves = [
      { ...v, id: ids.left, durationFrames: length },
      {
        ...v,
        id: ids.right,
        timelineStartFrame: frame,
        sourceStartSample: v.sourceStartSample + (length * 48000) / fps,
        durationFrames: v.durationFrames - length,
      },
    ];
  return result({
    ...s,
    [track]: s[track].flatMap((v) => (v.id === id ? halves : [v])),
  });
}
export function rippleDeletePositioned(
  s: EditSnapshot,
  track: PositionedTrack,
  id: string,
): EditResult<EditSnapshot> {
  const target = s[track].find((v) => v.id === id);
  if (!target)
    return { error: editIssue('Missing timeline clip.', 'missing_source') };
  const next = s[track]
    .filter((v) => v.id !== id)
    .map((v) =>
      v.timelineStartFrame > target.timelineStartFrame
        ? {
            ...v,
            timelineStartFrame: v.timelineStartFrame - placementLength(target),
          }
        : v,
    );
  return result({
    ...s,
    [track]: next,
  });
}
export function changeReplacementSourceEdit(
  s: EditSnapshot,
  id: string,
  trim: ClipTrim,
  speed: ClipSpeed,
  sources: ProjectSources,
  fps: ProjectFps,
  kind: 'trim' | 'speed',
): EditResult<EditSnapshot> {
  const target = s.video2.find((v) => v.id === id),
    meta = target && sources.get(target.sourceId)?.metadata;
  if (!target || !meta || validateTrim(trim, meta.totalFrames))
    return { error: editIssue('Invalid replacement source trim.') };
  const full = kind === 'trim' || target.contentFullSource,
    length = projectFrameCount(
      trim.endFrame - trim.startFrame + 1,
      meta.fps,
      speed,
      fps,
    );
  return result(
    {
      ...s,
      video2: s.video2.map((v) =>
        v.id === id
          ? {
              ...v,
              trim,
              trimSaved: true,
              speed,
              contentFullSource: full,
              contentInFrame: full
                ? 0
                : Math.floor((v.contentInFrame * v.speed) / speed + 0.5),
              contentOutFrame: full
                ? length
                : Math.floor((v.contentOutFrame * v.speed) / speed + 0.5),
            }
          : v,
      ),
    },
    sources,
    fps,
  );
}
export function convertPositionedFps(
  s: EditSnapshot,
  oldFps: ProjectFps,
  newFps: ProjectFps,
  sources: ProjectSources,
): EditResult<EditSnapshot> {
  const round = (n: number) => Math.floor((n * newFps) / oldFps + 0.5);
  const video2 = s.video2.map((v) => {
    const meta = sources.get(v.sourceId)?.metadata;
    return {
      ...v,
      timelineStartFrame: round(v.timelineStartFrame),
      contentInFrame: v.contentFullSource ? 0 : round(v.contentInFrame),
      contentOutFrame:
        v.contentFullSource && meta
          ? projectFrameCount(
              v.trim.endFrame - v.trim.startFrame + 1,
              meta.fps,
              v.speed,
              newFps,
            )
          : round(v.contentOutFrame),
    };
  });
  return result(
    {
      ...s,
      video2,
      video1: s.video1.map((v) => ({
        ...v,
        ...(v.outputWindow
          ? {
              outputWindow: {
                outputInFrame: round(v.outputWindow.outputInFrame),
                outputOutFrame: round(v.outputWindow.outputOutFrame),
              },
            }
          : {}),
      })),
      independentAudio: s.independentAudio.map((v) => ({
        ...v,
        timelineStartFrame: round(v.timelineStartFrame),
        durationFrames: round(v.durationFrames),
      })),
      music: s.music.map((v) => ({
        ...v,
        timelineStartFrame: round(v.timelineStartFrame),
        durationFrames: round(v.durationFrames),
      })),
    },
    sources,
    newFps,
  );
}
