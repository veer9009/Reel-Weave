import { useState } from 'react';
import type { DragEvent, ReactNode, Ref } from 'react';
import type { ProjectFps, Limits } from '../lib/clips';
import type { SourceRecord, ProjectSources } from '../lib/projectSources';
import type { EditSnapshot } from '../lib/editHistory';
import type { PlacementDraft } from '../lib/placement';
import {
  SOURCE_DRAG_MIME,
  sourceDragData,
  parseSourceDragData,
  dropFrame,
  placementDuration,
  validatePlacement,
} from '../lib/placement';
import { SourcePlacementDialog } from './TimelinePlacementDialog';

export function MediaBin({
  sources,
  disabled,
  fps,
  onImport,
  onRemove,
  onPlace,
  onDragDraft,
  onPip,
}: {
  sources: readonly SourceRecord[];
  disabled: boolean;
  fps: ProjectFps | null;
  onImport: (file: File, type: 'video' | 'audio') => void;
  onRemove: (id: string) => void;
  onPlace: (draft: PlacementDraft) => boolean;
  onDragDraft?: (draft: PlacementDraft | null) => void;
  onPip?: (file: File) => void;
}) {
  const [selected, setSelected] = useState<SourceRecord | null>(null);
  return (
    <section className="panel media-bin" aria-label="Project media bin">
      <h2>Media Bin</h2>
      {(['video', 'audio'] as const).map((type) => (
        <label key={type}>
          Import {type} to bin
          <input
            aria-label={`Import ${type} to bin`}
            type="file"
            multiple
            disabled={disabled}
            accept={
              type === 'video' ? '.mp4,.mov,.webm,.mkv' : '.mp3,.wav,.aac,.m4a'
            }
            onChange={(e) => {
              for (const file of e.target.files ?? []) onImport(file, type);
              e.target.value = '';
            }}
          />
        </label>
      ))}
      {sources.map((source) => (
        <article
          className="media-bin-source"
          key={source.token.sourceId}
          draggable={!disabled && source.status === 'ready'}
          aria-label={`${source.mediaType} source ${source.file.name}`}
          onDragStart={(e) => {
            if (disabled || source.status !== 'ready') {
              e.preventDefault();
              return;
            }
            const draft: PlacementDraft = {
              token: source.token,
              track: source.mediaType === 'video' ? 'video1' : 'independent',
              timelineStartFrame: 0,
            };
            e.dataTransfer.clearData();
            e.dataTransfer.setData(SOURCE_DRAG_MIME, sourceDragData(draft));
            e.dataTransfer.effectAllowed = 'copy';
            onDragDraft?.(draft);
          }}
          onDragEnd={() => onDragDraft?.(null)}
        >
          <strong title={source.file.name}>{source.file.name}</strong>
          <span>
            {source.mediaType === 'video' ? 'Video source' : 'Audio source'}
          </span>
          {source.status === 'loading' && (
            <p role="status">Reading metadata for {source.file.name}…</p>
          )}
          {source.status === 'error' && (
            <p role="status">Metadata unavailable. Re-import this source.</p>
          )}
          <button
            type="button"
            disabled={disabled || source.status !== 'ready'}
            aria-label={`Place ${source.file.name} on track`}
            onClick={() => setSelected(source)}
          >
            Place on Track
          </button>
          {onPip && source.mediaType === 'video' && (
            <button
              type="button"
              aria-label={`Use ${source.file.name} as PIP`}
              disabled={disabled || source.status !== 'ready'}
              onClick={() => onPip(source.file)}
            >
              Use as PIP
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${source.file.name} from bin`}
            onClick={() => onRemove(source.token.sourceId)}
          >
            Remove from bin
          </button>
        </article>
      ))}
      {!sources.length && <p>No reusable sources yet.</p>}
      {selected && (
        <SourcePlacementDialog
          source={selected}
          fps={fps}
          disabled={disabled}
          onCancel={() => setSelected(null)}
          onSave={(draft) => {
            if (!onPlace(draft)) return false;
            setSelected(null);
            return true;
          }}
        />
      )}
    </section>
  );
}

export type SourcePlacementActions = {
  snapshot: EditSnapshot;
  sources: ProjectSources;
  limits: Limits;
  activeDraft: PlacementDraft | null;
  onCommit: (draft: PlacementDraft) => boolean;
  onExternal: (
    track: PlacementDraft['track'],
    file: File,
    start: number,
  ) => void;
  onError: (message: string) => void;
};
export function TimelineDropZone({
  placement,
  track,
  displayFrames,
  disabled,
  children,
  className = 'track-content',
  label,
  laneRef,
  onLegacyDrop,
}: {
  placement?: SourcePlacementActions;
  track: PlacementDraft['track'];
  displayFrames: number;
  disabled: boolean;
  children: ReactNode;
  className?: string;
  label: string;
  laneRef?: Ref<HTMLDivElement>;
  onLegacyDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const [ghost, setGhost] = useState<{
    start: number;
    duration: number;
    error?: string;
    warning?: string;
  } | null>(null);
  const frame = (e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return dropFrame(
      e.clientX,
      rect.left,
      rect.width / Math.max(1, displayFrames),
    );
  };
  return (
    <div
      ref={laneRef}
      className={className}
      aria-label={label}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setGhost(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        if (disabled || !placement) return;
        const p = frame(e);
        if ('error' in p) {
          setGhost({ start: 0, duration: 0, error: p.error.message });
          return;
        }
        const source = e.dataTransfer.types.includes(SOURCE_DRAG_MIME)
          ? placement.activeDraft
          : null;
        if (!source) {
          setGhost({ start: p.value, duration: 0 });
          return;
        }
        const draft = { ...source, track, timelineStartFrame: p.value },
          result = validatePlacement(
            placement.snapshot,
            placement.sources,
            draft,
            placement.limits,
          ),
          duration = placementDuration(
            placement.snapshot,
            placement.sources,
            draft,
          );
        const warning =
          (track === 'video1' || track === 'video2') &&
          placement.snapshot.independentAudio.some(
            (v) =>
              p.value < v.timelineStartFrame + v.durationFrames &&
              v.timelineStartFrame < p.value + duration,
          )
            ? 'Independent audio will remain over the new picture.'
            : undefined;
        setGhost({
          start: p.value,
          duration,
          error: 'error' in result ? result.error.message : undefined,
          warning,
        });
      }}
      onDrop={(e) => {
        if (!placement) {
          onLegacyDrop?.(e);
          return;
        }
        if (
          !e.dataTransfer.types.includes(SOURCE_DRAG_MIME) &&
          !e.dataTransfer.types.includes('Files')
        ) {
          onLegacyDrop?.(e);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        setGhost(null);
        if (disabled) return;
        const p = frame(e);
        if ('error' in p) {
          placement.onError(p.error.message);
          return;
        }
        if (e.dataTransfer.types.includes(SOURCE_DRAG_MIME)) {
          const parsed = parseSourceDragData(
            e.dataTransfer.getData(SOURCE_DRAG_MIME),
            placement.sources,
          );
          if ('error' in parsed) placement.onError(parsed.error.message);
          else
            placement.onCommit({
              ...parsed.value,
              track,
              timelineStartFrame: p.value,
            });
        } else {
          const files = [...e.dataTransfer.files];
          if (files.length !== 1)
            placement.onError('Drop one eligible media file at a time.');
          else placement.onExternal(track, files[0], p.value);
        }
      }}
    >
      {children}
      {ghost && (
        <span
          role="status"
          className={`position-ghost${ghost.error ? ' invalid' : ''}`}
          style={{
            left: `${(ghost.start / Math.max(1, displayFrames)) * 100}%`,
          }}
        >
          {ghost.error ??
            `Frame ${ghost.start} · ${ghost.duration ? `${ghost.duration} frames · [${ghost.start}, ${ghost.start + ghost.duration})` : 'Reading media duration'}`}
          {ghost.warning && <small>{ghost.warning}</small>}
        </span>
      )}
    </div>
  );
}
