import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProgramMonitor } from './ProgramMonitor';
import { useProjectPlayback } from '../hooks/useProjectPlayback';
import { buildTimeline } from '../lib/timeline';
import { clip } from '../test/fixtures';

it('keeps preview feedback and native picture mounted through audio recovery states', () => {
  const props = {
    timeline: buildTimeline([clip()], '25'),
    overlays: { image: null, video: null },
    frame: 0,
    playing: false,
    onSeek() {},
    onToggle: vi.fn(),
    audioPreview: {
      status: 'ready',
      message: null as string | null,
      resumeAudio: async () => true,
    },
  };
  const view = render(<ProgramMonitor {...props} />);
  const region = screen.getByRole('status', { name: 'Preview feedback' });
  const picture = screen.getByLabelText('Uploaded clip preview');
  for (const status of [
    'preparing',
    'resume-required',
    'unsupported',
    'failed',
    'ready',
  ]) {
    view.rerender(
      <ProgramMonitor
        {...props}
        audioPreview={{
          ...props.audioPreview,
          status,
          message:
            status === 'ready'
              ? null
              : 'Sound preview needs attention. '.repeat(12),
        }}
      />,
    );
    expect(screen.getByRole('status', { name: 'Preview feedback' })).toBe(
      region,
    );
    expect(screen.getByLabelText('Uploaded clip preview')).toBe(picture);
    if (['resume-required', 'unsupported', 'failed'].includes(status)) {
      fireEvent.click(screen.getByRole('button', { name: 'Resume Audio' }));
      expect(props.onToggle).toHaveBeenCalled();
    }
  }
});

it('keeps the same status region through preparing, playing, and paused', () => {
  const timeline = buildTimeline([clip()], '25');
  function Harness() {
    const playback = useProjectPlayback(timeline, 0);
    return (
      <>
        <button
          onClick={() => {
            playback.toggle();
            playback.suspend(901);
          }}
        >
          Prepare
        </button>
        <button onClick={() => playback.ready(901)}>Ready</button>
        <button onClick={playback.pause}>Pause</button>
        <output aria-label="Playback state">{playback.status}</output>
        <ProgramMonitor
          timeline={timeline}
          overlays={{ image: null, video: null }}
          frame={playback.frame}
          playing={playback.playing}
          transport={playback}
          onSeek={playback.seek}
          onToggle={playback.toggle}
        />
      </>
    );
  }
  render(<Harness />);
  const status = document.querySelector('.program-monitor > p[role="status"]');
  expect(status).toBeInTheDocument();
  expect(status).toBeEmptyDOMElement();
  const video = screen.getByLabelText('Uploaded clip preview');
  Object.defineProperties(video, {
    duration: { configurable: true, value: 6 },
    readyState: { configurable: true, value: 4 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.click(screen.getByText('Prepare', { selector: 'button' }));
  expect(screen.getByLabelText('Playback state')).toHaveTextContent(
    'preparing',
  );
  expect(document.querySelector('.program-monitor > p[role="status"]')).toBe(
    status,
  );
  expect(status).toHaveTextContent('Preparing Preview');
  fireEvent.click(screen.getByText('Ready', { selector: 'button' }));
  expect(screen.getByLabelText('Playback state')).toHaveTextContent('playing');
  expect(document.querySelector('.program-monitor > p[role="status"]')).toBe(
    status,
  );
  expect(status).toBeEmptyDOMElement();
  fireEvent.click(screen.getByText('Pause', { selector: 'button' }));
  expect(screen.getByLabelText('Playback state')).toHaveTextContent('paused');
  expect(document.querySelector('.program-monitor > p[role="status"]')).toBe(
    status,
  );
  expect(status).toBeEmptyDOMElement();
});
