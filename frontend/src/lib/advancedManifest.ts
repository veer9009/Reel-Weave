import { buildMergeManifest, isEditableClip } from './clips';
import type { MergeManifest, ProjectFps } from './clips';
import type { EditSnapshot } from './editHistory';
import type { ProjectSources } from './projectSources';
import type { OverlayState } from './overlays';
import type { MergeUploads } from './api';
import { materializeSnapshot } from './historyProjection';
import { validateRestoration } from './historyProjection';
import { buildAdvancedTimeline } from './advancedTimeline';
import type { Limits } from './clips';
import type { ExportFormat } from './api';
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
  includeMusic = true,
): {
  manifest: AdvancedMergeManifest;
  videoFiles: File[];
  uploads: MergeUploads;
} {
  if (includeMusic && requiresV4(s))
    throw new Error('Multiple music sources require the V4 render contract.');
  const musicSourceId = s.music[0]?.sourceId;
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
      music:
        includeMusic && musicSourceId
          ? {
              source_id: musicSourceId,
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
      backgroundAudio:
        includeMusic && musicSourceId
          ? sources.get(musicSourceId)?.file
          : undefined,
      overlayImage: overlays.image?.file,
      overlayVideo: overlays.video?.file,
    },
  };
}

export type V3AudioRecipe =
  | { kind: 'audio-file'; source_id: string }
  | {
      kind: 'video-edit';
      source_id: string;
      source_start_frame: number;
      source_end_frame: number;
      speed: number;
      normalization_fps: ProjectFps;
    };
export type V3MergeManifest = Omit<
  AdvancedMergeManifest,
  'schema_version' | 'clips' | 'video2'
> & {
  schema_version: 3;
  clips: (AdvancedMergeManifest['clips'][number] & {
    timeline_start_frame: number;
    duration_frames: number;
    output_in_frame: number;
    output_out_frame: number;
    original_audio: 'linked' | 'detached';
  })[];
  video2: (AdvancedMergeManifest['video2'][number] & {
    original_audio: 'linked' | 'detached';
  })[];
  audio_sources: { source_id: string }[];
  independent_audio: {
    id: string;
    timeline_start_frame: number;
    duration_frames: number;
    source_start_sample: number;
    source: V3AudioRecipe;
    detached_from?: { track: 'video1' | 'video2'; clip_id: string };
  }[];
  exports: ExportFormat[];
};
export type V3MergeRequest = {
  manifest: V3MergeManifest;
  videoFiles: File[];
  audioFiles: File[];
  uploads: Pick<MergeUploads, 'overlayImage' | 'overlayVideo'>;
};
export function requiresV3(
  s: EditSnapshot,
  exports: readonly ExportFormat[],
): boolean {
  return (
    s.independentAudio.length > 0 ||
    [...s.video1, ...s.video2].some(
      (v) =>
        v.originalAudio === 'detached' ||
        ('outputWindow' in v && Boolean(v.outputWindow)),
    ) ||
    exports.some((v) => v !== 'mp4')
  );
}
export function validateManifestSize(json: string): void {
  if (new TextEncoder().encode(json).byteLength > 65536)
    throw new Error('Timeline description exceeds the render limit');
}
export type V4MergeManifest = Omit<
  V3MergeManifest,
  'schema_version' | 'music'
> & {
  schema_version: 4;
  music: null | { segments: NonNullable<V3MergeManifest['music']>['segments'] };
};
export type V4MergeRequest = Omit<V3MergeRequest, 'manifest'> & {
  manifest: V4MergeManifest;
};

export function requiresV4(s: EditSnapshot): boolean {
  return new Set(s.music.map((v) => v.sourceId)).size > 1;
}

const defaultRenderLimits: Limits = {
  max_clips: 20,
  max_file_size_mb: 200,
  max_audio_file_size_mb: 100,
};

export function buildV3MergeRequest(
  s: EditSnapshot,
  sources: ProjectSources,
  outputFps: ProjectFps,
  overlays: OverlayState,
  exports: readonly ExportFormat[],
  limits: Limits = defaultRenderLimits,
): V3MergeRequest {
  if (requiresV4(s))
    throw new Error('Multiple music sources require the V4 render contract.');
  return buildModernMergeRequest(
    s,
    sources,
    outputFps,
    overlays,
    exports,
    limits,
    3,
  ) as V3MergeRequest;
}

export function buildV4MergeRequest(
  s: EditSnapshot,
  sources: ProjectSources,
  outputFps: ProjectFps,
  overlays: OverlayState,
  exports: readonly ExportFormat[],
  limits: Limits = defaultRenderLimits,
): V4MergeRequest {
  return buildModernMergeRequest(
    s,
    sources,
    outputFps,
    overlays,
    exports,
    limits,
    4,
  ) as V4MergeRequest;
}

