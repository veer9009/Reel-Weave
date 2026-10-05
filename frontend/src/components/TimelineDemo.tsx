import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LockKeyhole,
  Play,
  Pause,
  Film,
  Music2,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { resolveProjectFps } from '../lib/clips';
import type { Clip, ProjectFpsSelection } from '../lib/clips';
import { projectFrameCount } from '../lib/overlays';
import type { OverlayState } from '../lib/overlays';
import './TimelineDemo.css';

const names = [
  'Opening shot',
  'The detail',
  'In motion',
  'Fresh perspective',
  'Product reveal',
  'Everyday ritual',
  'Made to move',
  'Closer look',
  'The collection',
  'Signature shot',
  'Brand moment',
  'Final frame',
];
const tracks = ['VIDEO 2', 'VIDEO 1', 'AUDIO 1', 'AUDIO 2'];
function originalFps(clip?: Clip): number | null {
  if (!clip) return 30;
  const fps = clip.metadata?.fps;
  return fps && Number.isFinite(fps) && fps > 0 ? fps : null;
}
function frameRange(item: {
  startFrame: number | null;
  frameCount: number | null;
}) {
  return item.startFrame !== null && item.frameCount !== null
    ? `Frames ${item.startFrame}–${item.startFrame + item.frameCount - 1}`
    : 'Frames unavailable';
}
function timestamp(time: number) {
  return `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
}
function Waveform({ seed = 0 }: { seed?: number }) {
  return (
    <div className="td-wave" aria-hidden="true">
      {Array.from({ length: 48 }, (_, i) => (
        <i key={i} style={{ height: `${18 + ((i * 31 + seed * 17) % 75)}%` }} />
      ))}
    </div>
  );
}

export function TimelineDemo({
  clips,
  musicName,
  fpsSelection,
  onFpsSelectionChange,
  canMerge,
  busy,
  onMerge,
  overlays = { image: null, video: null },
}: {
  clips: Clip[];
  musicName?: string;
  fpsSelection: ProjectFpsSelection;
  onFpsSelectionChange: (selection: ProjectFpsSelection) => void;
  canMerge: boolean;
  busy: boolean;
  onMerge: () => void;
  overlays?: OverlayState;
}) {
  const timelineFps =
    clips.length === 0
      ? fpsSelection === 'auto'
        ? 30
        : resolveProjectFps(fpsSelection)
      : resolveProjectFps(fpsSelection, clips[0]?.metadata?.fps);
  const sequence = useMemo(() => {
    return Array.from(
      { length: Math.max(names.length, clips.length) },
      (_, index) => names[index] ?? `Clip ${index + 1}`,
    )
      .map((name, index) => {
        const clip = clips[index];
        const fps = originalFps(clip);
        const offset = clip?.trim && fps ? clip.trim.startFrame / fps : 0;
        const sourceDuration =
          clip?.trim && fps
            ? (clip.trim.endFrame - clip.trim.startFrame + 1) / fps
            : clip?.metadata?.duration || clip?.duration || 4;
        const duration = sourceDuration / (clip?.speed || 1);
        // Each slot occupies whole timeline frames; source trim/FPS stay untouched.
        const selectedFrames =
          clip?.trim && fps
            ? clip.trim.endFrame - clip.trim.startFrame + 1
            : Math.max(1, Math.round(sourceDuration * (fps ?? 30)));
        const frameCount =
          timelineFps === null || fps === null
            ? null
            : projectFrameCount(
                selectedFrames,
                fps,
                clip?.speed || 1,
                timelineFps,
              );
        const item = {
          name: clip?.file.name || name,
          clip,
          duration:
            frameCount !== null && timelineFps !== null
              ? frameCount / timelineFps
              : duration,
          frameCount,
          offset,
          index,
        };
        return item;
      })
      .map((item, index, items) => {
        const previous = items.slice(0, index);
        const startFrame =
          timelineFps === null
            ? null
            : previous.reduce((sum, clip) => sum + (clip.frameCount ?? 0), 0);
        return {
          ...item,
          startFrame,
          start:
            startFrame !== null && timelineFps !== null
              ? startFrame / timelineFps
              : previous.reduce((sum, clip) => sum + clip.duration, 0),
        };
      });
  }, [clips, timelineFps]);
  const duration = sequence.reduce((sum, clip) => sum + clip.duration, 0);
  const totalFrames =
    timelineFps === null
      ? null
      : sequence.reduce((sum, clip) => sum + (clip.frameCount ?? 0), 0);
  const [position, setTime] = useState(0);
  const time = Math.min(position, duration);
  const [playing, setPlaying] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const pipVideo = useRef<HTMLVideoElement>(null);
  const current =
    sequence.find((clip) => time < clip.start + clip.duration) ||
    sequence[sequence.length - 1];
  const running = playing && time < duration;
  const source = current.clip?.metadata;
  const frameAtTime = (seconds: number) =>
    timelineFps !== null && totalFrames !== null
      ? Math.min(
          totalFrames - 1,
          Math.max(0, Math.floor(seconds * timelineFps + 1e-7)),
        )
      : null;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setTime((value) => Math.min(duration, value + 0.05)),
      50,
    );
    return () => window.clearInterval(timer);
  }, [running, duration]);
  const syncVideo = useCallback(() => {
    const element = video.current;
    if (!element) return;
    const position =
      current.offset +
      Math.max(0, time - current.start) * (current.clip?.speed || 1);
    if (Number.isFinite(element.duration)) {
      if (!running || Math.abs(element.currentTime - position) > 0.25)
        element.currentTime = Math.min(position, element.duration);
      element.playbackRate = current.clip?.speed || 1;
    }
    if (running && element.paused)
      void element.play().catch(() => setMediaError(true));
    if (!running && !element.paused) element.pause();
  }, [time, current, running]);
  useEffect(() => syncVideo(), [syncVideo]);
  const projectFrame = frameAtTime(time);
  const imageVisible = Boolean(
    overlays.image &&
    overlays.image.metadataStatus === 'ready' &&
    projectFrame !== null &&
    projectFrame >= overlays.image.startFrame &&
    projectFrame <= overlays.image.endFrame,
  );
  const pipRelativeTime =
    overlays.video && projectFrame !== null && timelineFps !== null
      ? (projectFrame - overlays.video.startFrame) / timelineFps
      : -1;
  const pipVisible = Boolean(
    overlays.video &&
    overlays.video.metadataStatus === 'ready' &&
    projectFrame !== null &&
    projectFrame >= overlays.video.startFrame &&
    projectFrame <= overlays.video.endFrame &&
    pipRelativeTime >= 0 &&
    overlays.video.duration !== undefined &&
    pipRelativeTime < overlays.video.duration,
  );
  useEffect(() => {
    const element = pipVideo.current;
    if (!element || !pipVisible) return;
    if (Math.abs(element.currentTime - pipRelativeTime) > 0.08)
      element.currentTime = pipRelativeTime;
    if (running && element.paused) void element.play().catch(() => undefined);
    if (!running && !element.paused) element.pause();
  }, [pipRelativeTime, pipVisible, running]);
  function seek(value: number) {
    setTime(value);
    setMediaError(false);
  }
  const percent = (time / duration) * 100;
  return (
    <main className="timeline-demo">
      <header className="td-heading">
        <div>
          <div className="td-kicker">
            <Layers size={14} /> EDIT WORKSPACE
          </div>
          <h1>Sequence 01</h1>
        </div>
        <span className="td-project">
          ReelWeave <ChevronRight size={14} /> Sequence 01
        </span>
      </header>
      <p className="td-notice">
        <span />
        Browser preview is approximate. The downloaded MP4 is rendered by
        FFmpeg.
      </p>
      <div className="td-top">
        <section className="td-preview-panel" aria-label="Video preview">
          <div className="td-panel-heading">
            <span>
              <Film size={15} /> PROGRAM PREVIEW
            </span>
            <span>
              {current.clip ? 'UPLOADED CLIP' : 'SAMPLE STORYBOARD'} ·{' '}
              {String(current.index + 1).padStart(2, '0')} / {sequence.length}
            </span>
          </div>
          <div className={`td-preview td-scene-${current.index % 4}`}>
            {current.clip ? (
              <video
                key={current.clip.id}
                ref={video}
                src={current.clip.url}
                muted
                playsInline
                preload="auto"
                aria-label="Uploaded clip preview"
                onLoadedMetadata={syncVideo}
                onError={() => setMediaError(true)}
              />
            ) : (
              <div className="td-storyboard">
                <div className="td-product">
                  <span>RW</span>
                </div>
                <div className="td-scene-caption">
                  <span>REELWEAVE / SAMPLE CAMPAIGN</span>
                  <strong>{current.name}</strong>
                  <small>
                    Sample visual · add your clips in the merge workspace
                  </small>
                </div>
              </div>
            )}
            {mediaError && (
              <p className="td-media-error" role="status">
                This clip cannot play in this browser. The storyboard clock is
                still available.
              </p>
            )}
            {pipVisible && overlays.video && (
              <video
                ref={pipVideo}
                src={overlays.video.url}
                muted
                playsInline
                preload="auto"
                aria-label="PIP overlay preview"
                className={`td-overlay-preview td-overlay-pip td-overlay-${overlays.video.position} td-overlay-${overlays.video.size}`}
              />
            )}
            {imageVisible && overlays.image && (
              <img
                src={overlays.image.url}
                alt=""
                aria-label="Image overlay preview"
                className={`td-overlay-preview td-overlay-image td-overlay-${overlays.image.position} td-overlay-${overlays.image.size}`}
              />
            )}
          </div>
          <div className="td-transport">
            <button
              className="td-play"
              aria-label={running ? 'Pause preview' : 'Play preview'}
              onClick={() => {
                if (time >= duration) seek(0);
                setPlaying(!running);
              }}
            >
              {running ? <Pause /> : <Play />}
            </button>
            <output aria-label="Current time and frame">
              {timestamp(time)}{' '}
              <span aria-label="Timeline frame">
                {totalFrames !== null
                  ? `Frame ${frameAtTime(time)} / ${totalFrames - 1}`
                  : 'Frame unavailable'}
              </span>
            </output>
            <span className="td-total">/ {timestamp(duration)}</span>
            <span className="td-preview-note">Silent sequence preview</span>
          </div>
        </section>
        <aside className="td-export" aria-label="Export preview">
          <div className="td-kicker">DELIVERY SETTINGS</div>
          <h2>Ready for the final cut.</h2>
          <p>Your ad assembly, in a familiar delivery format.</p>
          <label htmlFor="td-format">Export format</label>
          <select
            id="td-format"
            value="MP4"
            aria-readonly="true"
            onChange={() => undefined}
          >
            <option>MP4</option>
          </select>
          <dl>
            <div>
              <dt>Selected clip</dt>
              <dd>{current.name}</dd>
            </div>
            <div>
              <dt>Timeline frames</dt>
              <dd>{frameRange(current)}</dd>
            </div>
            <div>
              <dt>Source resolution</dt>
              <dd>
                {source
                  ? `${source.width} × ${source.height}`
                  : current.clip
                    ? 'Metadata unavailable'
                    : '1920 × 1080 · sample'}
              </dd>
            </div>
            <div>
              <dt>Original source FPS</dt>
              <dd>
                {source
                  ? `${source.fps} fps${source.source === 'browser' ? ' · estimated' : ''}`
                  : current.clip
                    ? 'Metadata unavailable'
                    : '30 fps · sample'}
              </dd>
            </div>
          </dl>
          <span className="td-quality">
            <span aria-hidden="true">✦ </span>High quality export
          </span>
          <p className="td-export-note">
            Source details follow the selected clip. Only uploaded clips on
            Video 1 are included in this sequential render.
          </p>
          <button
            className="td-render-action"
            type="button"
            disabled={!canMerge || busy || timelineFps === null}
            onClick={onMerge}
          >
            Merge current timeline
          </button>
          <div className="td-export-status">
            <LockKeyhole size={15} /> Multi-track export in development
          </div>
        </aside>
      </div>
      <section className="td-timeline" aria-label="Sequence timeline">
        <div className="td-timeline-settings">
          <label htmlFor="td-fps">Timeline FPS</label>
          <select
            id="td-fps"
            value={fpsSelection}
            onChange={(event) =>
              onFpsSelectionChange(event.target.value as ProjectFpsSelection)
            }
          >
            <option value="auto">Auto (first uploaded clip)</option>
            {[24, 25, 30, 50, 60].map((fps) => (
              <option key={fps} value={fps}>
                {fps} FPS
              </option>
            ))}
          </select>
          <output aria-label="Effective timeline FPS">
            {timelineFps === null
              ? 'Waiting for first uploaded clip FPS'
              : `${timelineFps} FPS${fpsSelection === 'auto' && clips[0]?.metadata?.source === 'browser' ? ' · estimated source' : ''}`}
          </output>
          <span>
            Frame ranges use timeline FPS; source FPS stays unchanged.
          </span>
        </div>
        <div className="td-panel-heading">
          <span>
            <Layers size={16} /> SEQUENCE 01 <b>{sequence.length} clips</b>
          </span>
          <span>
            {timestamp(duration)} TOTAL ·{' '}
            {clips.length ? `${clips.length} uploaded` : 'Sample campaign'}
          </span>
        </div>
        <div
          className="td-scroll"
          tabIndex={0}
          aria-label="Scrollable timeline"
        >
          <div className="td-timeline-inner">
            <div className="td-ruler-row">
              <span className="td-track-heading">
                TRACKS <small>Visual controls</small>
              </span>
              <div className="td-ruler">
                {Array.from({ length: 9 }, (_, index) => (
                  <span key={index} style={{ left: `${index * 12.5}%` }}>
                    {timestamp((duration * index) / 8)}
                    <small>
                      {frameAtTime((duration * index) / 8) ?? '—'} f
                    </small>
                  </span>
                ))}
                <input
                  aria-label="Timeline position"
                  type="range"
                  min="0"
                  max={duration}
                  step="0.01"
                  value={time}
                  onChange={(event) => seek(Number(event.target.value))}
                />
              </div>
            </div>
            <div className="td-tracks">
              <div className="td-playhead-area" aria-hidden="true">
                <div className="td-playhead" style={{ left: `${percent}%` }}>
                  <i />
                </div>
              </div>
              {tracks.map((track) => (
                <section
                  key={track}
                  className={`td-track ${track.startsWith('AUDIO') ? 'td-audio' : ''}`}
                  aria-label={track}
                >
                  <div className="td-track-label">
                    <strong>
                      {track.startsWith('VIDEO') ? (
                        <Film size={13} />
                      ) : (
                        <Music2 size={13} />
                      )}
                      {track}
                    </strong>
                  </div>
                  <div className="td-lane">
                    {track === 'VIDEO 1' &&
                      sequence.map((item) => (
                        <button
                          key={item.index}
                          aria-label={`Preview clip ${item.index + 1}: ${item.name}${item.clip ? '' : ' (sample ad)'}`}
                          title={`${item.clip ? item.name : `Sample ad · ${item.name}`} | ${frameRange(item)} | Original source FPS: ${originalFps(item.clip) ?? 'unavailable'}${item.clip ? (item.clip.metadata?.source === 'browser' ? ' (estimated)' : '') : ' (sample)'}`}
                          aria-pressed={current.index === item.index}
                          className={`td-clip td-scene-${item.index % 4}`}
                          style={{
                            width: `${(item.duration / duration) * 100}%`,
                          }}
                          onClick={() => seek(item.start)}
                        >
                          <i className="td-handle" />
                          {item.clip ? (
                            <video
                              src={item.clip.url}
                              muted
                              preload="metadata"
                              aria-hidden="true"
                              tabIndex={-1}
                            />
                          ) : (
                            <>
                              <div className="td-mini-product" />
                              <small className="td-sample-label">
                                SAMPLE AD
                              </small>
                            </>
                          )}
                          <span>
                            {String(item.index + 1).padStart(2, '0')} ·{' '}
                            {item.name}
                            <small>{frameRange(item)}</small>
                          </span>
                          <i className="td-handle td-handle-end" />
                        </button>
                      ))}
                    {track === 'VIDEO 2' && totalFrames !== null && (
                      <>
                        {overlays.video && (
                          <div
                            className="td-overlay td-overlay-lane-pip"
                            aria-label="PIP overlay lane item"
                            style={{
                              left: `${(overlays.video.startFrame / totalFrames) * 100}%`,
                              width: `${((overlays.video.endFrame - overlays.video.startFrame + 1) / totalFrames) * 100}%`,
                            }}
                          >
                            <Film size={13} /> {overlays.video.file.name}
                          </div>
                        )}
                        {overlays.image && (
                          <div
                            className="td-overlay td-overlay-lane-image"
                            aria-label="Image overlay lane item"
                            style={{
                              left: `${(overlays.image.startFrame / totalFrames) * 100}%`,
                              width: `${((overlays.image.endFrame - overlays.image.startFrame + 1) / totalFrames) * 100}%`,
                            }}
                          >
                            <Layers size={13} /> {overlays.image.file.name}
                          </div>
                        )}
                      </>
                    )}
                    {track === 'AUDIO 1' &&
                      sequence.map((item) => (
                        <div
                          className="td-audio-segment"
                          key={item.index}
                          style={{
                            width: `${(item.duration / duration) * 100}%`,
                          }}
                        >
                          <span>{item.index + 1} · Original audio</span>
                          <Waveform seed={item.index} />
                        </div>
                      ))}
                    {track === 'AUDIO 2' && musicName && (
                      <div className="td-music">
                        <span>
                          <Music2 size={12} /> {musicName}
                        </span>
                        <Waveform seed={7} />
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
        <footer className="td-timeline-footer">
          <span>
            <span className="td-green-dot" /> Click a clip or scrub the ruler to
            preview
          </span>
          <span>
            Overlay placement is approximate in-browser; FFmpeg renders the
            final MP4.
          </span>
        </footer>
      </section>
    </main>
  );
}
