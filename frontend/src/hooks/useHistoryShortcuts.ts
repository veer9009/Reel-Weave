import type { HistoryControls } from '../lib/editHistory';
import { useEffect } from 'react';
export function useHistoryShortcuts(controls: HistoryControls): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !controls.shortcutsAllowed ||
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]',
          ))
      )
        return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) controls.redo();
      else controls.undo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [controls]);
}
