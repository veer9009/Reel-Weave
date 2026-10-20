import type { Limits } from './clips';
import type { SourceKind } from './projectSources';
import type { ProjectResult, ProjectSourceV1 } from './projectFileTypes';
import { projectFailure } from './projectFileTypes';
export type LocalMediaMetadata =
  | {
      mediaType: 'video';
      durationSeconds: number;
      width: number;
      height: number;
    }
  | { mediaType: 'audio'; durationSeconds: number }
  | { mediaType: 'image'; width: number; height: number };
export type CandidateEvidence = {
  file: File;
  sha256: string;
  metadata: LocalMediaMetadata;
};
export type ProjectMediaVerifier = {
  fingerprint(file: File, signal: AbortSignal): Promise<ProjectResult<string>>;
  inspect(
    file: File,
    expectedType: ProjectSourceV1['mediaType'],
    signal: AbortSignal,
  ): Promise<ProjectResult<LocalMediaMetadata>>;
  dispose(): void;
};
export function createProjectMediaVerifier(): ProjectMediaVerifier {
  const cache = new WeakMap<File, string>();
  const probes = new Set<() => void>();
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();
  const cancelled = <T>(): ProjectResult<T> =>
    projectFailure('cancelled', 'Media verification cancelled.');
  return {
    fingerprint(file, signal) {
      const pending = queue.then(async (): Promise<ProjectResult<string>> => {
        if (disposed || signal.aborted) return cancelled();
        const known = cache.get(file);
        if (known) return { ok: true, value: known };
        try {
          const bytes = await file.arrayBuffer();
          if (disposed || signal.aborted) return cancelled();
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          if (disposed || signal.aborted) return cancelled();
          const value = Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
          cache.set(file, value);
          return { ok: true, value };
        } catch {
          return disposed || signal.aborted
            ? cancelled()
            : projectFailure(
                'media',
                'Could not read or fingerprint media. Retry with the original file.',
              );
        }
      });
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    inspect(file, expectedType, signal) {
      if (disposed || signal.aborted) return Promise.resolve(cancelled());
      return new Promise((resolve) => {
        let url: string;
        try {
          url = URL.createObjectURL(file);
        } catch {
          resolve(projectFailure('resource', 'Could not open local media.'));
          return;
        }
        const element =
          expectedType === 'image'
            ? new Image()
            : document.createElement(expectedType);
        let settled = false;
        const finish = (result: ProjectResult<LocalMediaMetadata>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', cancel);
          probes.delete(cancel);
          element.removeEventListener('error', error);
          element.removeEventListener('load', ready);
          element.removeEventListener('loadedmetadata', ready);
          if (element instanceof HTMLMediaElement) element.pause();
          element.removeAttribute('src');
          if (element instanceof HTMLMediaElement) element.load();
          URL.revokeObjectURL(url);
          resolve(result);
        };
        const cancel = () => finish(cancelled());
        const error = () =>
          finish(
            projectFailure(
              'media',
              'Could not decode the selected media. Locate the original supported file.',
            ),
          );
        const ready = () => {
          if (signal.aborted || disposed) {
            cancel();
            return;
          }
          if (element instanceof HTMLImageElement) {
            if (element.naturalWidth < 1 || element.naturalHeight < 1) {
              error();
              return;
            }
            finish({
              ok: true,
              value: {
                mediaType: 'image',
                width: element.naturalWidth,
                height: element.naturalHeight,
              },
            });
          } else {
            if (!Number.isFinite(element.duration) || element.duration <= 0) {
              error();
              return;
            }
            if (element instanceof HTMLVideoElement) {
              if (element.videoWidth < 1 || element.videoHeight < 1) {
                error();
                return;
              }
              finish({
                ok: true,
                value: {
                  mediaType: 'video',
                  durationSeconds: element.duration,
                  width: element.videoWidth,
                  height: element.videoHeight,
                },
              });
            } else
              finish({
                ok: true,
                value: {
                  mediaType: 'audio',
                  durationSeconds: element.duration,
                },
              });
          }
        };
        const timer = setTimeout(
          () =>
            finish(
              projectFailure(
                'media',
                'Reading media timed out. Retry or locate another original file.',
              ),
            ),
          15000,
        );
        probes.add(cancel);
        signal.addEventListener('abort', cancel, { once: true });
        element.addEventListener('error', error);
        element.addEventListener('load', ready);
        element.addEventListener('loadedmetadata', ready);
        if (element instanceof HTMLMediaElement) {
          element.muted = true;
          element.preload = 'metadata';
        }
        element.src = url;
        if (element instanceof HTMLMediaElement) element.load();
        if (signal.aborted) cancel();
      });
    },
    dispose() {
      disposed = true;
      for (const cancel of [...probes]) cancel();
    },
  };
}
export function checkRelinkFileBasics(
  source: ProjectSourceV1,
  file: File,
  limits: Limits,
  roles: ReadonlySet<SourceKind>,
): ProjectResult<void> {
  const pattern =
    source.mediaType === 'image'
      ? /\.(png|jpe?g)$/i
      : source.mediaType === 'audio'
        ? /\.(mp3|wav|aac|m4a)$/i
        : /\.(mp4|mov|webm|mkv)$/i;
  if (!pattern.test(file.name))
    return projectFailure('media', 'Unsupported media file type.');
  if (file.size !== source.sizeBytes || !file.size)
    return projectFailure(
      'media',
      'File size does not match the saved source.',
    );
  const limit =
    source.mediaType === 'image'
      ? (limits.max_overlay_image_file_size_mb ?? 20)
      : source.mediaType === 'audio'
        ? (limits.max_audio_file_size_mb ?? 100)
        : limits.max_file_size_mb;
  const pipLimit = roles.has('pip')
    ? (limits.max_overlay_video_file_size_mb ?? 200)
    : Infinity;
  if (file.size > Math.min(limit, pipLimit) * 1024 * 1024)
    return projectFailure('media', 'Media exceeds its current size limit.');
  return { ok: true, value: undefined };
}
export function checkRelinkCandidate(
  source: ProjectSourceV1,
  evidence: CandidateEvidence,
  limits: Limits,
  roles: ReadonlySet<SourceKind>,
): ProjectResult<{ renamed: boolean }> {
  const basic = checkRelinkFileBasics(source, evidence.file, limits, roles);
  if (!basic.ok) return basic;
  if (source.sha256 !== evidence.sha256)
    return projectFailure(
      'media',
      'Fingerprint does not match the original media.',
    );
  const actual = evidence.metadata;
  if (actual.mediaType !== source.mediaType)
    return projectFailure('media', 'Media category does not match.');
  if (source.mediaType !== 'image' && actual.mediaType !== 'image') {
    const expected = source.metadata.durationSeconds;
    const tolerance =
      source.mediaType === 'video' && source.metadata.clipMetadata
        ? Math.max(0.05, 1 / source.metadata.clipMetadata.fps)
        : 0.05;
    const roundoff =
      4 * Number.EPSILON * Math.max(1, expected, actual.durationSeconds);
    if (
      !Number.isFinite(actual.durationSeconds) ||
      actual.durationSeconds <= 0 ||
      Math.abs(expected - actual.durationSeconds) > tolerance + roundoff
    )
      return projectFailure(
        'media',
        'Media duration does not match saved metadata.',
      );
  }
  if (source.mediaType !== 'audio' && actual.mediaType !== 'audio') {
    if (
      actual.width < 1 ||
      actual.height < 1 ||
      (source.metadata.width !== undefined &&
        source.metadata.width !== actual.width) ||
      (source.metadata.height !== undefined &&
        source.metadata.height !== actual.height)
    )
      return projectFailure(
        'media',
        'Image/video dimensions do not match saved metadata.',
      );
  }
  return {
    ok: true,
    value: { renamed: source.originalName !== evidence.file.name },
  };
}
