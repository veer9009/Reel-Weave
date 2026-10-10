import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PipCandidateProbe } from './PipCandidateProbe';
it.each([2, NaN, 0])(
  'PipCandidateProbe validates duration %s with captured identity',
  (duration) => {
    const token = { session: 0, sourceId: 'pip', requestId: 1 },
      onReady = vi.fn(),
      onError = vi.fn();
    const view = render(
      <PipCandidateProbe
        token={token}
        url="blob:pip"
        onReady={onReady}
        onError={onError}
      />,
    );
    const video = view.container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { value: duration });
    fireEvent.loadedMetadata(video);
    if (duration > 0)
      expect(onReady).toHaveBeenCalledExactlyOnceWith(token, duration);
    else expect(onError).toHaveBeenCalledExactlyOnceWith(token);
  },
);
