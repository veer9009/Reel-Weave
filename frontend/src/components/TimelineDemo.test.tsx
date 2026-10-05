import { useState } from 'react';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TimelineDemo } from './TimelineDemo';
import type { OverlayState } from '../lib/overlays';

afterEach(() => vi.useRealTimers());

const defaultProps = {
  fpsSelection: 'auto' as const,
  onFpsSelectionChange: vi.fn(),
  canMerge: false,
  busy: false,
  onMerge: vi.fn(),
  overlays: { image: null, video: null } as OverlayState,
};

function TimelineHarness({
  clips,
}: {
  clips: ComponentProps<typeof TimelineDemo>['clips'];
}) {
  const [fpsSelection, setFpsSelection] = useState<
    'auto' | '24' | '25' | '30' | '50' | '60'
  >('auto');
  return (
    <TimelineDemo
      {...defaultProps}
      clips={clips}
      fpsSelection={fpsSelection}
      onFpsSelectionChange={setFpsSelection}
    />
  );
}

it('defaults sample timelines to Auto at 30 FPS and recalculates continuous ranges for every FPS option', () => {
  render(<TimelineHarness clips={[]} />);
  const selector = screen.getByLabelText('Timeline FPS');
  expect(selector).toHaveValue('auto');
  expect(
    within(selector)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([
    'Auto (first uploaded clip)',
    '24 FPS',
    '25 FPS',
    '30 FPS',
    '50 FPS',
    '60 FPS',
  ]);
  expect(screen.getByLabelText('Timeline frame')).toHaveTextContent(
    'Frame 0 / 1439',
  );
  for (const [fps, firstEnd, secondStart, final] of [
    [24, 95, 96, 1151],
    [25, 99, 100, 1199],
    [30, 119, 120, 1439],
    [50, 199, 200, 2399],
    [60, 239, 240, 2879],
  ]) {
    fireEvent.change(selector, { target: { value: String(fps) } });
    expect(
      screen.getByRole('button', { name: /^Preview clip 1:/ }),
    ).toHaveTextContent(`Frames 0–${firstEnd}`);
    fireEvent.click(screen.getByRole('button', { name: /^Preview clip 2:/ }));
    expect(screen.getByLabelText('Timeline frame')).toHaveTextContent(
      `Frame ${secondStart} / ${final}`,
    );
    fireEvent.change(screen.getByLabelText('Timeline position'), {
      target: { value: '48' },
    });
    expect(screen.getByLabelText('Timeline frame')).toHaveTextContent(
      `Frame ${final} / ${final}`,
    );
  }
}, 15_000);

it('uses the first original source FPS in Auto and keeps source details independent of timeline FPS', () => {
  const clips = [29.97, 60].map((fps, index) => ({
    id: String(index),
    file: new File(['video'], `Source${index}.mp4`),
    url: `blob:${index}`,
    metadata: {
      width: 1280,
      height: 720,
      fps,
      duration: 4,
      totalFrames: Math.round(fps * 4),
      source: 'backend' as const,
    },
  }));
  render(<TimelineHarness clips={clips} />);
  expect(screen.getByLabelText('Effective timeline FPS')).toHaveTextContent(
    '30 FPS',
  );
  const finalClip = screen.getByRole('button', { name: /^Preview clip 12:/ });
  fireEvent.click(finalClip);
  expect(finalClip).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Timeline frame')).toHaveTextContent(
    'Frame 1320 / 1439',
  );
  fireEvent.click(screen.getByRole('button', { name: /^Preview clip 2:/ }));
  expect(screen.getByLabelText('Effective timeline FPS')).toHaveTextContent(
    '30 FPS',
  );
  expect(screen.getByLabelText('Timeline frame')).toHaveTextContent(
    'Frame 120 / 1439',
  );
  expect(screen.getByText('60 fps')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Timeline FPS'), {
    target: { value: '24' },
  });
  expect(screen.getByText('60 fps')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Timeline FPS'), {
    target: { value: 'auto' },
  });
  expect(screen.getByLabelText('Effective timeline FPS')).toHaveTextContent(
    '30 FPS',
  );
});

it('calculates adjacent frame ranges from trimmed and slowed clip durations', () => {
  const clips = [
    {
      id: 'a',
      file: new File(['a'], 'A.mp4'),
      url: 'blob:a',
      metadata: {
        width: 1280,
        height: 720,
        fps: 24,
        duration: 8,
        totalFrames: 192,
        source: 'backend' as const,
      },
      trim: { startFrame: 48, endFrame: 95 },
      speed: 0.5 as const,
    },
    {
      id: 'b',
      file: new File(['b'], 'B.mp4'),
      url: 'blob:b',
      metadata: {
        width: 1280,
        height: 720,
        fps: 60,
        duration: 1.25,
        totalFrames: 75,
        source: 'backend' as const,
      },
    },
  ];
  render(<TimelineHarness clips={clips} />);
  fireEvent.change(screen.getByLabelText('Timeline FPS'), {
    target: { value: '25' },
  });
  expect(
    screen.getByRole('button', { name: /^Preview clip 1:/ }),
  ).toHaveTextContent('Frames 0–99');
  expect(
    screen.getByRole('button', { name: /^Preview clip 2:/ }),
  ).toHaveTextContent('Frames 100–130');
  expect(
    screen.getByRole('button', { name: /^Preview clip 3:/ }),
  ).toHaveTextContent('Frames 131–230');
  expect(
    screen.getByRole('button', { name: /^Preview clip 12:/ }),
  ).toHaveTextContent('Frames 1031–1130');
  fireEvent.click(screen.getByRole('button', { name: /^Preview clip 3:/ }));
  expect(screen.getByLabelText('Timeline frame')).toHaveTextContent(
    'Frame 131 / 1130',
  );
});

