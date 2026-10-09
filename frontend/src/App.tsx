import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { UploadCard } from './components/UploadCard';
import { ClipList } from './components/ClipList';
import { MergeSummary } from './components/MergeSummary';
import { JobResult } from './components/JobResult';
import { TrimEditor } from './components/TrimEditor';
import { BackgroundAudioTrack } from './components/BackgroundAudioTrack';
import { OverlayTrack } from './components/OverlayTrack';
import { EditingWorkspace } from './components/EditingWorkspace';
import {
  buildTimeline,
  planClipSplit,
  planVersionReplacement,
} from './lib/timeline';
import type { BackgroundAudio } from './components/BackgroundAudioTrack';
import { ApiError, getHealth, getJob, submitMerge } from './lib/api';
import type { Health, Job } from './lib/api';
import {
  buildMergeManifest,
  isEditableClip,
  moveClip,
  validateSelection,
} from './lib/clips';
import type {
  AudioSettings,
  Clip,
  ClipMetadata,
  ClipSpeed,
  ClipTrim,
  ProjectFpsSelection,
} from './lib/clips';
import {
  defaultOverlaySchedule,
  validateOverlaySchedule,
} from './lib/overlays';
import type {
  OverlayKind,
  OverlaySchedule,
  OverlayState,
} from './lib/overlays';

