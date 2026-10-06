import { useRef } from 'react';
import type { ClipEdit, ClipTrim, ProjectFps } from '../lib/clips';

type Props = {
  clip: ClipEdit;
  edge: 'startFrame' | 'endFrame';
  fps: ProjectFps;
  totalFrames: number;
  disabled: boolean;
  onTrim?: (id: string, trim: ClipTrim) => void;
  onDragActive: (active: boolean) => void;
};

export function TimelineTrimHandle({
  clip,
  edge,
  fps,
  totalFrames,
  disabled,
  onTrim,
  onDragActive,
}: Props) {
  const drag = useRef<{
    pointerId: number;
    x: number;
    framesPerPixel: number;
    trim: ClipTrim;
  } | null>(null);
  return (
    <button
      type="button"
      className={`timeline-trim-handle ${edge === 'startFrame' ? 'trim-left' : 'trim-right'}`}
      aria-label={`Trim ${edge === 'startFrame' ? 'start' : 'end'} of ${clip.file.name}`}
      title={`Drag to trim source frame ${clip.trim[edge]}. Use the Trim editor for precise frame numbers.`}
      disabled={disabled || !onTrim}
      draggable={false}
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled || !onTrim || event.button !== 0) return;
        const width =
          event.currentTarget.parentElement?.parentElement?.getBoundingClientRect()
            .width ?? 0;
        if (width <= 0) return;
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          framesPerPixel:
            ((totalFrames / width) * clip.metadata.fps * clip.speed) / fps,
          trim: { ...clip.trim },
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onDragActive(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (
          !current ||
          current.pointerId !== event.pointerId ||
          disabled ||
          !onTrim
        )
          return;
        event.stopPropagation();
        const delta = Math.round(
          (event.clientX - current.x) * current.framesPerPixel,
        );
        const trim = { ...current.trim };
        trim[edge] =
          edge === 'startFrame'
            ? Math.max(0, Math.min(trim.endFrame, trim.startFrame + delta))
            : Math.max(
                trim.startFrame,
                Math.min(clip.metadata.totalFrames - 1, trim.endFrame + delta),
              );
        if (
          trim.startFrame !== clip.trim.startFrame ||
          trim.endFrame !== clip.trim.endFrame
        )
          onTrim(clip.id, trim);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        onDragActive(false);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        onDragActive(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        onDragActive(false);
      }}
    />
  );
}