it('does not invent an Auto FPS for uploaded media while metadata is unavailable', () => {
  const clip = {
    id: 'pending',
    file: new File(['a'], 'Pending.mp4'),
    url: 'blob:pending',
  };
  const { rerender } = render(
    <TimelineDemo {...defaultProps} clips={[clip]} />,
  );
  expect(screen.getByLabelText('Effective timeline FPS')).toHaveTextContent(
    'Waiting for first uploaded clip FPS',
  );
  expect(screen.getByLabelText('Timeline frame')).toHaveTextContent(
    'Frame unavailable',
  );
  rerender(
    <TimelineDemo
      {...defaultProps}
      clips={[
        {
          ...clip,
          metadata: {
            width: 1280,
            height: 720,
            fps: 50,
            duration: 4,
            totalFrames: 200,
            source: 'backend',
          },
        },
      ]}
    />,
  );
  expect(screen.getByLabelText('Effective timeline FPS')).toHaveTextContent(
    '50 FPS',
  );
  expect(screen.getByLabelText('Timeline frame')).toHaveTextContent(
    'Frame 0 / 2399',
  );
});

it('uses controlled project FPS and delegates the real timeline merge action', () => {
  const onFpsSelectionChange = vi.fn();
  const onMerge = vi.fn();
  const clips = [0, 1].map((index) => ({
    id: `clip-${index}`,
    file: new File(['video'], `Clip${index}.mp4`),
    url: `blob:${index}`,
    metadata: {
      width: 1280,
      height: 720,
      fps: index ? 60 : 29.97,
      duration: 1,
      totalFrames: index ? 60 : 30,
      source: 'backend' as const,
    },
    metadataStatus: 'ready' as const,
    trim: { startFrame: 0, endFrame: index ? 59 : 29 },
    trimSaved: false,
    speed: 1 as const,
  }));
  const { rerender } = render(
    <TimelineDemo
      clips={clips}
      fpsSelection="auto"
      onFpsSelectionChange={onFpsSelectionChange}
      canMerge
      busy={false}
      onMerge={onMerge}
    />,
  );

  expect(screen.getByLabelText('Effective timeline FPS')).toHaveTextContent(
    '30 FPS',
  );
  fireEvent.change(screen.getByLabelText('Timeline FPS'), {
    target: { value: '25' },
  });
  expect(onFpsSelectionChange).toHaveBeenCalledWith('25');
  fireEvent.click(
    screen.getByRole('button', { name: 'Merge current timeline' }),
  );
  expect(onMerge).toHaveBeenCalledOnce();

  rerender(
    <TimelineDemo
      clips={clips}
      fpsSelection="25"
      onFpsSelectionChange={onFpsSelectionChange}
      canMerge
      busy
      onMerge={onMerge}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Merge current timeline' }),
  ).toBeDisabled();
});

it('shows every real uploaded clip in a twenty-clip Video 1 plan', () => {
  const clips = Array.from({ length: 20 }, (_, index) => ({
    id: `clip-${index}`,
    file: new File(['video'], `Clip${index + 1}.mp4`),
    url: `blob:${index}`,
    metadata: {
      width: 1280,
      height: 720,
      fps: 30,
      duration: 1,
      totalFrames: 30,
      source: 'backend' as const,
    },
    metadataStatus: 'ready' as const,
    trim: { startFrame: 0, endFrame: 29 },
    trimSaved: false,
    speed: 1 as const,
  }));

  render(<TimelineDemo {...defaultProps} clips={clips} />);

  const videoOne = screen.getByRole('region', { name: 'VIDEO 1' });
  expect(
    within(videoOne).getAllByRole('button', { name: /^Preview clip/ }),
  ).toHaveLength(20);
  expect(within(videoOne).queryByText('SAMPLE AD')).not.toBeInTheDocument();
  expect(screen.getByText('20 clips')).toBeVisible();
  expect(screen.getByText(/20 uploaded/)).toBeVisible();
});

