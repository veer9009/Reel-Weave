import { buildMergeManifest, isEditableClip } from './clips';
import type { MergeManifest, ProjectFps } from './clips';
import type { EditSnapshot } from './editHistory';
import type { ProjectSources } from './projectSources';
import type { OverlayState } from './overlays';
import type { MergeUploads } from './api';
import { materializeSnapshot } from './historyProjection';
export type AdvancedMergeManifest = Omit<MergeManifest, 'clips'> & {
  schema_version: 2;
  video_sources: { source_id: string }[];
  clips: (MergeManifest['clips'][number] & { source_id: string })[];
  video2: (MergeManifest['clips'][number] & {
    source_id: string;
    timeline_start_frame: number;
    content_in_frame: number;
    content_out_frame: number;
    content_full_source: boolean;
  })[];
  music: null | {
    source_id: string;
    segments: {
      client_id: string;
      source_id: string;
      timeline_start_frame: number;
      source_start_sample: number;
      duration_frames: number;
    }[];
  };
};
export function buildAdvancedMergeRequest(
  s: EditSnapshot,
  sources: ProjectSources,
  outputFps: ProjectFps,
  overlays: OverlayState,
): {
  manifest: AdvancedMergeManifest;
  videoFiles: File[];
  uploads: MergeUploads;
} {
  const m = materializeSnapshot(s, sources);
  if (!m.clips.length || !m.clips.every(isEditableClip))
    throw new Error('Video source timing unavailable.');
  const legacy = buildMergeManifest(m.clips, s.audio, outputFps, overlays);
  const ids = [...new Set([...s.video1, ...s.video2].map((v) => v.sourceId))];
  const videoFiles = ids.map((id) => {
    const r = sources.get(id);
    if (!r || r.status !== 'ready') throw new Error('Missing video source.');
    return r.file;
  });
  return {
    videoFiles,
    manifest: {
      ...legacy,
      schema_version: 2,
      video_sources: ids.map((source_id) => ({ source_id })),
      clips: legacy.clips.map((v) => ({
        ...v,
        source_id: s.video1.find((n) => n.id === v.client_id)!.sourceId,
      })),
      video2: [...s.video2]
        .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame)
        .map((v) => ({
          client_id: v.id,
          source_id: v.sourceId,
          start_frame: v.trim.startFrame,
          end_frame: v.trim.endFrame,
          speed: v.speed,
          trim_saved: v.trimSaved,
          timeline_start_frame: v.timelineStartFrame,
          content_in_frame: v.contentInFrame,
          content_out_frame: v.contentOutFrame,
          content_full_source: v.contentFullSource,
        })),
      music: s.musicSourceId
        ? {
            source_id: s.musicSourceId,
            segments: s.music.map((v) => ({
              client_id: v.id,
              source_id: v.sourceId,
              timeline_start_frame: v.timelineStartFrame,
              source_start_sample: v.sourceStartSample,
              duration_frames: v.durationFrames,
            })),
          }
        : null,
    },
    uploads: {
      backgroundAudio: s.musicSourceId
        ? sources.get(s.musicSourceId)?.file
        : undefined,
      overlayImage: overlays.image?.file,
      overlayVideo: overlays.video?.file,
    },
  };
}
