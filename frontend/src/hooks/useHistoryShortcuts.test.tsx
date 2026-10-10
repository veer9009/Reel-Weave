import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useHistoryShortcuts } from './useHistoryShortcuts';
const controls = () => ({
  canUndo: false,
  canRedo: false,
  shortcutsAllowed: true,
  undo: vi.fn(() => false),
  redo: vi.fn(() => false),
});
it.each([
  ['z', false, 'undo'],
  ['Z', false, 'undo'],
  ['y', false, 'redo'],
  ['Y', false, 'redo'],
  ['z', true, 'redo'],
  ['Z', true, 'redo'],
] as const)('history_shortcuts Ctrl+%s shift %s', (key, shiftKey, action) => {
  const c = controls();
  renderHook(() => useHistoryShortcuts(c));
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => document.dispatchEvent(event));
  expect(c[action]).toHaveBeenCalledOnce();
  expect(c[action === 'undo' ? 'redo' : 'undo']).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(true);
});
it.each(['input', 'textarea', 'select', 'editable', 'textbox', 'dialog'])(
  'history_shortcuts protects %s and descendants',
  (kind) => {
    const c = controls();
    renderHook(() => useHistoryShortcuts(c));
    const parent = document.createElement(
      ['input', 'textarea', 'select'].includes(kind) ? kind : 'div',
    );
    if (kind === 'editable') parent.setAttribute('contenteditable', 'true');
    if (kind === 'textbox' || kind === 'dialog')
      parent.setAttribute('role', kind);
    const target = ['editable', 'textbox', 'dialog'].includes(kind)
      ? parent.appendChild(document.createElement('span'))
      : parent;
    document.body.appendChild(parent);
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => target.dispatchEvent(event));
    expect(c.undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    parent.remove();
  },
);
it.each([
  { altKey: true },
  { repeat: true },
  { isComposing: true },
  { ctrlKey: false, metaKey: true },
])('history_shortcuts ignores excluded event %j', (modifiers) => {
  const c = controls();
  renderHook(() => useHistoryShortcuts(c));
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: true,
    ...modifiers,
    cancelable: true,
  });
  act(() => document.dispatchEvent(event));
  expect(c.undo).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});
it('history_shortcuts respects latest lock and handled events; cleans up', () => {
  const c = controls(),
    h = renderHook((props) => useHistoryShortcuts(props), { initialProps: c });
  h.rerender({ ...c, shortcutsAllowed: false });
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: true,
    cancelable: true,
  });
  act(() => document.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  h.rerender(c);
  const handled = new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: true,
    cancelable: true,
  });
  handled.preventDefault();
  act(() => document.dispatchEvent(handled));
  expect(c.undo).not.toHaveBeenCalled();
  h.unmount();
  act(() => document.dispatchEvent(event));
  expect(c.undo).not.toHaveBeenCalled();
});