it('presents four tracks, twelve sample clips and honest MP4 settings', () => {
  render(<TimelineDemo {...defaultProps} clips={[]} />);
  expect(screen.getByText(/Browser preview is approximate/i)).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'VIDEO 1' })).getAllByRole(
      'button',
      { name: /^Preview clip/ },
    ),
  ).toHaveLength(12);
  for (const name of ['VIDEO 2', 'VIDEO 1', 'AUDIO 1', 'AUDIO 2']) {
    expect(screen.getByRole('region', { name })).toBeVisible();
  }
  expect(screen.queryByText(/optional overlay/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Export format')).toHaveValue('MP4');
  expect(
    within(screen.getByLabelText('Export format')).getAllByRole('option'),
  ).toHaveLength(1);
  expect(screen.getByText('High quality export')).toBeVisible();
  expect(screen.getByText('1920 × 1080 · sample')).toBeVisible();
});

it('plays, pauses and seeks the project clock', () => {
  vi.useFakeTimers();
  render(<TimelineDemo {...defaultProps} clips={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByLabelText('Current time and frame')).toHaveTextContent(
    '00:01',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '8' },
  });
  expect(screen.getByLabelText('Current time and frame')).toHaveTextContent(
    '00:08',
  );
});

it('shows scheduled overlays and removes a short PIP at source EOF', () => {
  const clip = {
    id: 'base',
    file: new File(['base'], 'Base.mp4'),
    url: 'blob:base',
    metadata: {
      width: 1280,
      height: 720,
      fps: 25,
      duration: 4,
      totalFrames: 100,
      source: 'backend' as const,
    },
    metadataStatus: 'ready' as const,
    trim: { startFrame: 0, endFrame: 99 },
    trimSaved: false,
    speed: 1 as const,
  };
  const overlays: OverlayState = {
    image: {
      kind: 'image',
      file: new File(['logo'], 'logo.png'),
      url: 'blob:logo',
      metadataStatus: 'ready',
      startFrame: 10,
      endFrame: 50,
      position: 'top-left',
      size: 'small',
    },
    video: {
      kind: 'video',
      file: new File(['pip'], 'pip.mp4'),
      url: 'blob:pip',
      metadataStatus: 'ready',
      duration: 0.4,
      startFrame: 10,
      endFrame: 50,
      position: 'bottom-right',
      size: 'medium',
    },
  };
  render(
    <TimelineDemo
      {...defaultProps}
      clips={[clip]}
      fpsSelection="25"
      overlays={overlays}
    />,
  );
  expect(
    screen.queryByLabelText('Image overlay preview'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('PIP overlay preview'),
  ).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '0.4' },
  });
  expect(screen.getByLabelText('Image overlay preview')).toHaveClass(
    'td-overlay-top-left',
    'td-overlay-small',
  );
  expect(screen.getByLabelText('PIP overlay preview')).toHaveClass(
    'td-overlay-bottom-right',
    'td-overlay-medium',
  );

  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '0.8' },
  });
  expect(screen.getByLabelText('Image overlay preview')).toBeVisible();
  expect(
    screen.queryByLabelText('PIP overlay preview'),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Image overlay lane item')).toHaveTextContent(
    'logo.png',
  );
  expect(screen.getByLabelText('PIP overlay lane item')).toHaveTextContent(
    'pip.mp4',
  );
});

it('uses uploaded sources and reports their metadata without modifying clips', () => {
  const clip = {
    id: 'one',
    file: new File(['video'], 'Launch.mp4'),
    url: 'blob:uploaded',
    metadata: {
      width: 1280,
      height: 720,
      fps: 24,
      duration: 4,
      totalFrames: 96,
      source: 'backend' as const,
    },
  };
  const { container } = render(
    <TimelineDemo {...defaultProps} clips={[clip]} />,
  );
  expect(container.querySelector('video')).toHaveAttribute(
    'src',
    'blob:uploaded',
  );
  expect(screen.getByText('1280 × 720')).toBeVisible();
  expect(screen.getByText('24 fps')).toBeVisible();
  expect(clip).not.toHaveProperty('trim');
});

it('seeks a paused uploaded preview to its trimmed source position when metadata loads', () => {
  const clip = {
    id: 'trimmed',
    file: new File(['video'], 'Trimmed.mp4'),
    url: 'blob:trimmed',
    metadata: {
      width: 1280,
      height: 720,
      fps: 24,
      duration: 8,
      totalFrames: 192,
      source: 'backend' as const,
    },
    trim: { startFrame: 48, endFrame: 95 },
    speed: 0.5 as const,
  };
  render(<TimelineDemo {...defaultProps} clips={[clip]} />);
  const preview = screen.getByLabelText(
    'Uploaded clip preview',
  ) as HTMLVideoElement;
  Object.defineProperty(preview, 'duration', { configurable: true, value: 8 });
  fireEvent.loadedMetadata(preview);
  expect(preview.currentTime).toBe(2);
  expect(preview.playbackRate).toBe(0.5);
  fireEvent.change(screen.getByLabelText('Timeline position'), {
    target: { value: '1' },
  });
  expect(preview.currentTime).toBe(2.5);
});
