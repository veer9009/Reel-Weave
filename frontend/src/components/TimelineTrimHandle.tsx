import { useEffect, useRef } from 'react';
import type { GestureToken } from '../lib/editHistory';
export type TrimTransactions = {
  onTrimBegin?: (id: string) => GestureToken | null;
  onTrimPreview?: (token: GestureToken, id: string, trim: ClipTrim) => void;
  onTrimEnd?: (token: GestureToken, accept: boolean) => void;
};
import type { ClipEdit, ClipTrim, ProjectFps } from '../lib/clips';

type Props = TrimTransactions & {
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
  onTrimBegin,
  onTrimPreview,
  onTrimEnd,
  onDragActive,
}: Props) {
  const drag = useRef<{
    pointerId: number;
    x: number;
    framesPerPixel: number;
    trim: ClipTrim;
    token: GestureToken | null;
  } | null>(null);
  const endRef = useRef(onTrimEnd);
  useEffect(() => {
    endRef.current = onTrimEnd;
  });
  useEffect(() => {
    if (disabled && drag.current) {
      const token = drag.current.token;
      drag.current = null;
      if (token) endRef.current?.(token, false);
      onDragActive(false);
    }
  }, [disabled, onDragActive]);
  useEffect(
    () => () => {
      const token = drag.current?.token;
      drag.current = null;
      if (token) endRef.current?.(token, false);
    },
    [clip.id],
  );
  return (
    <button
      type="button"
      className={`timeline-trim-handle ${edge === 'startFrame' ? 'trim-left' : 'trim-right'}`}
      aria-label={`Trim ${edge === 'startFrame' ? 'start' : 'end'} of ${clip.file.name}`}
      title={`Drag to trim source frame ${clip.trim[edge]}. Use the Trim editor for precise frame numbers.`}
      disabled={disabled || (!onTrim && !onTrimBegin)}
      draggable={false}
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled || (!onTrim && !onTrimBegin) || event.button !== 0) return;
        const width =
          event.currentTarget.parentElement?.parentElement?.getBoundingClientRect()
            .width ?? 0;
        if (width <= 0) return;
        const token = onTrimBegin?.(clip.id) ?? null;
        if (onTrimBegin && !token) return;
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          framesPerPixel:
            ((totalFrames / width) * clip.metadata.fps * clip.speed) / fps,
          trim: { ...clip.trim },
          token,
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
          (!onTrim && !onTrimPreview)
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
          if (current.token) onTrimPreview?.(current.token, clip.id, trim);
          else onTrim?.(clip.id, trim);
      }}
      onPointerUp={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const token = drag.current.token;
        drag.current = null;
        if (token) onTrimEnd?.(token, true);
        onDragActive(false);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const token = drag.current.token;
        drag.current = null;
        if (token) onTrimEnd?.(token, false);
        onDragActive(false);
      }}
      onLostPointerCapture={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const token = drag.current.token;
        drag.current = null;
        if (token) onTrimEnd?.(token, false);
        onDragActive(false);
      }}
    />
  );
}
