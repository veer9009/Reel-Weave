import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Inspector } from './Inspector';
import { useState } from 'react';
it('all_inspector_sections_remain_reachable_without_selection', () => {
  render(
    <Inspector
      selection={{ kind: 'none' }}
      clipContent={<input aria-label="Source frame" />}
      replacementContent={<p>Replacement controls</p>}
      overlayContent={<p>Overlay controls</p>}
      audioContent={<p>Audio controls</p>}
      deliveryContent={<button>Render MP4</button>}
    />,
  );
  for (const label of [
    'Clip',
    'Video 2 — Replacement',
    'Overlay/PIP',
    'Audio',
    'Delivery',
  ]) {
    const summary = screen.getByText(label);
    expect(summary).toBeVisible();
    if (label !== 'Clip') {
      expect(summary.closest('details')).not.toHaveAttribute('open');
      fireEvent.click(summary);
      // jsdom does not implement the native summary toggle.
      summary.closest('details')!.open = true;
    }
  }
  expect(screen.getByLabelText('Source frame')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Render MP4' })).toBeVisible();
});
it('selection_reveals_section_and_collapsing_preserves_inputs', () => {
  const props = {
    selection: { kind: 'none' } as const,
    clipContent: <p>Clip details</p>,
    overlayContent: <input aria-label="draft" defaultValue="saved" />,
    audioContent: <p>Audio settings</p>,
    deliveryContent: <p>Delivery</p>,
  };
  const { rerender } = render(<Inspector {...props} />);
  const draft = screen.getByLabelText('draft');
  fireEvent.change(draft, { target: { value: 'unsaved' } });
  rerender(
    <Inspector
      {...props}
      selection={{ kind: 'overlay', overlayKind: 'image' }}
    />,
  );
  expect(screen.getByText('Overlay/PIP').closest('details')).toHaveAttribute(
    'open',
  );
  expect(screen.getByLabelText('draft')).toBe(draft);
  expect(draft).toHaveValue('unsaved');
});
it('collapsed_metadata_observer_remains_mounted_and_completes', () => {
  function Harness() {
    const [duration, setDuration] = useState<number | null>(null);
    return (
      <Inspector
        selection={{ kind: 'none' }}
        clipContent={null}
        audioContent={null}
        deliveryContent={null}
        overlayContent={
          <>
            <video
              aria-label="PIP metadata source"
              onLoadedMetadata={(event) =>
                setDuration(event.currentTarget.duration)
              }
            />
            <p>{duration === null ? 'Reading media' : 'Ready: ' + duration}</p>
          </>
        }
      />
    );
  }
  render(<Harness />);
  const details = screen.getByText('Overlay/PIP').closest('details')!;
  details.open = false;
  const source = screen.getByLabelText('PIP metadata source');
  Object.defineProperty(source, 'duration', { value: 0.4 });
  fireEvent.loadedMetadata(source);
  expect(screen.getByText('Ready: 0.4')).toBeInTheDocument();
  expect(source).toBeInTheDocument();
  expect(details.open).toBe(false);
});
