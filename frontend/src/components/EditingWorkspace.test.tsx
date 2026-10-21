import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { buildTimeline } from '../lib/timeline';
import { clip, overlays } from '../test/fixtures';
import { EditingWorkspace } from './EditingWorkspace';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from '../lib/advancedTimeline';
import { detachAudio } from '../lib/audioTimeline';
import type { IndependentAudioActions } from './IndependentAudioTrack';

it('keeps a visible Split Audio control with a contextual disabled reason', () => {
  render(<EditingWorkspace {...splitWorkspaceProps()} />);
  const tools = screen.getByRole('toolbar', { name: 'Timeline Tools' });
  const split = within(tools).getByRole('button', { name: 'Split Audio' });
  expect(split).toBeVisible();
  expect(split).toHaveTextContent('Split Audio');
  expect(split).toBeDisabled();
  expect(split).toHaveAccessibleDescription(/select.*audio/i);
});

it('splits selected editable audio only at an interior playhead and never invokes picture split', () => {
  const f = advancedFixture();
  const source = f.sources.register(new File(['pcm'], 'voice.wav'), 'audio');
  f.sources.markReady(source, { duration: 10, sampleCount: 480000 });
  const snapshot = {
    ...f.snapshot,
    independentAudio: [
      {
        id: 'voice',
        timelineStartFrame: 0,
        durationFrames: 40,
        sourceStartSample: 4800,
        source: { kind: 'audio-file' as const, sourceId: source.sourceId },
      },
    ],
  };
  const projection = buildAdvancedTimeline(snapshot, f.sources, {
    image: null,
    video: null,
  });
  const splitAudio = vi.fn(() => ({
    value: { leftId: 'left', rightId: 'right' },
  }));
  const props = splitWorkspaceProps(projection.base.items.map((v) => v.clip));
  const actions = {
    snapshot,
    sources: f.sources,
    onSplit: splitAudio,
    onDetach: () => false,
    onEdit: () => false,
    onSave: () => false,
    onReplaceFile() {},
    onBegin: () => null,
    onPreview: () => false,
    onEnd() {},
    onError() {},
  };
  render(
    <EditingWorkspace
      {...props}
      timeline={projection.base}
      advanced={projection}
      audioActions={actions}
    />,
  );
  const split = screen.getByRole('button', { name: 'Split Audio' });
  fireEvent.click(
    screen.getByRole('button', {
      name: /Original\/Replacement Audio voice.wav:/,
    }),
  );
  expect(split).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '20' },
  });
  expect(split).toBeEnabled();
  fireEvent.click(split);
  expect(splitAudio).toHaveBeenCalledExactlyOnceWith(
    { kind: 'independent', id: 'voice' },
    20,
  );
  expect(props.onSplitAtPlayhead).not.toHaveBeenCalled();
});