export default function App() {
  const [structuralRevision, setStructuralRevision] = useState(0);
  const resultRegion = useRef<HTMLDivElement>(null);
  const [fpsSelection, setFpsSelection] = useState<ProjectFpsSelection>('auto');
  const [clips, setClips] = useState<Clip[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [backgroundAudio, setBackgroundAudio] =
    useState<BackgroundAudio | null>(null);
  const [overlays, setOverlays] = useState<OverlayState>({
    image: null,
    video: null,
  });
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    originalVolume: 1,
    originalMuted: false,
    musicVolume: 0.3,
    musicMuted: false,
  });
  const urls = useRef(new Set<string>());
  const uploadController = useRef<AbortController | null>(null);
  const active =
    uploading || job?.status === 'queued' || job?.status === 'processing';
  const completed = job?.status === 'completed';
  const limits = health?.limits ?? {
    max_clips: 20,
    max_file_size_mb: 200,
    max_audio_file_size_mb: 100,
    max_overlay_image_file_size_mb: 20,
    max_overlay_video_file_size_mb: 200,
  };
  const editableClips = clips.filter(isEditableClip);
  const editsValid =
    editableClips.length === clips.length &&
    (!backgroundAudio || backgroundAudio.status === 'ready');
  const timeline = buildTimeline(clips, fpsSelection);
  const outputFps = timeline.fps;
  const totalProjectFrames = timeline.totalFrames;
  const overlaysValid = (['image', 'video'] as const).every((kind) => {
    const overlay = overlays[kind];
    return (
      !overlay ||
      (overlay.metadataStatus === 'ready' &&
        validateOverlaySchedule(overlay, totalProjectFrames) === null)
    );
  });
  const canMerge = Boolean(
    !active &&
    !completed &&
    clips.length >= 1 &&
    health?.ffmpeg_available &&
    health.ffprobe_available &&
    editsValid &&
    overlaysValid &&
    outputFps !== null,
  );
  const displayedError =
    error ??
    (health && (!health.ffmpeg_available || !health.ffprobe_available)
      ? 'Video processing is unavailable. Install FFmpeg and FFprobe, then check the backend configuration.'
      : null);

  useEffect(() => {
    const ownedUrls = urls.current;
    return () => {
      ownedUrls.forEach((url) => URL.revokeObjectURL(url));
      ownedUrls.clear();
      uploadController.current?.abort();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    getHealth(controller.signal)
      .then((result) => {
        if (disposed) return;
        setHealth(result);
      })
      .catch(() => {
        if (!disposed)
          setError(
            'Could not reach the backend. Start the API, then retry the connection.',
          );
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [healthAttempt]);

  const jobId = job?.job_id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || (jobStatus !== 'queued' && jobStatus !== 'processing'))
      return;
    let disposed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll() {
      timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const result = await getJob(jobId!, controller.signal);
        if (disposed) return;
        setJob(result);
        setPollError(false);
        if (result.status === 'failed')
          setError(
            result.error ||
              'This merge could not be completed. Try different clips.',
          );
        else if (result.status === 'queued' || result.status === 'processing')
          next = setTimeout(() => void poll(), 1500);
      } catch (cause) {
        if (disposed) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setJob(null);
          setError(
            'This job is no longer available. It may have expired or the backend restarted. You can merge these clips again.',
          );
        } else {
          setPollError(true);
          setError(
            'We could not check your merge status. Your job may still be processing. Retry status to reconnect.',
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(next);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [jobId, jobStatus, pollAttempt]);

  function selectFiles(files: File[]) {
    if (active || completed || !health || !files.length) return;
    const validation = validateSelection(files, clips.length, limits);
    if (validation) {
      setError(validation);
      return;
    }
    const additions = files.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return {
        id: crypto.randomUUID(),
        file,
        url,
        metadataStatus: 'loading' as const,
        trimSaved: false,
        speed: 1 as const,
      };
    });
    setClips((current) => [...current, ...additions]);
    setStructuralRevision((n) => n + 1);
    setError(null);
    setJob(null);
    setAnnouncement(
      `${files.length} ${files.length === 1 ? 'clip' : 'clips'} added.`,
    );
  }
  function setClipMetadata(id: string, metadata: ClipMetadata) {
    setClips((current) =>
      current.map((clip) =>
        clip.id === id
          ? {
              ...clip,
              duration: metadata.duration,
              metadata,
              metadataStatus: 'ready',
              trim: clip.trim ?? {
                startFrame: 0,
                endFrame: metadata.totalFrames - 1,
              },
              trimSaved: clip.trimSaved ?? false,
              speed: clip.speed ?? 1,
            }
          : clip,
      ),
    );
  }
  function setClipMetadataError(id: string) {
    const clip = clips.find((candidate) => candidate.id === id);
    setClips((current) =>
      current.map((candidate) =>
        candidate.id === id
          ? { ...candidate, metadataStatus: 'error' }
          : candidate,
      ),
    );
    setError(
      `Could not read metadata for ${clip?.file.name ?? 'this clip'}. Remove it and choose a browser-readable video.`,
    );
  }
  function saveTrim(id: string, trim: ClipTrim) {
    if (active || completed) return;
    setClips((current) =>
      current.map((clip) =>
        clip.id === id ? { ...clip, trim, trimSaved: true } : clip,
      ),
    );
    setEditingClipId(null);
    setJob(null);
    setStructuralRevision((n) => n + 1);
  }
  function changeSpeed(id: string, speed: ClipSpeed) {
    setStructuralRevision((n) => n + 1);
    setClips((current) =>
      current.map((clip) => (clip.id === id ? { ...clip, speed } : clip)),
    );
    setJob(null);
  }
  function selectBackgroundAudio(file: File) {
    if (!/\.(mp3|wav|aac|m4a)$/i.test(file.name)) {
      setError('Choose an MP3, WAV, AAC, or M4A background-audio file.');
      return;
    }
    const maxBytes = (limits.max_audio_file_size_mb ?? 100) * 1024 * 1024;
    if (!file.size || file.size > maxBytes) {
      setError(
        file.size
          ? `Background audio exceeds the ${limits.max_audio_file_size_mb ?? 100} MB limit.`
          : 'Background audio is empty.',
      );
      return;
    }
    if (backgroundAudio) {
      URL.revokeObjectURL(backgroundAudio.url);
      urls.current.delete(backgroundAudio.url);
    }
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    setBackgroundAudio({ file, url, status: 'loading' });
    setStructuralRevision((n) => n + 1);
    setError(null);
  }
  function removeBackgroundAudio() {
    setStructuralRevision((n) => n + 1);
    if (!backgroundAudio) return;
    URL.revokeObjectURL(backgroundAudio.url);
    urls.current.delete(backgroundAudio.url);
    setBackgroundAudio(null);
    setJob(null);
  }
  function selectOverlay(kind: OverlayKind, file: File) {
    if (active || job?.status === 'completed') return;
    const isImage = kind === 'image';
    const supported = isImage
      ? /\.(png|jpe?g)$/i.test(file.name)
      : /\.(mp4|mov|webm|mkv)$/i.test(file.name);
    if (!supported) {
      setError(
        isImage
          ? 'Choose a PNG or JPG image overlay.'
          : 'Choose an MP4, MOV, WebM, or MKV video overlay.',
      );
      return;
    }
    const limit = isImage
      ? (limits.max_overlay_image_file_size_mb ?? 20)
      : (limits.max_overlay_video_file_size_mb ?? 200);
    if (!file.size || file.size > limit * 1024 * 1024) {
      setError(
        file.size
          ? `${isImage ? 'Image' : 'Video'} overlay exceeds the ${limit} MB limit.`
          : `${isImage ? 'Image' : 'Video'} overlay is empty.`,
      );
      return;
    }
    if (totalProjectFrames < 1) {
      setError('Add ready Video 1 clips before choosing an overlay.');
      return;
    }
    setStructuralRevision((value) => value + 1);
    const previous = overlays[kind];
    const schedule =
      previous && validateOverlaySchedule(previous, totalProjectFrames) === null
        ? {
            startFrame: previous.startFrame,
            endFrame: previous.endFrame,
            position: previous.position,
            size: previous.size,
          }
        : defaultOverlaySchedule(kind, totalProjectFrames);
    if (previous) {
      URL.revokeObjectURL(previous.url);
      urls.current.delete(previous.url);
    }
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    setOverlays((current) => ({
      ...current,
      [kind]: {
        kind,
        file,
        url,
        metadataStatus: 'loading',
        ...schedule,
      },
    }));
    setError(null);
    setJob(null);
  }
  function setOverlayMetadata(kind: OverlayKind, duration?: number) {
    setOverlays((current) => {
      const overlay = current[kind];
      if (!overlay) return current;
      return {
        ...current,
        [kind]: { ...overlay, metadataStatus: 'ready', duration },
      };
    });
  }
  function setOverlayMetadataError(kind: OverlayKind) {
    setOverlays((current) => {
      const overlay = current[kind];
      return overlay
        ? { ...current, [kind]: { ...overlay, metadataStatus: 'error' } }
        : current;
    });
    setError(
      `Could not read the ${kind} overlay. Remove it and choose another file.`,
    );
  }
  function changeOverlaySchedule(
    kind: OverlayKind,
    changes: Partial<OverlaySchedule>,
  ) {
    setStructuralRevision((n) => n + 1);
    setOverlays((current) => ({
      ...current,
      [kind]: current[kind] ? { ...current[kind], ...changes } : null,
    }));
    setJob(null);
  }
  function removeOverlay(kind: OverlayKind) {
    setStructuralRevision((n) => n + 1);
    const overlay = overlays[kind];
    if (!overlay) return;
    URL.revokeObjectURL(overlay.url);
    urls.current.delete(overlay.url);
    setOverlays((current) => ({ ...current, [kind]: null }));
    setError(null);
    setJob(null);
  }
  function removeClip(id: string) {
    if (active || completed) return;
    setStructuralRevision((n) => n + 1);
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    URL.revokeObjectURL(clip.url);
    urls.current.delete(clip.url);
    setClips((current) => current.filter((c) => c.id !== id));
    setError(null);
    setJob(null);
    setAnnouncement(`${clip.file.name} removed.`);
  }
  function reorder(from: number, to: number) {
    if (active || completed) return;
    setClips((current) => moveClip(current, from, to));
    setJob(null);
    setStructuralRevision((n) => n + 1);
    setAnnouncement(
      `${clips[from]?.file.name ?? 'Clip'} moved to position ${to + 1}.`,
    );
  }
  function splitAtPlayhead(targetId: string, frame: number) {
    if (active || completed) return;
    if (clips.length >= limits.max_clips) {
      setError('Clip limit reached. Remove a clip before splitting.');
      return;
    }
    const plan = planClipSplit(timeline, targetId, frame);
    if ('error' in plan) {
      setError(plan.error);
      return;
    }
    const target = clips.find((clip) => clip.id === targetId)!;
    const url = URL.createObjectURL(target.file);
    urls.current.add(url);
    const left: Clip = {
      ...target,
      id: crypto.randomUUID(),
      trim: plan.leftTrim,
      trimSaved: true,
    };
    const right: Clip = {
      ...target,
      id: crypto.randomUUID(),
      url,
      trim: plan.rightTrim,
      trimSaved: true,
    };
    setClips(
      clips.flatMap((clip) => (clip.id === targetId ? [left, right] : [clip])),
    );
    setJob(null);
    setError(null);
    setEditingClipId(null);
    setStructuralRevision((revision) => revision + 1);
    setAnnouncement('Video 1 split at the playhead. Right clip selected.');
    return right.id;
  }
  function replaceAfterPlayhead(
    targetId: string,
    sourceId: string,
    frame: number,
  ) {
    if (active || completed) return;
    const target = clips.find((clip) => clip.id === targetId);
    const source = clips.find((clip) => clip.id === sourceId);
    if (!target || !source) {
      setError('Choose an existing ready Video 1 clip and Version 2 source.');
      return;
    }
    const plan = planVersionReplacement(timeline, targetId, source, frame);
    if ('error' in plan) {
      setError(plan.error);
      return;
    }
    const url = URL.createObjectURL(source.file);
    urls.current.add(url);
    const left: Clip = { ...target, trim: plan.leftTrim, trimSaved: true };
    const right: Clip = {
      ...source,
      id: crypto.randomUUID(),
      url,
      trim: plan.rightTrim,
      trimSaved: true,
      speed: target.speed,
    };
    const nextClips = clips.flatMap((clip) =>
      clip.id === targetId ? [left, right] : clip.id === sourceId ? [] : [clip],
    );
    const nextTimeline = buildTimeline(nextClips, fpsSelection);
    const previousTarget = timeline.items.find(
      (item) => item.clip.id === targetId,
    )!;
    const nextTarget = nextTimeline.items.find(
      (item) => item.clip.id === targetId,
    )!;
    const nextFrame = Math.min(
      nextTarget.endFrame,
      nextTarget.startFrame +
        Math.round(
          ((frame - previousTarget.startFrame) / timeline.fps!) *
            nextTimeline.fps!,
        ),
    );
    if (!nextClips.some((clip) => clip.url === source.url)) {
      URL.revokeObjectURL(source.url);
      urls.current.delete(source.url);
    }
    setClips(nextClips);
    setJob(null);
    setError(null);
    setEditingClipId(null);
    setStructuralRevision((revision) => revision + 1);
    setAnnouncement('Video 1 replaced after the playhead.');
    return nextFrame;
  }
  async function merge() {
    if (!canMerge || outputFps === null) return;
    const validation = validateSelection(
      clips.map((c) => c.file),
      0,
      limits,
    );
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setPollError(false);
    setJob(null);
    setUploading(true);
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      setJob(
        await submitMerge(
          editableClips,
          buildMergeManifest(editableClips, audioSettings, outputFps, overlays),
          {
            backgroundAudio: backgroundAudio?.file,
            overlayImage: overlays.image?.file,
            overlayVideo: overlays.video?.file,
          },
          controller.signal,
        ),
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Upload failed. Please try again.',
        );
    } finally {
      if (!controller.signal.aborted) setUploading(false);
      uploadController.current = null;
    }
  }
  function newProject() {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    setClips([]);
    setBackgroundAudio(null);
    setOverlays({ image: null, video: null });
    setEditingClipId(null);
    setFpsSelection('auto');
    setAudioSettings({
      originalVolume: 1,
      originalMuted: false,
      musicVolume: 0.3,
      musicMuted: false,
    });
    setJob(null);
    setError(null);
    setPollError(false);
    setAnnouncement('New project ready.');
    setStructuralRevision((n) => n + 1);
  }
  const editingLocked = active || completed;
  useEffect(() => {
    if (active || completed || job?.status === 'failed')
      resultRegion.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active, completed, job?.status]);
  return (
    <div
      className="app"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
    >
      <header className="site-header">
        <a
          className="brand"
          href="/"
          aria-label="AVStudio workspace"
          onClick={(event) => event.preventDefault()}
        >
          <img
            className="brand-wordmark"
            src="/branding/avstudio-wordmark.svg"
            width="240"
            height="64"
            alt=""
          />
          <img
            className="brand-icon"
            src="/branding/avstudio-icon.svg"
            width="32"
            height="32"
            alt=""
          />
          <span className="compact-brand-name">AVStudio</span>
        </a>
        <span className="header-note">
          {health
            ? health.ffmpeg_available && health.ffprobe_available
              ? 'Backend ready'
              : 'Processing unavailable'
            : 'Connecting to backend'}
        </span>
      </header>
      {displayedError && (
        <div role="alert" className="error-banner">
          <TriangleAlert aria-hidden="true" />
          <span>{displayedError}</span>
          {pollError ? (
            <button
              className="text-button"
              onClick={() => {
                setError(null);
                setPollError(false);
                setPollAttempt((n) => n + 1);
              }}
            >
              Retry status
            </button>
          ) : !health ||
            !health.ffmpeg_available ||
            !health.ffprobe_available ? (
            <button
              className="text-button"
              onClick={() => {
                setError(null);
                setHealthAttempt((n) => n + 1);
              }}
            >
              Retry connection
            </button>
          ) : null}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <EditingWorkspace
        clips={clips}
        timeline={timeline}
        overlays={overlays}
        backgroundAudio={backgroundAudio}
        audioSettings={audioSettings}
        fpsSelection={fpsSelection}
        structuralRevision={structuralRevision}
        editingLocked={editingLocked}
        onPipDrop={(file) => selectOverlay('video', file)}
        onMove={reorder}
        onTrim={saveTrim}
        onDeleteClip={removeClip}
        onReplaceAfterPlayhead={replaceAfterPlayhead}
        onSplitAtPlayhead={splitAtPlayhead}
        maxClips={limits.max_clips}
        onFpsSelectionChange={(fps) => {
          setFpsSelection(fps);
          setStructuralRevision((n) => n + 1);
        }}
        mediaContent={
          <>
            <UploadCard
              disabled={!health || editingLocked}
              limits={limits}
              onSelect={selectFiles}
            />
            <ClipList
              clips={clips}
              disabled={editingLocked}
              onMove={reorder}
              onRemove={removeClip}
              onMetadata={setClipMetadata}
              onMetadataError={setClipMetadataError}
              onTrim={setEditingClipId}
              onSpeedChange={changeSpeed}
            />
          </>
        }
        clipContent={
          <p>
            Use the media list to trim, change speed, move or remove a clip.
            Source details follow the selected clip.
          </p>
        }
        overlayContent={
          <OverlayTrack
            overlays={overlays}
            totalProjectFrames={totalProjectFrames}
            imageLimitMb={limits.max_overlay_image_file_size_mb ?? 20}
            videoLimitMb={limits.max_overlay_video_file_size_mb ?? 200}
            disabled={editingLocked}
            onSelect={selectOverlay}
            onMetadata={setOverlayMetadata}
            onMetadataError={setOverlayMetadataError}
            onScheduleChange={changeOverlaySchedule}
            onRemove={removeOverlay}
          />
        }
        audioContent={
          <BackgroundAudioTrack
            audio={backgroundAudio}
            settings={audioSettings}
            disabled={editingLocked}
            onSelect={selectBackgroundAudio}
            onMetadata={(duration) =>
              setBackgroundAudio((current) =>
                current ? { ...current, duration, status: 'ready' } : null,
              )
            }
            onMetadataError={() => {
              setBackgroundAudio((current) =>
                current ? { ...current, status: 'error' } : null,
              );
              setError(
                'Could not read the background-audio metadata. Remove it and choose another file.',
              );
            }}
            onRemove={removeBackgroundAudio}
            onSettings={setAudioSettings}
          />
        }
        deliveryContent={
          <MergeSummary
            clips={clips}
            timeline={timeline}
            disabled={!canMerge}
            busy={active}
            onMerge={() => void merge()}
          />
        }
        resultContent={
          <div ref={resultRegion}>
            {completed && job ? (
              <JobResult key={job.job_id} job={job} onNewProject={newProject} />
            ) : active ? (
              <div
                className="panel processing"
                role="status"
                aria-live="polite"
              >
                <h2>
                  {uploading
                    ? 'Uploading media'
                    : job?.status === 'queued'
                      ? 'Queued'
                      : 'Rendering MP4'}
                </h2>
                <p>
                  Keep this tab open while the backend processes your media.
                </p>
              </div>
            ) : job?.status === 'failed' ? (
              <p role="status">Render failed</p>
            ) : null}
          </div>
        }
      />
      {editingClipId &&
        (() => {
          const clip = clips.find(
            (candidate) => candidate.id === editingClipId,
          );
          return clip && isEditableClip(clip) ? (
            <TrimEditor
              clip={clip}
              disabled={editingLocked}
              onSave={saveTrim}
              onCancel={() => setEditingClipId(null)}
            />
          ) : null;
        })()}
    </div>
  );
}
