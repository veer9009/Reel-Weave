import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ProgramMonitor } from './ProgramMonitor';
import { useProjectPlayback } from '../hooks/useProjectPlayback';
import { buildTimeline } from '../lib/timeline';
import { clip } from '../test/fixtures';

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
