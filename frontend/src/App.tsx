import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { UploadCard } from './components/UploadCard';
import { ClipList } from './components/ClipList';
import { MergeSummary } from './components/MergeSummary';
import { JobResult } from './components/JobResult';
import { TrimEditor } from './components/TrimEditor';
import { TimelinePlacementDialog } from './components/TimelinePlacementDialog';
import { buildAdvancedTimeline, placementLength } from './lib/advancedTimeline';
import type { Video2Occurrence, MusicOccurrence } from './lib/advancedTimeline';
import {
  movePositioned,
  trimPositioned,
  splitPositioned,
  rippleDeletePositioned,
  changeReplacementSourceEdit,
  validatePositioned,
} from './lib/positionedEdits';
import type { PositionedTrack, EditResult } from './lib/positionedEdits';
import type { PositionedActions } from './components/PositionedTrack';
import { TimelineSourceProbe } from './components/TimelineSourceProbe';
import { BackgroundAudioTrack } from './components/BackgroundAudioTrack';
import { OverlayTrack } from './components/OverlayTrack';
import { EditingWorkspace } from './components/EditingWorkspace';
import { useEditHistory } from './hooks/useEditHistory';
import { materializeSnapshot } from './lib/historyProjection';
import type { SourceToken } from './lib/projectSources';
import type { EditSnapshot } from './lib/editHistory';
import {
  buildTimeline,
  planClipSplit,
  planVersionReplacement,
} from './lib/timeline';
import type { BackgroundAudio } from './components/BackgroundAudioTrack';
import { ApiError, getHealth, getJob, submitAdvancedMerge } from './lib/api';
import type { Health, Job } from './lib/api';
import { buildAdvancedMergeRequest } from './lib/advancedManifest';
import { isEditableClip, moveClip, validateSelection } from './lib/clips';
import type {
  AudioSettings,
  Clip,
  ClipMetadata,
  ClipSpeed,
  ClipTrim,
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
  const resultRegion = useRef<HTMLDivElement>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [externalOverlays, setOverlays] = useState<OverlayState>({
    image: null,
    video: null,
  });
  const [imageToken, setImageToken] = useState<SourceToken | null>(null);
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
  const history = useEditHistory({
    limits,
    editingLocked: Boolean(active || completed),
    trimDraftOpen: editingClipId !== null,
    onError: setHistoryError,
    onAnnouncement: (message) => {
      setHistoryError(null);
      setAnnouncement(message);
    },
  });
  // Keep audio-only edits from replacing the current preview geometry.
  const projectionKey = JSON.stringify({
    sourceRevision: history.sourceRevision,
    fpsSelection: history.view.fpsSelection,
    video1: history.view.video1,
    pip: history.view.pip,
    video2: history.view.video2,
    musicSourceId: history.view.musicSourceId,
    music: history.view.music,
  });
  const sources = history.sources;
  const projected = useMemo(
    () =>
      materializeSnapshot(JSON.parse(projectionKey) as EditSnapshot, sources),
    [projectionKey, sources],
  );
  const clips = projected.clips;
  const musicToken = history.view.musicSourceId
    ? (history.sources.get(history.view.musicSourceId)?.token ?? null)
    : null;
  const musicSource = musicToken
    ? history.sources.get(musicToken.sourceId)
    : null;
  const backgroundAudio: BackgroundAudio | null = musicSource
    ? {
        file: musicSource.file,
        url: history.sources.ensureUrl(musicSource.token.sourceId),
        duration: musicSource.duration,
        status: musicSource.status,
      }
    : null;
  const pendingMusic = history.pendingTimelineSources.find(
    (v) => v.track === 'music',
  );
  const overlays = { ...externalOverlays, video: projected.pip };
  const fpsSelection = history.view.fpsSelection;
  const audioSettings = history.view.audio;
  const structuralRevision = history.structuralRevision;
  const advanced = useMemo(
    () =>
      buildAdvancedTimeline(
        JSON.parse(projectionKey) as EditSnapshot,
        sources,
        { ...externalOverlays, video: projected.pip },
      ),
    [projectionKey, sources, externalOverlays, projected.pip],
  );
  const pendingReplacement = history.pendingTimelineSources.find(
    (v) => v.track === 'video2',
  );
  const clipSourceTokens = new Map(
    history.view.video1.map((v) => [
      v.id,
      history.sources.get(v.sourceId)!.token,
    ]),
  );
  const pipSourceToken = history.view.pip
    ? history.sources.get(history.view.pip.sourceId)?.token
    : null;

  function externalOwners(image: SourceToken | null) {
    history.sources.setExternalOwners(new Set(image ? [image.sourceId] : []));
  }
  function commitClips(
    action: 'trim' | 'reorder' | 'split' | 'ripple-delete' | 'version-replace',
    label: string,
    next: Clip[],
    derivedFrom: ReadonlyMap<string, string> = new Map(),
  ) {
    const occurrences = history.history.present.video1;
    return history.commitVideo1(
      action,
      label,
      next.map((c) => {
        const original = occurrences.find(
          (v) => v.id === (derivedFrom.get(c.id) ?? c.id),
        )!;
        return {
          id: c.id,
          sourceId: original.sourceId,
          trim: c.trim ?? null,
          trimSaved: c.trimSaved ?? false,
          speed: c.speed ?? 1,
        };
      }),
    );
  }
  const editableClips = clips.filter(isEditableClip);
  const editsValid =
    editableClips.length === clips.length &&
    (!backgroundAudio || backgroundAudio.status === 'ready');
  const timeline = useMemo(
    () => buildTimeline(clips, fpsSelection),
    [clips, fpsSelection],
  );
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
    !history.gestureActive &&
    !editingClipId &&
    !advanced.renderErrors.length &&
    !history.pendingTimelineSources.length &&
    !history.pendingImports.length &&
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

  function commitPositioned(
    track: PositionedTrack,
    label: string,
    edit: EditResult<EditSnapshot>,
  ): boolean {
    if ('error' in edit) {
      setHistoryError(edit.error);
      return false;
    }
    const ok = history.commit(
      `${track}-${label === 'Split' ? 'split' : label === 'Ripple Delete' ? 'ripple-delete' : label === 'Move' ? 'move' : 'trim'}`,
      `${label} ${track === 'video2' ? 'Video 2' : 'music'}`,
      edit.value,
    );
    if (ok) {
      setJob(null);
      setHistoryError(null);
    }
    return ok;
  }
  function splitPositionedClip(
    track: PositionedTrack,
    id: string,
    frame: number,
  ): string | void {
    if (!outputFps) return;
    const ids = { left: crypto.randomUUID(), right: crypto.randomUUID() };
    const edit = splitPositioned(
      history.history.present,
      track,
      id,
      frame,
      ids,
      outputFps,
    );
    if (commitPositioned(track, 'Split', edit)) return ids.right;
  }
  function savePositionedRange(
    track: PositionedTrack,
    item: Video2Occurrence | MusicOccurrence,
  ): boolean {
    const current = history.history.present;
    let next: EditSnapshot;
    if (track === 'video2' && 'contentInFrame' in item) {
      next = {
        ...current,
        video2: current.video2.map((v) =>
          v.id === item.id
            ? {
                ...v,
                timelineStartFrame: item.timelineStartFrame,
                contentInFrame: item.contentInFrame,
                contentOutFrame: item.contentOutFrame,
                contentFullSource: false,
              }
            : v,
        ),
      };
    } else if (track === 'music' && 'sourceStartSample' in item) {
      next = {
        ...current,
        music: current.music.map((v) =>
          v.id === item.id
            ? {
                ...v,
                timelineStartFrame: item.timelineStartFrame,
                sourceStartSample: item.sourceStartSample,
                durationFrames: item.durationFrames,
              }
            : v,
        ),
      };
    } else return false;
    return commitPositioned(track, 'Trim', { value: next });
  }
  const positionedActions: PositionedActions = {
    onFileDrop: (track, file, start) => {
      history.stageTimelineSource(file, track, start);
      setError(null);
    },
    onMove: (track, id, start) =>
      commitPositioned(
        track,
        'Move',
        movePositioned(history.history.present, track, id, start),
      ),
    onMoveBegin: (track, id) => history.begin(`${track}-move`, id),
    onTrimBegin: (track, id) => history.begin(`${track}-trim`, id),
    onMovePreview: (token, track, id, start) => {
      const next = movePositioned(history.history.present, track, id, start);
      if ('error' in next || !outputFps) return false;
      const error = validatePositioned(next.value, sources, outputFps);
      if (
        error ||
        (track === 'video2' &&
          next.value.video2.some(
            (v) =>
              v.id === id &&
              v.timelineStartFrame + placementLength(v) > totalProjectFrames,
          ))
      )
        return false;
      history.preview(token, next.value);
      return true;
    },
    onTrimPreview: (token, track, id, edge, delta) => {
      if (!outputFps) return false;
      const next = trimPositioned(
        history.history.present,
        track,
        id,
        edge,
        delta,
        outputFps,
        sources,
      );
      if (
        'error' in next ||
        (track === 'video2' &&
          next.value.video2.some(
            (v) =>
              v.id === id &&
              v.timelineStartFrame + placementLength(v) > totalProjectFrames,
          ))
      )
        return false;
      history.preview(token, next.value);
      return true;
    },
    onEnd: (token, accept) => history.finish(token, accept),
    onError: setHistoryError,
  };
  function selectFiles(files: File[]) {
    if (active || completed || !health || !files.length) return;
    const validation = validateSelection(
      files,
      clips.length + history.view.video2.length,
      limits,
    );
    if (validation) {
      setError(validation);
      return;
    }
    history.importVideo1(files);
    setError(null);
    setJob(null);
    setAnnouncement(
      `${files.length} ${files.length === 1 ? 'clip' : 'clips'} added.`,
    );
  }
  function setClipMetadata(id: string, metadata: ClipMetadata) {
    const token = clipSourceTokens.get(id);
    if (token) history.sourceReady(token, { clipMetadata: metadata });
  }
  function setClipMetadataError(id: string) {
    const clip = clips.find((candidate) => candidate.id === id);
    const token = clipSourceTokens.get(id);
    if (!token || !history.sourceError(token)) return;
    setError(
      `Could not read metadata for ${clip?.file.name ?? 'this clip'}. Remove it and choose a browser-readable video.`,
    );
  }
  function saveTrim(id: string, trim: ClipTrim) {
    if (active || completed) return;
    commitClips(
      'trim',
      'Trim clip',
      clips.map((clip) =>
        clip.id === id ? { ...clip, trim, trimSaved: true } : clip,
      ),
    );
    setEditingClipId(null);
    setJob(null);
  }
  function changeSpeed(id: string, speed: ClipSpeed) {
    history.rebaseSpeed(id, speed);
    setJob(null);
  }
  function selectBackgroundAudio(file: File) {
    history.stageTimelineSource(file, 'music', 0);
    setError(null);
  }
  function removeBackgroundAudio() {
    history.cancelTimelineSources();
    history.commit('music-remove', 'Remove music', {
      ...history.history.present,
      musicSourceId: null,
      music: [],
    });
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
    if (kind === 'video') {
      history.stagePip(file);
      setError(null);
      return;
    }
    history.notifyStructuralChange();
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
    const token = history.sources.register(file, 'image');
    externalOwners(token);
    setImageToken(token);
    const url = history.sources.ensureUrl(token.sourceId);
    history.excludedUserEdit();
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
    const token = kind === 'image' ? imageToken : pipSourceToken;
    if (
      kind === 'image' &&
      token &&
      !history.sources.externalOwners.has(token.sourceId)
    )
      return;
    if (!token || !history.sourceReady(token, { duration })) return;
    if (kind === 'video') return;
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
    const token = kind === 'image' ? imageToken : pipSourceToken;
    if (
      kind === 'image' &&
      token &&
      !history.sources.externalOwners.has(token.sourceId)
    )
      return;
    if (!token || !history.sourceError(token)) return;
    if (kind === 'video') return;
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
    if (kind === 'video') {
      const pip = history.history.present.pip;
      if (!pip) return;
      if ('position' in changes || 'size' in changes)
        history.commit(
          'position' in changes ? 'pip-position' : 'pip-size',
          'Change PIP placement',
          { ...history.history.present, pip: { ...pip, ...changes } },
        );
      else history.rebasePipRange(pip.id, changes);
      return;
    }
    const current = overlays.image;
    if (
      !current ||
      Object.entries(changes).every(
        ([field, value]) => current[field as keyof OverlaySchedule] === value,
      )
    )
      return;
    history.excludedUserEdit();
    history.notifyStructuralChange();
    setOverlays((current) => ({
      ...current,
      [kind]: current[kind] ? { ...current[kind], ...changes } : null,
    }));
    setJob(null);
  }
  function removeOverlay(kind: OverlayKind) {
    if (kind === 'video') {
      history.cancelPendingPip();
      history.commit('pip-remove', 'Remove PIP', {
        ...history.history.present,
        pip: null,
      });
      return;
    }
    history.notifyStructuralChange();
    const overlay = overlays[kind];
    if (!overlay) return;
    externalOwners(null);
    setImageToken(null);
    history.excludedUserEdit();
    setOverlays((current) => ({ ...current, [kind]: null }));
    setError(null);
    setJob(null);
  }
  function removeClip(id: string) {
    if (active || completed) return;
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    if (
      !commitClips(
        'ripple-delete',
        'Ripple Delete clip',
        clips.filter((c) => c.id !== id),
      )
    )
      return;
    setError(null);
    setJob(null);
    setAnnouncement(`${clip.file.name} removed.`);
  }
  function reorder(from: number, to: number) {
    if (active || completed) return;
    if (!commitClips('reorder', 'Reorder clips', moveClip(clips, from, to)))
      return;
    setJob(null);
    setAnnouncement(
      `${clips[from]?.file.name ?? 'Clip'} moved to position ${to + 1}.`,
    );
  }
  function splitAtPlayhead(targetId: string, frame: number) {
    if (active || completed) return;
    if (clips.length + history.view.video2.length >= limits.max_clips) {
      setError('Clip limit reached. Remove a clip before splitting.');
      return;
    }
    const plan = planClipSplit(timeline, targetId, frame);
    if ('error' in plan) {
      setError(plan.error);
      return;
    }
    const target = clips.find((clip) => clip.id === targetId)!;
    const left: Clip = {
      ...target,
      id: crypto.randomUUID(),
      trim: plan.leftTrim,
      trimSaved: true,
    };
    const right: Clip = {
      ...target,
      id: crypto.randomUUID(),
      trim: plan.rightTrim,
      trimSaved: true,
    };
    if (
      !commitClips(
        'split',
        'Split clip',
        clips.flatMap((clip) =>
          clip.id === targetId ? [left, right] : [clip],
        ),
        new Map([
          [left.id, targetId],
          [right.id, targetId],
        ]),
      )
    )
      return;
    setJob(null);
    setError(null);
    setHistoryError(null);
    setEditingClipId(null);
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
    const left: Clip = { ...target, trim: plan.leftTrim, trimSaved: true };
    const right: Clip = {
      ...source,
      id: crypto.randomUUID(),
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
    if (
      !commitClips(
        'version-replace',
        'Replace version',
        nextClips,
        new Map([[right.id, sourceId]]),
      )
    )
      return;
    setJob(null);
    setError(null);
    setEditingClipId(null);
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
        await submitAdvancedMerge(
          buildAdvancedMergeRequest(
            history.history.present,
            sources,
            outputFps,
            overlays,
          ),
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
    history.clearProject();
    setImageToken(null);
    setOverlays({ image: null, video: null });
    setEditingClipId(null);
    setJob(null);
    setError(null);
    setPollError(false);
    setAnnouncement('New project ready.');
    history.notifyStructuralChange();
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
      {historyError && !pendingReplacement && (
        <div role="alert" className="error-banner">
          <TriangleAlert aria-hidden="true" />
          <span>{historyError}</span>
        </div>
      )}
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
      {pendingReplacement && (
        <>
          <TimelineSourceProbe
            token={pendingReplacement.token}
            file={sources.get(pendingReplacement.token.sourceId)!.file}
            url={sources.ensureUrl(pendingReplacement.token.sourceId)}
            track="video2"
            onReady={history.completeTimelineSource}
            onError={history.failTimelineSource}
          />
          <TimelinePlacementDialog
            key={pendingReplacement.token.sourceId}
            name={sources.get(pendingReplacement.token.sourceId)!.file.name}
            metadata={sources.get(pendingReplacement.token.sourceId)?.metadata}
            startFrame={pendingReplacement.startFrame}
            disabled={Boolean(active || completed)}
            onSave={(draft) =>
              history.acceptTimelineSource(pendingReplacement.token, draft)
            }
            onCancel={history.cancelTimelineSources}
          />
        </>
      )}
      <EditingWorkspace
        historyControls={history.controls}
        advanced={advanced}
        gestureActive={history.gestureActive}
        positionedActions={positionedActions}
        onAddReplacement={(file, start, target) => {
          history.stageTimelineSource(file, 'video2', start, target);
          setError(null);
        }}
        onDeletePositioned={(track, id) =>
          commitPositioned(
            track,
            'Ripple Delete',
            rippleDeletePositioned(history.history.present, track, id),
          )
        }
        onSplitPositioned={splitPositionedClip}
        onSavePositioned={savePositionedRange}
        onSourceEditPositioned={(id, trim, speed, kind) => {
          if (!outputFps) return false;
          const edit = changeReplacementSourceEdit(
            history.history.present,
            id,
            trim,
            speed,
            sources,
            outputFps,
            kind,
          );
          if ('error' in edit) {
            setHistoryError(edit.error);
            return false;
          }
          return history.commit(
            kind === 'speed' ? 'video2-speed' : 'video2-source-trim',
            'Change replacement source edit',
            edit.value,
          );
        }}
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
        onTrimBegin={(id) => history.begin('trim', id)}
        onTrimPreview={(token, id, trim) =>
          history.preview(token, {
            ...history.view,
            video1: history.view.video1.map((v) =>
              v.id === id ? { ...v, trim } : v,
            ),
          })
        }
        onTrimEnd={(token, accept) => history.finish(token, accept)}
        onDeleteClip={removeClip}
        onReplaceAfterPlayhead={replaceAfterPlayhead}
        onSplitAtPlayhead={splitAtPlayhead}
        maxClips={limits.max_clips}
        onFpsSelectionChange={(fps) => {
          history.commit('fps', 'Change timeline FPS', {
            ...history.history.present,
            fpsSelection: fps,
          });
        }}
        mediaContent={
          <>
            <UploadCard
              disabled={!health || editingLocked}
              limits={limits}
              onSelect={selectFiles}
            />
            {history.pendingImports.map((token) => (
              <TimelineSourceProbe
                key={token.sourceId}
                token={token}
                file={history.sources.get(token.sourceId)!.file}
                url={history.sources.ensureUrl(token.sourceId)}
                track="video2"
                onReady={history.sourceReady}
                onError={history.sourceError}
              />
            ))}
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
            pipCandidate={
              history.pendingPip
                ? {
                    token: history.pendingPip,
                    url: history.sources.ensureUrl(history.pendingPip.sourceId),
                    name: history.sources.get(history.pendingPip.sourceId)?.file
                      .name,
                  }
                : null
            }
            onPipCandidateReady={(token, duration) =>
              history.completePip(token, { duration })
            }
            onPipCandidateError={history.failPip}
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
            onMetadata={(duration) => {
              if (musicToken) history.sourceReady(musicToken, { duration });
            }}
            onMetadataError={() => {
              if (musicToken) history.sourceError(musicToken);
            }}
            onReplace={selectBackgroundAudio}
            candidateName={
              pendingMusic
                ? history.sources.get(pendingMusic.token.sourceId)?.file.name
                : undefined
            }
            onCancelCandidate={history.cancelTimelineSources}
            candidateContent={
              pendingMusic ? (
                <TimelineSourceProbe
                  token={pendingMusic.token}
                  file={history.sources.get(pendingMusic.token.sourceId)!.file}
                  url={history.sources.ensureUrl(pendingMusic.token.sourceId)}
                  track="music"
                  onReady={(token, metadata) => {
                    if (history.completeTimelineSource(token, metadata))
                      history.acceptTimelineSource(token, {
                        timelineStartFrame: pendingMusic.startFrame,
                      });
                  }}
                  onError={history.failTimelineSource}
                />
              ) : null
            }
            onRemove={removeBackgroundAudio}
            onVolumeBegin={(field) => history.begin('audio-volume', field)}
            onVolumePreview={(token, field, value) =>
              history.preview(token, {
                ...history.view,
                audio: { ...history.view.audio, [field]: value },
              })
            }
            onVolumeEnd={(token, accept) => history.finish(token, accept)}
            onSettings={(audio: AudioSettings) =>
              history.commit(
                audio.originalMuted !== history.view.audio.originalMuted ||
                  audio.musicMuted !== history.view.audio.musicMuted
                  ? 'audio-mute'
                  : 'audio-volume',
                'Change audio mix',
                { ...history.history.present, audio },
              )
            }
          />
        }
        deliveryContent={
          <>
            <p className="render-readiness" role="status">
              {advanced.renderErrors[0] ??
                (editingClipId ||
                history.gestureActive ||
                history.pendingTimelineSources.length
                  ? 'Finish or cancel the current edit before rendering.'
                  : '')}
            </p>
            <MergeSummary
              clips={clips}
              timeline={timeline}
              disabled={!canMerge}
              busy={active}
              onMerge={() => void merge()}
            />
          </>
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
