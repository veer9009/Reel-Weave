import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ClipEdit } from '../lib/clips';
import { clip } from '../test/fixtures';
import { TimelineTrimHandle } from './TimelineTrimHandle';
it.each(['up', 'cancel', 'lost'] as const)(
  'trim_gesture_history previews and finishes once on %s',
  (ending) => {
    const callbacks = {
      onTrimBegin: vi.fn(() => 'gesture'),
      onTrimPreview: vi.fn(),
      onTrimEnd: vi.fn(),
      onDragActive: vi.fn(),
      onTrim: vi.fn(),
    };
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 600,
    } as DOMRect);
    render(
      <div>
        <div>
          <TimelineTrimHandle
            clip={clip() as ClipEdit}
            edge="startFrame"
            fps={30}
            totalFrames={60}
            disabled={false}
            {...callbacks}
          />
        </div>
      </div>,
    );
    const handle = screen.getByRole('button');
    fireEvent.pointerUp(handle);
    fireEvent.pointerDown(handle, { button: 0, clientX: 0 });
    for (let x = 10; x <= 50; x += 10)
      fireEvent.pointerMove(handle, { clientX: x });
    expect(callbacks.onTrimBegin).toHaveBeenCalledOnce();
    expect(callbacks.onTrimEnd).not.toHaveBeenCalled();
    expect(callbacks.onTrimPreview).toHaveBeenLastCalledWith('gesture', 'a', {
      startFrame: 5,
      endFrame: 59,
    });
    if (ending === 'up') fireEvent.pointerUp(handle);
    else if (ending === 'cancel') fireEvent.pointerCancel(handle);
    else fireEvent.lostPointerCapture(handle);
    fireEvent.lostPointerCapture(handle);
    fireEvent.pointerUp(handle);
    expect(callbacks.onTrimEnd).toHaveBeenCalledExactlyOnceWith(
      'gesture',
      ending === 'up',
    );
    expect(callbacks.onTrim).not.toHaveBeenCalled();
  },
);
