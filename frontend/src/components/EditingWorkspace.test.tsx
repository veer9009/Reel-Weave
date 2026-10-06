import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { buildTimeline } from '../lib/timeline';
import { clip, overlays } from '../test/fixtures';
import { EditingWorkspace } from './EditingWorkspace';
it('selection_distinct_from_playhead_and_removal_reconciles_selection', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const clips = [clip('a'), clip('b')];
  const props = {
    clips,
    timeline: buildTimeline(clips, '25'),
    overlays,
    backgroundAudio: null,
    audioSettings: {
      originalVolume: 1,
      originalMuted: false,
      musicVolume: 0.3,
      musicMuted: false,
    },
    fpsSelection: '25' as const,
    structuralRevision: 0,
    editingLocked: false,
    onFpsSelectionChange: vi.fn(),
    mediaContent: <p>Uploads</p>,
    clipContent: <p>Clip controls</p>,
    overlayContent: <p>Overlay controls</p>,
    audioContent: <p>Audio controls</p>,
    deliveryContent: <button>Render MP4</button>,
    resultContent: null,
  };
  const { rerender } = render(<EditingWorkspace {...props} />);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Inspect clip'), {
    target: { value: 'b' },
  });
  expect(screen.getByText('Selected: b.mp4')).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
  );
  expect(screen.getByText('Selected: a.mp4')).toBeVisible();
  expect(screen.getByText(/Source: 1280 × 720/)).toBeVisible();
  expect(screen.getByText(/30 FPS.*browser estimate/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '70' },
  });
  expect(screen.getByText('Selected: a.mp4')).toBeVisible();
  rerender(
    <EditingWorkspace
      {...props}
      clips={[clips[1]]}
      timeline={buildTimeline([clips[1]], '25')}
      structuralRevision={1}
    />,
  );
  expect(screen.queryByText('Selected: a.mp4')).toBeNull();
});
