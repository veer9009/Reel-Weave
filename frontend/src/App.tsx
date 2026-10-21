import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { UploadCard } from './components/UploadCard';
import { ClipList } from './components/ClipList';
import { MediaBin } from './components/MediaBin';
import type { IndependentAudioActions } from './components/IndependentAudioTrack';
import { editIndependentAudio } from './lib/audioTimeline';
import type { PlacementDraft } from './lib/placement';
import type { TimelineSelection } from './lib/timeline';
import { MergeSummary } from './components/MergeSummary';
import { JobResult } from './components/JobResult';
import { ExportOptions } from './components/ExportOptions';
import { ProjectFileControls } from './components/ProjectFileControls';
import { useProjectFiles } from './hooks/useProjectFiles';
import { collectSnapshotSources } from './lib/projectContext';
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
  planWindowedSplit,
  planVersionReplacement,
} from './lib/timeline';
import type { BackgroundAudio } from './components/BackgroundAudioTrack';
import {
  ApiError,
  getHealth,
  getJob,
  submitAdvancedMerge,
  submitV3Merge,
} from './lib/api';
import type { Health, Job, ExportFormat } from './lib/api';
import {
  buildAdvancedMergeRequest,
  buildV3MergeRequest,
  requiresV3,
} from './lib/advancedManifest';
import { isEditableClip, moveClip, validateSelection } from './lib/clips';
import { moveVideo1Insert } from './lib/rippleInsert';
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
  const workspaceRef = useRef<HTMLDivElement>(null);
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
  const [exportFormats, setExportFormats] = useState<ExportFormat[]>(['mp4']);
  const [activeDragDraft, setActiveDragDraft] = useState<PlacementDraft | null>(
    null,
  );
  const [selectionRequest, setSelectionRequest] = useState<{
    serial: number;
    selection: TimelineSelection;
    focusId?: string;
  }>();
  const [externalOverlays, setOverlays] = useState<OverlayState>({
    image: null,
    video: null,
  });
  const [imageToken, setImageToken] = useState<SourceToken | null>(null);
  const urls = useRef(new Set<string>());
  const uploadController = useRef<AbortController | null>(null);
  const pollingController = useRef<AbortController | null>(null);
  const projectEpoch = useRef(0);
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
    onProjectContextRestore: (restored) => {
      setImageToken(restored.imageToken);
      setOverlays({ image: restored.image, video: null });
      setExportFormats([...restored.context.exportFormats]);
      setEditingClipId(null);
      setActiveDragDraft(null);
      setSelectionRequest((value) => ({
        serial: (value?.serial ?? 0) + 1,
        selection: { kind: 'none' },
      }));
      projectEpoch.current++;
      uploadController.current?.abort();
      pollingController.current?.abort();
      setJob(null);
      setError(null);
      setHistoryError(null);
      setPollError(false);
    },
    onPlaced: (track, id) => {
      setSelectionRequest((value) => ({
        serial: (value?.serial ?? 0) + 1,
        selection: {
          kind:
            track === 'video1'
              ? 'clip'
              : track === 'video2'
                ? 'replacement'
                : track === 'independent'
                  ? 'independent'
                  : 'music',
          id,
        },
      }));
    },
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
  const renderedIncarnationId = history.projectContext.incarnationId;
  const projectionKey = JSON.stringify({
    sourceRevision: history.sourceRevision,
    fpsSelection: history.view.fpsSelection,
    video1: history.view.video1,
    pip: history.view.pip,
    video2: history.view.video2,
    musicSourceId: history.view.musicSourceId,
    music: history.view.music,
    independentAudio: history.view.independentAudio,
  });
  const sources = history.sources;
  const currentSourceIds = collectSnapshotSources(history.history.present);
  const pendingProjectOperation = Boolean(
    editingClipId ||
    activeDragDraft ||
    history.gestureActive ||
    history.pendingPip ||
    history.pendingImports.length ||
    history.pendingBinImports.length ||
    history.pendingTimelineSources.length ||
    [...currentSourceIds].some((id) => sources.get(id)?.status === 'loading'),
  );
  const pendingProjectReason = pendingProjectOperation
    ? 'Finish or cancel the current edit or media import.'
    : null;
  const fileAvailability = {
    saveDisabledReason:
      pendingProjectReason ??
      (!currentSourceIds.size
        ? 'Add media before saving a project.'
        : [...currentSourceIds].some(
              (id) => sources.get(id)?.status !== 'ready',
            )
          ? 'All project media must be ready before saving.'
          : null),
    openDisabledReason:
      pendingProjectReason ??
      (active
        ? 'Wait for the current render to finish.'
        : completed
          ? 'Use New Project to leave the completed result before opening another project.'
          : null),
  };
  const projectFiles = useProjectFiles({
    history,
    limits,
    availability: fileAvailability,
    onOpened: () => {
      setAnnouncement('Project opened. Undo is available.');
    },
    onAnnounce: setAnnouncement,
  });
  useEffect(
    () =>
      imageToken
        ? sources.acquireLease(
            'project-image-preview',
            new Set([imageToken.sourceId]),
          )
        : undefined,
    [sources, imageToken],
  );
  const placeMedia = (draft: PlacementDraft) => {
    if (!history.commitPlacement(draft)) return false;
    setActiveDragDraft(null);
    setAnnouncement('Media placed.');
    return true;
  };
  useEffect(
    () =>
      sources.onBeforeClear(() => {
        projectEpoch.current++;
        uploadController.current?.abort();
        pollingController.current?.abort();
      }),
    [sources],
  );
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
          outputWindow: c.outputWindow,
          originalAudio: c.originalAudio ?? original.originalAudio ?? 'linked',
        };
      }),
      derivedFrom,
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
    projectFiles.openPhase === 'idle' &&
    !active &&
    !completed &&
    !history.gestureActive &&
    !editingClipId &&
    !advanced.renderErrors.length &&
    !history.pendingTimelineSources.length &&
    !history.pendingImports.length &&
    !history.pendingBinImports.length &&
    exportFormats.every(
      (format) =>
        format === 'mp4' || health?.export_capabilities?.[format] === true,
    ) &&
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
        if (disposed || epoch !== projectEpoch.current) return;
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
        if (disposed || epoch !== projectEpoch.current) return;
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
    const epoch = projectEpoch.current;
    pollingController.current = controller;
    void poll();
    return () => {
      disposed = true;
      clearTimeout(next);
      clearTimeout(timeout);
      controller.abort();
      if (pollingController.current === controller)
        pollingController.current = null;
    };
  }, [jobId, jobStatus, pollAttempt]);

  function commitPositioned(
    track: PositionedTrack,
    label: string,
    edit: EditResult<EditSnapshot>,
  ): boolean {
    if ('error' in edit) {
      setHistoryError(edit.error.message);
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
  const audioActions: IndependentAudioActions = {
    snapshot: history.view,
    sources,
    onEdit: (edit) => {
      const before = history.history.present.independentAudio;
      if (!history.commitAudioEdit(edit)) return false;
      const after = history.history.present.independentAudio;
      let selected = after.find((v) => !before.some((old) => old.id === v.id));
      if (edit.action === 'split')
        selected = after.find(
          (v) =>
            v.timelineStartFrame === edit.frame &&
            !before.some((old) => old.id === v.id),
        );
      if (edit.action === 'lift' || edit.action === 'ripple-delete') {
        const index = before.findIndex((v) => v.id === edit.id);
        selected =
          after.find((v) => v.id === before[index + 1]?.id) ||
          after.find((v) => v.id === before[index - 1]?.id);
        setSelectionRequest((value) => ({
          serial: (value?.serial ?? 0) + 1,
          selection: selected
            ? { kind: 'independent', id: selected.id }
            : { kind: 'none' },
          focusId: selected
            ? `timeline-segment-${selected.id}`
            : 'independent-audio-header',
        }));
      } else if (selected)
        setSelectionRequest((value) => ({
          serial: (value?.serial ?? 0) + 1,
          selection: { kind: 'independent', id: selected!.id },
        }));
      return true;
    },
    onSave: (segment) =>
      history.commit('independent-trim', 'Edit independent audio range', {
        ...history.history.present,
        independentAudio: history.history.present.independentAudio.map((v) =>
          v.id === segment.id ? segment : v,
        ),
      }),
    onDetach: (target) => {
      const before = history.history.present.independentAudio;
      if (!history.commitDetach(target)) return false;
      const selected = history.history.present.independentAudio.find(
        (v) => !before.some((old) => old.id === v.id),
      );
      if (selected)
        setSelectionRequest((value) => ({
          serial: (value?.serial ?? 0) + 1,
          selection: { kind: 'independent', id: selected.id },
        }));
      setAnnouncement('Audio detached. Original/Replacement Audio selected.');
      return true;
    },
    onReplaceFile: (id, file) => {
      history.importToBin(file, 'audio', undefined, id);
    },
    onBegin: (id, edge) =>
      history.begin(edge ? 'independent-trim' : 'independent-move', id),
    onPreview: (token, edit) => {
      if (!outputFps) return false;
      const next = editIndependentAudio(
        history.history.present,
        edit,
        outputFps,
        sources,
        () => crypto.randomUUID(),
      );
      if ('error' in next) return false;
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
    if (history.projectContext.incarnationId !== renderedIncarnationId) return;
    const token = clipSourceTokens.get(id);
    if (token) history.sourceReady(token, { clipMetadata: metadata });
  }
  function setClipMetadataError(id: string) {
    if (history.projectContext.incarnationId !== renderedIncarnationId) return;
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
        clip.id === id
          ? { ...clip, trim, trimSaved: true, outputWindow: undefined }
          : clip,
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
    if (
      projectFiles.openPhase !== 'idle' ||
      active ||
      job?.status === 'completed'
    )
      return;
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
    history.updateExternalProjectContext(
      {
        imageOverlay: {
          id: crypto.randomUUID(),
          sourceId: token.sourceId,
          ...schedule,
        },
      },
      'image',
    );
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
      token?.sourceId !== history.projectContext.imageOverlay?.sourceId
    )
      return;
    if (
      kind === 'video' &&
      token?.sourceId !== history.history.present.pip?.sourceId
    )
      return;
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
      token?.sourceId !== history.projectContext.imageOverlay?.sourceId
    )
      return;
    if (
      kind === 'video' &&
      token?.sourceId !== history.history.present.pip?.sourceId
    )
      return;
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
    const imageContext = history.projectContext.imageOverlay;
    if (imageContext)
      history.updateExternalProjectContext(
        { imageOverlay: { ...imageContext, ...changes } },
        'image',
      );
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
    history.updateExternalProjectContext({ imageOverlay: null }, 'image');
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
  function insertVideo1(id: string, frame: number) {
    if (active || completed) return;
    const lineage = new Map<string, string>();
    const result = moveVideo1Insert(
      history.history.present,
      history.sources,
      id,
      frame,
      limits,
      (derivedFrom) => {
        const id = crypto.randomUUID();
        lineage.set(id, derivedFrom);
        return id;
      },
    );
    if ('error' in result) {
      setHistoryError(result.error.message);
      return;
    }
    if (
      !history.commit(
        lineage.size ? 'split' : 'reorder',
        'Ripple insert Video 1 clip',
        result.value,
        lineage,
      )
    )
      return;
    setJob(null);
    setError(null);
    setAnnouncement('Video 1 clip inserted.');
  }
  function splitAtPlayhead(targetId: string, frame: number) {
    if (active || completed) return;
    if (clips.length + history.view.video2.length >= limits.max_clips) {
      setError('Clip limit reached. Remove a clip before splitting.');
      return;
    }
    const target = clips.find((clip) => clip.id === targetId)!;
    const plan = target.outputWindow
      ? planWindowedSplit(timeline, targetId, frame)
      : planClipSplit(timeline, targetId, frame);
    if ('error' in plan) {
      setError(
        typeof plan.error === 'string' ? plan.error : plan.error.message,
      );
      return;
    }
    const left: Clip = {
      ...target,
      id: crypto.randomUUID(),
      trim: 'value' in plan ? target.trim : plan.leftTrim,
      outputWindow: 'value' in plan ? plan.value.leftWindow : undefined,
      trimSaved: true,
    };
    const right: Clip = {
      ...target,
      id: crypto.randomUUID(),
      trim: 'value' in plan ? target.trim : plan.rightTrim,
      outputWindow: 'value' in plan ? plan.value.rightWindow : undefined,
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
    const left: Clip = {
      ...target,
      trim: plan.leftTrim,
      outputWindow: plan.leftWindow,
      trimSaved: true,
    };
    const right: Clip = {
      ...source,
      id: crypto.randomUUID(),
      trim: plan.rightTrim,
      trimSaved: true,
      speed: target.speed,
      originalAudio: target.originalAudio,
      outputWindow: plan.rightWindow,
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
    if (projectFiles.openPhase !== 'idle' || !canMerge || outputFps === null)
      return;
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
    const epoch = projectEpoch.current;
    let releaseOwner = () => {};
    try {
      const v3 = requiresV3(history.history.present, exportFormats);
      const render = v3
        ? buildV3MergeRequest(
            history.history.present,
            sources,
            outputFps,
            overlays,
            [...exportFormats],
            limits,
          )
        : buildAdvancedMergeRequest(
            history.history.present,
            sources,
            outputFps,
            overlays,
          );
      const ids = new Set(
        render.manifest.video_sources.map((v) => v.source_id),
      );
      if ('audio_sources' in render.manifest)
        render.manifest.audio_sources.forEach((v) => ids.add(v.source_id));
      if (history.history.present.musicSourceId)
        ids.add(history.history.present.musicSourceId);
      if (history.history.present.pip)
        ids.add(history.history.present.pip.sourceId);
      if (imageToken) ids.add(imageToken.sourceId);
      releaseOwner = sources.acquireLease('render-submission', ids);
      const submitted = await ('audioFiles' in render
        ? submitV3Merge(render, controller.signal)
        : submitAdvancedMerge(render, controller.signal));
      if (!controller.signal.aborted && epoch === projectEpoch.current)
        setJob(submitted);
    } catch (cause) {
      if (!controller.signal.aborted && epoch === projectEpoch.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Upload failed. Please try again.',
        );
        if (cause instanceof ApiError) {
          const snapshot = history.history.present,
            id = cause.segmentId;
          const item = snapshot.video1.find(
            (v) => v.id === id || (!id && v.sourceId === cause.sourceId),
          );
          const replacement = snapshot.video2.find(
            (v) => v.id === id || (!id && v.sourceId === cause.sourceId),
          );
          const audio = snapshot.independentAudio.find(
            (v) => v.id === id || (!id && v.source.sourceId === cause.sourceId),
          );
          const music = snapshot.music.find(
            (v) => v.id === id || (!id && v.sourceId === cause.sourceId),
          );
          const selection: TimelineSelection | undefined = item
            ? { kind: 'clip', id: item.id }
            : replacement
              ? { kind: 'replacement', id: replacement.id }
              : audio
                ? { kind: 'independent', id: audio.id }
                : music
                  ? { kind: 'music', id: music.id }
                  : undefined;
          if (selection)
            setSelectionRequest((value) => ({
              serial: (value?.serial ?? 0) + 1,
              selection,
            }));
        }
      }
    } finally {
      releaseOwner();
      if (!controller.signal.aborted && epoch === projectEpoch.current)
        setUploading(false);
      if (uploadController.current === controller)
        uploadController.current = null;
    }
  }
  function newProject() {
    projectFiles.reset();
    projectEpoch.current++;
    uploadController.current?.abort();
    pollingController.current?.abort();
    setUploading(false);
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    history.clearProject();
    setExportFormats(['mp4']);
    setActiveDragDraft(null);
    setSelectionRequest(undefined);
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
      ref={workspaceRef}
      tabIndex={-1}
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
        <ProjectFileControls
          controller={projectFiles}
          availability={fileAvailability}
          workspaceRef={workspaceRef}
        />
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
        transportController={history}
        audioActions={audioActions}
        selectionRequest={selectionRequest}
        placement={{
          snapshot: history.view,
          sources,
          limits,
          activeDraft: activeDragDraft,
          onCommit: placeMedia,
          onError: setHistoryError,
          onExternal: (track, file, start) => {
            history.importToBin(
              file,
              track === 'video1' || track === 'video2' ? 'video' : 'audio',
              { track, timelineStartFrame: start },
            );
          },
        }}
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
            setHistoryError(edit.error.message);
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
        onInsert={insertVideo1}
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
            <MediaBin
              sources={[
                ...history.view.binSourceIds,
                ...history.pendingBinImports
                  .filter((v) => !v.placement && !v.replaceId)
                  .map((v) => v.token.sourceId),
              ]
                .map((id) => sources.get(id))
                .filter((v) => v !== undefined)}
              fps={timeline.fps}
              disabled={
                !health ||
                editingLocked ||
                history.gestureActive ||
                editingClipId !== null
              }
              onImport={(file, type) => {
                history.importToBin(file, type);
              }}
              onRemove={(id) => {
                const pending = history.pendingBinImports.find(
                  (v) => v.token.sourceId === id,
                );
                if (pending) history.cancelBinImport(pending.token);
                else history.removeBinSource(id);
                setActiveDragDraft(null);
              }}
              onPlace={placeMedia}
              onDragDraft={setActiveDragDraft}
              onPip={(file) => selectOverlay('video', file)}
            />
            {history.pendingBinImports.map(
              ({ token, mediaType, placement, replaceId }) => (
                <div key={token.sourceId}>
                  {(placement || replaceId) && (
                    <>
                      <p role="status">
                        Reading {sources.get(token.sourceId)!.file.name} for{' '}
                        {placement
                          ? `${placement.track} at frame ${placement.timelineStartFrame}`
                          : 'audio replacement'}
                        .
                      </p>
                      <button
                        type="button"
                        onClick={() => history.cancelBinImport(token)}
                      >
                        Cancel pending placement
                      </button>
                    </>
                  )}
                  <TimelineSourceProbe
                    token={token}
                    file={sources.get(token.sourceId)!.file}
                    url={sources.ensureUrl(token.sourceId)}
                    track={mediaType === 'video' ? 'bin-video' : 'bin-audio'}
                    onReady={history.sourceReady}
                    onError={(token) => {
                      history.sourceError(token);
                      setHistoryError(
                        'Could not read media metadata. Re-import the source.',
                      );
                    }}
                  />
                </div>
              ),
            )}
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
              if (
                musicToken &&
                musicToken.sourceId === history.history.present.musicSourceId
              )
                history.sourceReady(musicToken, { duration });
            }}
            onMetadataError={() => {
              if (
                musicToken &&
                musicToken.sourceId === history.history.present.musicSourceId
              )
                history.sourceError(musicToken);
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
            <ExportOptions
              formats={exportFormats}
              onChange={(formats) => {
                if (projectFiles.openPhase !== 'idle') return;
                history.updateExternalProjectContext(
                  { exportFormats: formats },
                  'export',
                );
                setExportFormats(formats);
              }}
              capabilities={health?.export_capabilities}
              disabled={
                !health ||
                editingLocked ||
                history.gestureActive ||
                Boolean(editingClipId)
              }
            />
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
            {job?.exports ? (
              <JobResult key={job.job_id} job={job} onNewProject={newProject} />
            ) : completed && job ? (
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
