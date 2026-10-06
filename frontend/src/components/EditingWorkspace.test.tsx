import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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
it('keeps the replacement playhead anchor when consuming the first source changes Auto FPS', () => {
  const donor = clip('donor', 30);
  const prefix = {
    ...clip('prefix', 60),
    metadata: {
      ...clip('prefix', 60).metadata!,
      totalFrames: 3600,
      duration: 60,
    },
    trim: { startFrame: 0, endFrame: 3599 },
  };
  const target = {
    ...clip('target', 60),
    metadata: {
      ...clip('target', 60).metadata!,
      totalFrames: 120,
      duration: 2,
    },
    trim: { startFrame: 0, endFrame: 119 },
  };
  function Harness() {
    const [clips, setClips] = useState([donor, prefix, target]);
    return (
      <EditingWorkspace
        clips={clips}
        timeline={buildTimeline(clips, 'auto')}
        overlays={{ image: null, video: null }}
        backgroundAudio={null}
        audioSettings={{
          originalVolume: 1,
          originalMuted: false,
          musicVolume: 0.3,
          musicMuted: false,
        }}
        fpsSelection="auto"
        structuralRevision={clips.length}
        editingLocked={false}
        onFpsSelectionChange={vi.fn()}
        mediaContent={null}
        clipContent={null}
        overlayContent={null}
        audioContent={null}
        deliveryContent={null}
        resultContent={null}
        onReplaceAfterPlayhead={() => {
          setClips([
            prefix,
            { ...target, trim: { startFrame: 0, endFrame: 60 } },
            { ...donor, id: 'right', trim: { startFrame: 31, endFrame: 59 } },
          ]);
          return 3660;
        }}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview clip 3: target.mp4' }),
  );
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '1890' },
  });
  fireEvent.change(screen.getByLabelText('Version 2 source'), {
    target: { value: 'donor' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Replace after playhead' }),
  );
  expect(screen.getByLabelText('Effective timeline FPS')).toHaveTextContent(
    '60 FPS',
  );
  expect(screen.getByLabelText('Timeline position')).toHaveValue('3660');
  expect(screen.getByLabelText('Inspect clip')).toHaveValue('target');
});
