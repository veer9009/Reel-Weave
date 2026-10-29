import { apiUrl } from './api';
import type { AudioRecipe } from './audioTimeline';
import type { ProjectFps } from './clips';
import { projectFrameCount } from './overlays';

export async function preparePreviewAudioRecipe(
  source: { file: File; metadata?: { fps: number } },
  recipe: Extract<AudioRecipe, { kind: 'video-edit' }>,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  if (!source.metadata) throw new Error('Missing sound recipe metadata.');
  const duration = projectFrameCount(
    recipe.sourceEndFrame - recipe.sourceStartFrame + 1,
    source.metadata.fps,
    recipe.speed,
    recipe.normalizationFps,
  );
  const manifest = {
    schema_version: 3,
    output_fps: recipe.normalizationFps as ProjectFps,
    video_sources: [{ source_id: recipe.sourceId }],
    audio_sources: [],
    order: ['preview_recipe'],
    clips: [
      {
        client_id: 'preview_recipe',
        source_id: recipe.sourceId,
        start_frame: recipe.sourceStartFrame,
        end_frame: recipe.sourceEndFrame,
        speed: recipe.speed,
        trim_saved: true,
        timeline_start_frame: 0,
        duration_frames: duration,
        output_in_frame: 0,
        output_out_frame: duration,
        original_audio: 'linked',
      },
    ],
    video2: [],
    independent_audio: [],
    music: null,
    overlays: { image: null, video: null },
    audio: {
      original_volume: 1,
      original_muted: false,
      music_volume: 0,
      music_muted: true,
    },
    exports: ['mp4', 'wav'],
  };
  const body = new FormData();
  body.append('files', source.file);
  body.append('manifest', JSON.stringify(manifest));
  const response = await fetch(apiUrl('/api/preview-audio'), {
    method: 'POST',
    body,
    signal,
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(
      failure?.error?.message ?? 'Sound recipe preparation failed.',
    );
  }
  return response.blob();
}
