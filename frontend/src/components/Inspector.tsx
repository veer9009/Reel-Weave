import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { TimelineSelection } from '../lib/timeline';
type Props = {
  selection: TimelineSelection;
  clipContent: ReactNode;
  overlayContent: ReactNode;
  audioContent: ReactNode;
  deliveryContent: ReactNode;
};
export function Inspector({
  selection,
  clipContent,
  overlayContent,
  audioContent,
  deliveryContent,
}: Props) {
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const section =
      selection.kind === 'clip'
        ? 'clip'
        : selection.kind === 'overlay'
          ? 'overlay'
          : selection.kind === 'audio'
            ? 'audio'
            : null;
    const details = section
      ? container.current?.querySelector<HTMLDetailsElement>(
          `[data-section="${section}"]`,
        )
      : null;
    if (details) {
      details.open = true;
      details.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    }
  }, [selection]);
  return (
    <aside className="inspector" aria-label="Inspector" ref={container}>
      {[
        ['clip', 'Clip', clipContent],
        ['overlay', 'Video 2 overlays', overlayContent],
        ['audio', 'Audio', audioContent],
        ['delivery', 'Delivery', deliveryContent],
      ].map(([id, label, content]) => (
        <details key={id as string} data-section={id} open>
          <summary>{label}</summary>
          <div className="inspector-content">{content}</div>
        </details>
      ))}
    </aside>
  );
}