it(
  'visible Detach Audio tool requires a ready linked Video 1 selection and invokes the existing action',
  { timeout: 15000 },
  () => {
    const f = advancedFixture();
    const projection = buildAdvancedTimeline(f.snapshot, f.sources, {
      image: null,
      video: null,
    });
    const detach = vi.fn(() => true);
    const audioActions: IndependentAudioActions = {
      snapshot: f.snapshot,
      sources: f.sources,
      onDetach: detach,
      onEdit: () => false,
      onSave: () => false,
      onReplaceFile: () => {},
      onBegin: () => null,
      onPreview: () => false,
      onEnd: () => {},
      onError: () => {},
    };
    const props = {
      ...splitWorkspaceProps(projection.base.items.map((v) => v.clip)),
      timeline: projection.base,
      advanced: projection,
      audioActions,
    };
    const view = render(<EditingWorkspace {...props} />);
    const button = within(
      screen.getByRole('toolbar', { name: 'Timeline Tools' }),
    ).getByRole('button', { name: 'Detach Audio' });
    expect(button).toBeVisible();
    expect(button).toHaveTextContent('Detach Audio');
    expect(button.querySelector('.sr-only')).toBeNull();
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      /Select a ready Video 1 clip with linked original audio/,
    );
    fireEvent.click(button);
    expect(detach).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: /Select Video 2 take.mp4/ }),
    );
    expect(button).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview clip 1: base.mp4' }),
    );
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(detach).toHaveBeenCalledExactlyOnceWith({
      track: 'video1',
      id: 'base',
    });
    for (const locked of [
      { editingLocked: true },
      { gestureActive: true },
      {
        historyControls: {
          canUndo: false,
          canRedo: false,
          shortcutsAllowed: false,
          undo: () => false,
          redo: () => false,
        },
      },
      {
        clips: props.clips.map((v) => ({
          ...v,
          metadataStatus: 'loading' as const,
        })),
      },
    ]) {
      view.rerender(<EditingWorkspace {...props} {...locked} />);
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(detach).toHaveBeenCalledTimes(1);
    }
    let serial = 0;
    const detached = detachAudio(
      f.snapshot,
      f.sources,
      projection,
      { track: 'video1', id: 'base' },
      () => `detached-${++serial}`,
    );
    if ('error' in detached) throw new Error(detached.error.message);
    const after = buildAdvancedTimeline(detached.value, f.sources, {
      image: null,
      video: null,
    });
    view.rerender(
      <EditingWorkspace
        {...props}
        clips={after.base.items.map((v) => v.clip)}
        timeline={after.base}
        advanced={after}
        audioActions={{ ...audioActions, snapshot: detached.value }}
      />,
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/already has detached audio/);
  },
);

it('audio_keyboard_lift_stays_distinct_from_explicit_ripple', () => {
  const f = advancedFixture();
  const initial = buildAdvancedTimeline(f.snapshot, f.sources, {
    image: null,
    video: null,
  });
  let serial = 0;
  const detached = detachAudio(
    f.snapshot,
    f.sources,
    initial,
    { track: 'video1', id: 'base' },
    () => `ui-audio-${++serial}`,
  );
  if ('error' in detached) throw new Error(detached.error.message);
  const projection = buildAdvancedTimeline(detached.value, f.sources, {
    image: null,
    video: null,
  });
  const edit = vi.fn(() => true);
  const actions: IndependentAudioActions = {
    snapshot: detached.value,
    sources: f.sources,
    onEdit: edit,
    onSave: () => false,
    onDetach: () => false,
    onReplaceFile: () => {},
    onBegin: () => null,
    onPreview: () => false,
    onEnd: () => {},
    onError: () => {},
  };
  render(
    <EditingWorkspace
      {...splitWorkspaceProps(projection.base.items.map((v) => v.clip))}
      timeline={projection.base}
      advanced={projection}
      audioActions={actions}
    />,
  );
  fireEvent.click(
    screen.getAllByRole('button', {
      name: /Original\/Replacement Audio.*base.mp4.*Detached/,
    })[0],
  );
  for (const key of ['Delete', 'Backspace']) {
    fireEvent.keyDown(document, { key });
    expect(edit).toHaveBeenLastCalledWith({ action: 'lift', id: 'ui-audio-1' });
  }
  const tools = screen.getByRole('toolbar', { name: 'Timeline Tools' });
  fireEvent.click(
    within(tools).getByRole('button', { name: 'Ripple Delete selected' }),
  );
  expect(edit).toHaveBeenLastCalledWith({
    action: 'ripple-delete',
    id: 'ui-audio-1',
  });
});