function buildModernMergeRequest(
  s: EditSnapshot,
  sources: ProjectSources,
  outputFps: ProjectFps,
  overlays: OverlayState,
  exports: readonly ExportFormat[],
  limits: Limits,
  version: 3 | 4,
): Omit<V3MergeRequest, 'manifest'> & {
  manifest: V3MergeManifest | V4MergeManifest;
} {
  if (
    !exports.includes('mp4') ||
    new Set(exports).size !== exports.length ||
    exports.some((v) => !['mp4', 'mov', 'wav', 'mp3'].includes(v))
  )
    throw new Error('Choose unique supported export formats including MP4.');
  const problem = validateRestoration(s, sources, limits);
  if (problem) throw new Error(problem);
  const projection = buildAdvancedTimeline(s, sources, overlays);
  if (projection.base.status !== 'ready' || projection.renderErrors.length)
    throw new Error(
      projection.renderErrors[0] ?? 'Video 1 is required for every export.',
    );
  const legacy = buildAdvancedMergeRequest(
    s,
    sources,
    outputFps,
    overlays,
    version === 3,
  );
  const videoIds = [
    ...new Set(
      [
        ...s.video1,
        ...s.video2,
        ...s.independentAudio
          .filter((v) => v.source.kind === 'video-edit')
          .map((v) => ({ sourceId: v.source.sourceId })),
      ].map((v) => v.sourceId),
    ),
  ];
  const audioIds = [
    ...new Set([
      ...s.independentAudio
        .filter((v) => v.source.kind === 'audio-file')
        .map((v) => v.source.sourceId),
      ...s.music.map((v) => v.sourceId),
    ]),
  ];
  const files = (ids: string[], type: 'video' | 'audio') =>
    ids.map((id) => {
      const source = sources.get(id);
      if (!source || source.status !== 'ready' || source.mediaType !== type)
        throw new Error('Missing or unready render source.');
      return source.file;
    });
  const videoFiles = files(videoIds, 'video'),
    audioFiles = files(audioIds, 'audio');
  if (
    videoFiles.length > limits.max_clips ||
    audioFiles.length > limits.max_clips ||
    s.independentAudio.length + s.music.length > 10 * limits.max_clips
  )
    throw new Error('Render source or segment limit exceeded.');
  if (
    audioFiles.reduce((n, file) => n + file.size, 0) >
    (limits.max_audio_file_size_mb ?? 100) * 1024 * 1024
  )
    throw new Error('Combined audio files exceed the audio upload limit.');
  const manifest: V3MergeManifest = {
    ...legacy.manifest,
    schema_version: 3,
    video_sources: videoIds.map((source_id) => ({ source_id })),
    audio_sources: audioIds.map((source_id) => ({ source_id })),
    exports: [...exports],
    clips: legacy.manifest.clips.map((v) => {
      const item = projection.base.items.find(
        (i) => i.clip.id === v.client_id,
      )!;
      return {
        ...v,
        timeline_start_frame: item.startFrame,
        duration_frames: item.frameCount,
        output_in_frame: item.clip.outputWindow?.outputInFrame ?? 0,
        output_out_frame:
          item.clip.outputWindow?.outputOutFrame ?? item.frameCount,
        original_audio: item.clip.originalAudio ?? 'linked',
      };
    }),
    video2: legacy.manifest.video2.map((v) => ({
      ...v,
      original_audio:
        s.video2.find((i) => i.id === v.client_id)?.originalAudio ?? 'linked',
    })),
    independent_audio: s.independentAudio.map((v) => ({
      id: v.id,
      timeline_start_frame: v.timelineStartFrame,
      duration_frames: v.durationFrames,
      source_start_sample: v.sourceStartSample,
      source:
        v.source.kind === 'audio-file'
          ? { kind: 'audio-file', source_id: v.source.sourceId }
          : {
              kind: 'video-edit',
              source_id: v.source.sourceId,
              source_start_frame: v.source.sourceStartFrame,
              source_end_frame: v.source.sourceEndFrame,
              speed: v.source.speed,
              normalization_fps: v.source.normalizationFps,
            },
      ...(v.detachedFrom
        ? {
            detached_from: {
              track: v.detachedFrom.track,
              clip_id: v.detachedFrom.clipId,
            },
          }
        : {}),
    })),
  };
  const identifiers = [
    ...videoIds,
    ...audioIds,
    ...s.video1.map((v) => v.id),
    ...s.video2.map((v) => v.id),
    ...s.music.map((v) => v.id),
    ...s.independentAudio.flatMap((v) => [
      v.id,
      ...(v.detachedFrom ? [v.detachedFrom.clipId] : []),
    ]),
  ];
  if (
    identifiers.some(
      (id) => !id.trim() || new TextEncoder().encode(id).byteLength > 128,
    )
  )
    throw new Error('Render identifiers exceed the supported limit.');
  const outputManifest: V3MergeManifest | V4MergeManifest =
    version === 4
      ? {
          ...manifest,
          schema_version: 4,
          music: s.music.length
            ? {
                segments: s.music.map((v) => ({
                  client_id: v.id,
                  source_id: v.sourceId,
                  timeline_start_frame: v.timelineStartFrame,
                  source_start_sample: v.sourceStartSample,
                  duration_frames: v.durationFrames,
                })),
              }
            : null,
        }
      : manifest;
  validateManifestSize(JSON.stringify(outputManifest));
  return {
    manifest: outputManifest,
    videoFiles: [...videoFiles],
    audioFiles: [...audioFiles],
    uploads: {
      overlayImage: legacy.uploads.overlayImage,
      overlayVideo: legacy.uploads.overlayVideo,
    },
  };
}
