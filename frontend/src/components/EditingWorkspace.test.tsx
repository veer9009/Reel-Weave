import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { buildTimeline } from '../lib/timeline';
import { clip, overlays } from '../test/fixtures';
import { EditingWorkspace } from './EditingWorkspace';

const splitHelper =
  'Select a Video 1 clip, then click inside it to choose the cut point.';
function splitWorkspaceProps(clips = [clip('a'), clip('b')]) {
  return {
    clips,
    timeline: buildTimeline(clips, '30'),
    overlays: { image: null, video: null },
    backgroundAudio: null,
    audioSettings: {
      originalVolume: 1,
      originalMuted: false,
      musicVolume: 0.3,
      musicMuted: false,
    },
    fpsSelection: '30' as const,
    structuralRevision: 0,
    editingLocked: false,
    onFpsSelectionChange: vi.fn(),
    onSplitAtPlayhead: vi.fn(),
    mediaContent: null,
    clipContent: null,
    overlayContent: null,
    audioContent: null,
    deliveryContent: null,
    resultContent: null,
  };
}

it.each(['Delete', 'Backspace'])(
  'Ripple Delete shortcut %s invokes deletion only for a selected real Video 1 clip',
  (key) => {
    const props = { ...splitWorkspaceProps(), onDeleteClip: vi.fn() };
    const view = render(<EditingWorkspace {...props} />);
    fireEvent.keyDown(document, { key });
    expect(props.onDeleteClip).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Original audio: a.mp4' }),
    );
    fireEvent.keyDown(document, { key });
    expect(props.onDeleteClip).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview clip 2: b.mp4' }),
    );
    view.rerender(<EditingWorkspace {...props} editingLocked />);
    fireEvent.keyDown(document, { key });
    expect(props.onDeleteClip).not.toHaveBeenCalled();
    view.rerender(<EditingWorkspace {...props} />);
    const accepted = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(accepted);
    expect(props.onDeleteClip).toHaveBeenCalledExactlyOnceWith('b');
    expect(accepted.defaultPrevented).toBe(true);
  },
);

it.each(['input', 'textarea', 'select'] as const)(
  'Ripple Delete ignores Delete and Backspace while typing in %s',
  (tag) => {
    const props = { ...splitWorkspaceProps(), onDeleteClip: vi.fn() };
    const field =
      tag === 'input' ? (
        <input aria-label="Typing field" />
      ) : tag === 'textarea' ? (
        <textarea aria-label="Typing field" />
      ) : (
        <select aria-label="Typing field">
          <option>Choice</option>
        </select>
      );
    render(<EditingWorkspace {...props} mediaContent={field} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
    );
    const control = screen.getByLabelText('Typing field');
    control.focus();
    for (const key of ['Delete', 'Backspace']) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(props.onDeleteClip).not.toHaveBeenCalled();
    }
    const clipButton = screen.getByRole('button', {
      name: 'Preview clip 1: a.mp4',
    });
    clipButton.focus();
    fireEvent.keyDown(clipButton, { key: 'Delete' });
    expect(props.onDeleteClip).toHaveBeenCalledExactlyOnceWith('a');
  },
);

it('Split toolbar always renders one labelled button directly above Video 1 even with the inspector closed', () => {
  const props = splitWorkspaceProps([]);
  const view = render(<EditingWorkspace {...props} />);
  const assertVisibleToolbar = () => {
    for (const details of document.querySelectorAll('details'))
      details.open = false;
    const toolbar = screen.getByRole('toolbar', {
      name: 'Video 1 editing controls',
    });
    const button = within(toolbar).getByRole('button', {
      name: 'Split at playhead',
    });
    expect(button).toBeVisible();
    expect(button).toHaveTextContent('Split at playhead');
    expect(toolbar.nextElementSibling).toBe(
      screen.getByRole('region', { name: 'VIDEO 1' }),
    );
    expect(
      screen.getAllByRole('button', {
        name: 'Split at playhead',
        hidden: true,
      }),
    ).toHaveLength(1);
  };
  assertVisibleToolbar();
  view.rerender(<EditingWorkspace {...splitWorkspaceProps()} />);
  assertVisibleToolbar();
  view.rerender(<EditingWorkspace {...splitWorkspaceProps()} editingLocked />);
  assertVisibleToolbar();
});

it('Split toolbar disables invalid cuts and exposes the nearby helper without invoking split', () => {
  const props = splitWorkspaceProps();
  const view = render(<EditingWorkspace {...props} />);
  const toolbar = screen.getByRole('toolbar', {
    name: 'Video 1 editing controls',
  });
  const button = within(toolbar).getByRole('button', {
    name: 'Split at playhead',
  });
  const assertDisabled = () => {
    expect(button).toBeDisabled();
    expect(within(toolbar).getByText(splitHelper)).toBeVisible();
    expect(button).toHaveAccessibleDescription(splitHelper);
    fireEvent.click(button);
    expect(props.onSplitAtPlayhead).not.toHaveBeenCalled();
  };
  assertDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
  );
  for (const frame of [0, 59, 70]) {
    fireEvent.change(screen.getByLabelText('Timeline position'), {
      target: { value: String(frame) },
    });
    assertDisabled();
  }
  fireEvent.click(
    screen.getByRole('button', { name: 'Original audio: a.mp4' }),
  );
  assertDisabled();
  const tiny = { ...clip('a', 30, 0.5), trim: { startFrame: 7, endFrame: 7 } };
  view.rerender(
    <EditingWorkspace
      {...props}
      clips={[tiny, clip('b')]}
      timeline={buildTimeline([tiny, clip('b')], '30')}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview clip 1: a.mp4' }),
  );
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '1' },
  });
  assertDisabled();
});

it('Split toolbar enables a valid selected-clip playhead and invokes the existing action by keyboard', async () => {
  const props = splitWorkspaceProps();
  render(<EditingWorkspace {...props} />);
  const toolbar = screen.getByRole('toolbar', {
    name: 'Video 1 editing controls',
  });
  const button = within(toolbar).getByRole('button', {
    name: 'Split at playhead',
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview clip 2: b.mp4' }),
  );
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '80' },
  });
  expect(button).toBeEnabled();
  expect(within(toolbar).queryByText(splitHelper)).not.toBeInTheDocument();
  button.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(props.onSplitAtPlayhead).toHaveBeenCalledExactlyOnceWith('b', 80);
});
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
