import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clapperboard,
  Heart,
  Layers,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { UploadCard } from './components/UploadCard';
import { ClipList } from './components/ClipList';
import { MergeSummary } from './components/MergeSummary';
import { JobResult } from './components/JobResult';
import { TrimEditor } from './components/TrimEditor';
import { BackgroundAudioTrack } from './components/BackgroundAudioTrack';
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
} from './lib/clips';

export default function App() {
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
    max_clips: 10,
    max_file_size_mb: 200,
    max_audio_file_size_mb: 100,
  };
  const editableClips = clips.filter(isEditableClip);
  const editsValid =
    editableClips.length === clips.length &&
    (!backgroundAudio || backgroundAudio.status === 'ready');
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
    setClips((current) =>
      current.map((clip) =>
        clip.id === id ? { ...clip, trim, trimSaved: true } : clip,
      ),
    );
    setEditingClipId(null);
    setJob(null);
  }
  function changeSpeed(id: string, speed: ClipSpeed) {
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
    setError(null);
  }
  function removeBackgroundAudio() {
    if (!backgroundAudio) return;
    URL.revokeObjectURL(backgroundAudio.url);
    urls.current.delete(backgroundAudio.url);
    setBackgroundAudio(null);
    setJob(null);
  }
  function removeClip(id: string) {
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
    setClips((current) => moveClip(current, from, to));
    setJob(null);
    setAnnouncement(
      `${clips[from]?.file.name ?? 'Clip'} moved to position ${to + 1}.`,
    );
  }
  async function merge() {
    if (
      active ||
      clips.length < 2 ||
      !health?.ffmpeg_available ||
      !health.ffprobe_available ||
      !editsValid
    )
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
    try {
      setJob(
        await submitMerge(
          editableClips,
          buildMergeManifest(editableClips, audioSettings),
          backgroundAudio?.file,
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
  function reset() {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    setClips([]);
    setBackgroundAudio(null);
    setEditingClipId(null);
    setAudioSettings({
      originalVolume: 1,
      originalMuted: false,
      musicVolume: 0.3,
      musicMuted: false,
    });
    setJob(null);
    setError(null);
    setPollError(false);
    setAnnouncement('Ready for a new story.');
  }
  const step = active || completed ? 2 : clips.length ? 1 : 0;
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
    >
      <header className="site-header">
        <a className="brand" href="/" aria-label="ReelWeave home">
          <span className="brand-mark">
            <Clapperboard aria-hidden="true" />
          </span>
          <span>
            Reel<span>Weave</span>
          </span>
        </a>
        <div className="header-note">
          <LockKeyhole aria-hidden="true" />
          <span>Your clips. Your story.</span>
          <span className="dot" />
          <span className="local-label">Local workspace</span>
        </div>
      </header>
      <main className="workspace">
        <section className="intro" aria-labelledby="page-title">
          <span className="eyebrow">
            <Sparkles aria-hidden="true" />
            SMALL CLIPS. BIGGER STORIES.
          </span>
          <h1 id="page-title">
            Turn your clips into{' '}
            <span className="gradient-text">one story.</span>
          </h1>
          <p>
            Bring your favorite moments together in one seamless video.
            <br /> Upload, arrange, and let your story unfold.
          </p>
        </section>
        <nav className="steps" aria-label="Merge steps">
          {['Upload', 'Arrange', 'Merge'].map((label, index) => (
            <div key={label} style={{ display: 'contents' }}>
              {index > 0 && <span className="step-line" aria-hidden="true" />}
              <span
                className={`step ${index === step ? 'active' : index < step ? 'done' : ''}`}
                aria-current={index === step ? 'step' : undefined}
              >
                <span className="step-number">
                  {index < step ? <Check aria-hidden="true" /> : index + 1}
                </span>
                {label}
              </span>
            </div>
          ))}
        </nav>
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
        <div className="editor-grid">
          <div className="editor-main">
            {completed ? (
              <JobResult key={job.job_id} job={job} onReset={reset} />
            ) : (
              <>
                {active ? (
                  <section
                    className="panel processing"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <span className="spinner" aria-hidden="true" />
                    <h2>
                      {uploading
                        ? 'Uploading your clips…'
                        : job?.status === 'queued'
                          ? 'Your story is in the queue.'
                          : 'Weaving your story…'}
                    </h2>
                    <p>
                      {uploading
                        ? 'Sending your clips in the order you chose. Keep this tab open.'
                        : job?.status === 'queued'
                          ? 'Your clips are ready. Processing will begin when the worker is available.'
                          : 'Matching your clips and bringing every moment together. Longer videos may take a little time.'}
                    </p>
                    <span className="status-pill">
                      <span className="pulse-dot" />
                      {uploading
                        ? 'Uploading'
                        : job?.status === 'queued'
                          ? 'Queued'
                          : 'Processing'}
                    </span>
                  </section>
                ) : (
                  <UploadCard
                    disabled={!health}
                    limits={limits}
                    onSelect={selectFiles}
                  />
                )}
                <ClipList
                  clips={clips}
                  disabled={active}
                  onMove={reorder}
                  onRemove={removeClip}
                  onMetadata={setClipMetadata}
                  onMetadataError={setClipMetadataError}
                  onTrim={setEditingClipId}
                  onSpeedChange={changeSpeed}
                />
                <BackgroundAudioTrack
                  audio={backgroundAudio}
                  settings={audioSettings}
                  disabled={active}
                  onSelect={selectBackgroundAudio}
                  onMetadata={(duration) =>
                    setBackgroundAudio((current) =>
                      current
                        ? { ...current, duration, status: 'ready' }
                        : null,
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
              </>
            )}
          </div>
          <MergeSummary
            clips={clips}
            busy={active}
            disabled={
              active ||
              completed ||
              clips.length < 2 ||
              !health?.ffmpeg_available ||
              !health?.ffprobe_available ||
              !editsValid
            }
            onMerge={() => void merge()}
          />
        </div>
        {editingClipId &&
          (() => {
            const clip = clips.find(
              (candidate) => candidate.id === editingClipId,
            );
            return clip && isEditableClip(clip) ? (
              <TrimEditor
                clip={clip}
                disabled={active}
                onSave={saveTrim}
                onCancel={() => setEditingClipId(null)}
              />
            ) : null;
          })()}
        <section className="features" aria-label="Made for your moments">
          <div className="feature">
            <span className="feature-icon">
              <Layers aria-hidden="true" />
            </span>
            <div>
              <h3>Different clips. One format.</h3>
              <p>
                Mix formats, sizes, and frame rates.
                <br />
                We take care of the details.
              </p>
            </div>
          </div>
          <div className="feature">
            <span className="feature-icon">
              <Zap aria-hidden="true" />
            </span>
            <div>
              <h3>Simple from start to finish.</h3>
              <p>
                No timeline to learn. Just your clips,
                <br />
                in the order that tells your story.
              </p>
            </div>
          </div>
          <div className="feature">
            <span className="feature-icon">
              <ShieldCheck aria-hidden="true" />
            </span>
            <div>
              <h3>Your moments stay yours.</h3>
              <p>
                No third-party video services.
                <br />
                Automatic temporary-file cleanup.
              </p>
            </div>
          </div>
        </section>
        <footer className="site-footer">
          <span className="footer-brand">
            ReelWeave{' '}
            <span style={{ fontWeight: 400, color: '#9494ac', fontSize: 10 }}>
              {' '}
              / Made for your moments.
            </span>
          </span>
          <p>
            Woven with care <Heart aria-hidden="true" />
          </p>
        </footer>
      </main>
    </div>
  );
}
