import type { HistoryAction } from './editHistory';
import type { AdvancedTimelineProjection } from './advancedTimeline';
export type TransportAnchor = {
  frame: number;
  projectSeconds: number;
  playingIntent: boolean;
  occurrenceId: string | null;
  sourceId: string | null;
  sourceTime: number | null;
};
export type TransportEdit = {
  token: number;
  before: AdvancedTimelineProjection;
  after: AdvancedTimelineProjection;
  action: HistoryAction | 'undo' | 'redo';
  lineage: ReadonlyMap<string, string>;
};
export function mapTransportAnchor(
  anchor: TransportAnchor,
  edit: TransportEdit,
): { frame: number | null; playingIntent: boolean } {
  const { before, after, action } = edit,
    n = after.base.totalFrames,
    fps = after.base.fps;
  if (after.base.status !== 'ready' || !fps || n < 1)
    return { frame: null, playingIntent: false };
  const live = anchor.projectSeconds * (before.base.fps ?? fps);
  let frame = Math.abs(live - anchor.frame) < 1e-9 ? anchor.frame : live;
  if (action === 'fps' || before.base.fps !== fps)
    frame = Math.floor(anchor.projectSeconds * fps + 0.5);
  else if (action === 'reorder' || action === 'version-replace') {
    const old = before.base.items.find(
        (v) => v.clip.id === anchor.occurrenceId,
      ),
      next = after.base.items.find((v) => v.clip.id === anchor.occurrenceId);
    if (old && next)
      frame =
        next.startFrame + Math.min(next.frameCount - 1, frame - old.startFrame);
  } else if (action === 'ripple-delete') {
    const removed = before.base.items.filter(
      (v) => !after.base.items.some((a) => a.clip.id === v.clip.id),
    );
    let offset = 0;
    for (const v of removed) {
      if (anchor.frame > v.endFrame) offset += v.frameCount;
      else if (anchor.frame >= v.startFrame) {
        frame = v.startFrame - offset;
        break;
      }
    }
    if (
      !removed.some(
        (v) => anchor.frame >= v.startFrame && anchor.frame <= v.endFrame,
      )
    )
      frame = live - offset;
  } else if (
    (action === 'split' && edit.lineage.size) ||
    action === 'undo' ||
    action === 'redo'
  ) {
    const candidates = [
      ...after.base.items.map((v) => ({
        clip: v.clip,
        start: v.startFrame,
        length: v.frameCount,
        offset: v.clip.outputWindow?.outputInFrame ?? 0,
        sourceId: after.resolved.find((r) => r.occurrenceId === v.clip.id)
          ?.sourceId,
      })),
      ...after.video2.map((v) => ({
        clip: v.clip,
        start: v.timelineStartFrame,
        length: v.contentOutFrame - v.contentInFrame,
        offset: v.contentInFrame,
        sourceId: v.sourceId,
      })),
    ];
    const matches = candidates
      .flatMap((v) => {
        if (
          anchor.sourceTime === null ||
          (v.sourceId !== anchor.sourceId &&
            v.clip.id !== anchor.occurrenceId &&
            edit.lineage.get(v.clip.id) !== anchor.occurrenceId)
        )
          return [];
        const local =
          ((anchor.sourceTime - v.clip.trim.startFrame / v.clip.metadata.fps) *
            fps) /
            v.clip.speed -
          v.offset;
        if (local < -0.500001 || local >= v.length + 0.5) return [];
        return [
          {
            frame: v.start + Math.max(0, Math.min(v.length - 1e-9, local)),
            same: v.clip.id === anchor.occurrenceId,
          },
        ];
      })
      .sort(
        (a, b) =>
          Number(b.same) - Number(a.same) ||
          Math.abs(a.frame - anchor.frame) - Math.abs(b.frame - anchor.frame),
      );
    if (matches.length) frame = matches[0].frame;
  }
  return {
    frame: Math.max(0, Math.min(n - 1, frame)),
    playingIntent: anchor.playingIntent && frame < n,
  };
}
