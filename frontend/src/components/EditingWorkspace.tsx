import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AudioSettings, Clip, ProjectFpsSelection } from '../lib/clips';
import type { OverlayState } from '../lib/overlays';
import { validateOverlaySchedule } from '../lib/overlays';
import type { TimelineProjection, TimelineSelection } from '../lib/timeline';
import { useProjectPlayback } from '../hooks/useProjectPlayback';
import type { BackgroundAudio } from './BackgroundAudioTrack';
import { Inspector } from './Inspector';
import { ProgramMonitor } from './ProgramMonitor';
import { ProjectTimeline } from './ProjectTimeline';
import './EditingWorkspace.css';
type Props = {
  clips: Clip[];
  timeline: TimelineProjection;
  overlays: OverlayState;
  backgroundAudio: BackgroundAudio | null;
  audioSettings: AudioSettings;
  fpsSelection: ProjectFpsSelection;
  structuralRevision: number;
  editingLocked: boolean;
  onFpsSelectionChange: (fps: ProjectFpsSelection) => void;
  onPipDrop?: (file: File) => void;
  mediaContent: ReactNode;
  clipContent: ReactNode;
  overlayContent: ReactNode;
  audioContent: ReactNode;
  deliveryContent: ReactNode;
  resultContent: ReactNode;
};
export function EditingWorkspace(props: Props) {
  const {
    clips,
    timeline,
    overlays,
    backgroundAudio,
    audioSettings,
    fpsSelection,
    structuralRevision,
    editingLocked,
    onFpsSelectionChange,
  } = props;
  const [selection, setSelection] = useState<TimelineSelection>({
    kind: 'none',
  });
  const playback = useProjectPlayback(timeline, structuralRevision);
  const invalid =
    (!clips.length && selection.kind !== 'none') ||
    (selection.kind === 'clip'
      ? !clips.some((clip) => clip.id === selection.id)
      : selection.kind === 'overlay'
        ? !overlays[selection.overlayKind]
        : selection.kind === 'audio' && selection.track === 'music'
          ? !backgroundAudio
          : false);
  if (invalid) setSelection({ kind: 'none' });
  const selectedClip =
    selection.kind === 'clip'
      ? clips.find((clip) => clip.id === selection.id)
      : null;
  return (
    <main className="editing-workspace" aria-label="Editing workspace">
      <h1>Sequence 01</h1>
      {(['image', 'video'] as const).map(
        (kind) =>
          overlays[kind] &&
          validateOverlaySchedule(overlays[kind], timeline.totalFrames) && (
            <div className="workspace-validation" role="alert" key={kind}>
              <p>
                {kind === 'image' ? 'Image' : 'Video'} overlay needs attention.
              </p>
              <button
                type="button"
                onClick={() =>
                  setSelection({ kind: 'overlay', overlayKind: kind })
                }
              >
                Review {kind} overlay
              </button>
            </div>
          ),
      )}
      <div className="workspace-panels">
        <section className="media-panel" aria-label="Media">
          {props.mediaContent}
        </section>
        <ProgramMonitor
          timeline={timeline}
          overlays={overlays}
          frame={playback.frame}
          playing={playback.playing}
          onSeek={playback.seek}
          onToggle={playback.toggle}
        />
        <Inspector
          selection={selection}
          clipContent={
            <>
              <label>
                Inspect clip
                <select
                  aria-label="Inspect clip"
                  value={selection.kind === 'clip' ? selection.id : ''}
                  onChange={(event) =>
                    setSelection(
                      event.target.value
                        ? { kind: 'clip', id: event.target.value }
                        : { kind: 'none' },
                    )
                  }
                >
                  <option value="">Choose a clip</option>
                  {clips.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.file.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedClip ? (
                <>
                  <p>Selected: {selectedClip.file.name}</p>
                  {selectedClip.metadata && (
                    <p>
                      Source: {selectedClip.metadata.width} ×{' '}
                      {selectedClip.metadata.height} ·{' '}
                      {selectedClip.metadata.fps} FPS
                      {selectedClip.metadata.source === 'browser'
                        ? ' (browser estimate)'
                        : ''}
                    </p>
                  )}
                  {selectedClip.trim && (
                    <p>
                      Source frames {selectedClip.trim.startFrame}–
                      {selectedClip.trim.endFrame} · Speed{' '}
                      {selectedClip.speed ?? 1}x
                    </p>
                  )}
                </>
              ) : (
                <p>Select a timeline clip to inspect it.</p>
              )}
              {props.clipContent}
            </>
          }
          overlayContent={props.overlayContent}
          audioContent={props.audioContent}
          deliveryContent={props.deliveryContent}
        />
      </div>
      <ProjectTimeline
        timeline={timeline}
        overlays={overlays}
        backgroundAudio={backgroundAudio}
        audioSettings={audioSettings}
        selection={selection}
        frame={playback.frame}
        fpsSelection={fpsSelection}
        disabled={editingLocked}
        onFpsSelectionChange={onFpsSelectionChange}
        onSeek={playback.seek}
        onSelect={setSelection}
        onPipDrop={props.onPipDrop}
      />
      <section className="render-region" aria-label="Render result">
        {props.resultContent}
      </section>
    </main>
  );
}
