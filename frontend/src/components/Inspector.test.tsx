import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Inspector } from './Inspector';
import { useState } from 'react';
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
  expect(
    screen.getByText('Video 2 overlays').closest('details'),
  ).toHaveAttribute('open');
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
  const details = screen.getByText('Video 2 overlays').closest('details')!;
  details.open = false;
  const source = screen.getByLabelText('PIP metadata source');
  Object.defineProperty(source, 'duration', { value: 0.4 });
  fireEvent.loadedMetadata(source);
  expect(screen.getByText('Ready: 0.4')).toBeInTheDocument();
  expect(source).toBeInTheDocument();
  expect(details.open).toBe(false);
});