it('detach_shortcut_guards_typing_repeat_IME_modal_and_locks_and_context_menu_restores_focus', () => {
  const f = advancedFixture(),
    projection = buildAdvancedTimeline(f.snapshot, f.sources, {
      image: null,
      video: null,
    }),
    detach = vi.fn(() => true);
  const audioActions: IndependentAudioActions = {
    snapshot: f.snapshot,
    sources: f.sources,
    onEdit: () => false,
    onSave: () => false,
    onDetach: detach,
    onReplaceFile: () => {},
    onBegin: () => null,
    onPreview: () => false,
    onEnd: () => {},
    onError: () => {},
  };
  const props = {
    ...splitWorkspaceProps(projection.base.items.map((v) => v.clip)),
    timeline: projection.base,
    advanced: projection,
    audioActions,
  };
  const view = render(<EditingWorkspace {...props} />);
  const selected = screen.getByRole('button', {
    name: 'Preview clip 1: base.mp4',
  });
  fireEvent.click(selected);
  for (const modifiers of [
    { repeat: true },
    { isComposing: true },
    { shiftKey: true },
    { metaKey: true },
  ]) {
    const event = new KeyboardEvent('keydown', {
      key: 'l',
      ctrlKey: true,
      altKey: true,
      cancelable: true,
      bubbles: true,
      ...modifiers,
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  const field = document.createElement('input');
  document.body.append(field);
  const typing = new KeyboardEvent('keydown', {
    key: 'l',
    ctrlKey: true,
    altKey: true,
    cancelable: true,
    bubbles: true,
  });
  field.dispatchEvent(typing);
  expect(typing.defaultPrevented).toBe(false);
  field.remove();
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  document.body.append(modal);
  fireEvent.keyDown(document, { key: 'l', ctrlKey: true, altKey: true });
  modal.remove();
  view.rerender(<EditingWorkspace {...props} editingLocked />);
  fireEvent.keyDown(document, { key: 'l', ctrlKey: true, altKey: true });
  expect(detach).not.toHaveBeenCalled();
  view.rerender(<EditingWorkspace {...props} />);
  fireEvent.keyDown(selected, { key: 'F10', shiftKey: true });
  expect(
    screen.getByRole('menu', { name: 'Video clip actions' }),
  ).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(selected);
  fireEvent.keyDown(document, { key: 'l', ctrlKey: true, altKey: true });
  expect(detach).toHaveBeenCalledExactlyOnceWith({
    track: 'video1',
    id: 'base',
  });
});

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

it('Timeline Tools keeps all five actions outside uninterrupted tracks even with the inspector closed', () => {
  const props = splitWorkspaceProps([]);
  const view = render(<EditingWorkspace {...props} />);
  const assertVisibleToolbar = () => {
    for (const details of document.querySelectorAll('details'))
      details.open = false;
    const toolbar = screen.getByRole('toolbar', {
      name: 'Timeline Tools',
    });
    const button = within(toolbar).getByRole('button', {
      name: 'Split Video',
    });
    expect(button).toBeVisible();
    expect(button).toHaveTextContent('Split Video');
    expect(toolbar).toHaveAttribute('aria-orientation', 'vertical');
    expect(toolbar.closest('.timeline-tracks')).toBeNull();
    expect(toolbar.closest('.timeline-scroll')).toBeNull();
    expect(within(toolbar).getAllByRole('button')).toHaveLength(6);
    for (const name of [
      'Undo',
      'Redo',
      'Split Video',
      'Split Audio',
      'Ripple Delete selected',
      'Detach Audio',
    ]) {
      const tool = within(toolbar).getByRole('button', { name });
      expect(tool).toHaveAttribute('title');
      expect(tool.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    const tracks = screen.getByRole('region', {
      name: 'VIDEO 1',
    }).parentElement!;
    expect(
      Array.from(tracks.children)
        .filter((node) => node.tagName === 'SECTION')
        .map((node) => node.getAttribute('aria-label')),
    ).toEqual(['Overlay/PIP', 'VIDEO 2', 'VIDEO 1', 'AUDIO 1', 'AUDIO 2']);
    expect(tracks.querySelector('[role="toolbar"]')).toBeNull();
    expect(
      screen.getAllByRole('button', {
        name: 'Split Video',
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
    name: 'Timeline Tools',
  });
  const button = within(toolbar).getByRole('button', {
    name: 'Split Video',
  });
  const assertDisabled = () => {
    expect(button).toBeDisabled();
    expect(screen.getByText(splitHelper)).toBeVisible();
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
    name: 'Timeline Tools',
  });
  const button = within(toolbar).getByRole('button', {
    name: 'Split Video',
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview clip 2: b.mp4' }),
  );
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '80' },
  });
  expect(button).toBeEnabled();
  expect(screen.queryByText(splitHelper)).not.toBeInTheDocument();
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
