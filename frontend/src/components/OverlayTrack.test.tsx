import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { OverlayTrack } from './OverlayTrack';
import type { OverlayState } from '../lib/overlays';

const image: NonNullable<OverlayState['image']> = {
  kind: 'image',
  file: new File(['image'], 'logo.png', { type: 'image/png' }),
  url: 'blob:logo',
  metadataStatus: 'loading',
  startFrame: 0,
  endFrame: 89,
  position: 'top-right',
  size: 'small',
};

const video: NonNullable<OverlayState['video']> = {
  kind: 'video',
  file: new File(['video'], 'pip.mp4', { type: 'video/mp4' }),
  url: 'blob:pip',
  metadataStatus: 'loading',
  startFrame: 10,
  endFrame: 80,
  position: 'bottom-right',
  size: 'medium',
};

const props = {
  overlays: { image: null, video: null } as OverlayState,
  totalProjectFrames: 90,
  imageLimitMb: 20,
  videoLimitMb: 200,
  disabled: false,
  onSelect: vi.fn(),
  onMetadata: vi.fn(),
  onMetadataError: vi.fn(),
  onScheduleChange: vi.fn(),
  onRemove: vi.fn(),
};

it('renders one labeled image slot and one labeled PIP slot', async () => {
  const user = userEvent.setup();
  render(<OverlayTrack {...props} />);
  await user.upload(
    screen.getByLabelText('Choose image overlay'),
    new File(['logo'], 'logo.jpg', { type: 'image/jpeg' }),
  );
  await user.upload(
    screen.getByLabelText('Choose video overlay'),
    new File(['pip'], 'pip.mov', { type: 'video/quicktime' }),
  );
  expect(props.onSelect).toHaveBeenNthCalledWith(1, 'image', expect.any(File));
  expect(props.onSelect).toHaveBeenNthCalledWith(2, 'video', expect.any(File));
});

it('exposes inclusive schedule, position, size, metadata, and remove controls', async () => {
  const onScheduleChange = vi.fn();
  const onMetadata = vi.fn();
  const onMetadataError = vi.fn();
  const onRemove = vi.fn();
  const user = userEvent.setup();
  const { container } = render(
    <OverlayTrack
      {...props}
      overlays={{ image, video }}
      onScheduleChange={onScheduleChange}
      onMetadata={onMetadata}
      onMetadataError={onMetadataError}
      onRemove={onRemove}
    />,
  );

  await user.clear(screen.getByLabelText('Image overlay start frame'));
  await user.type(screen.getByLabelText('Image overlay start frame'), '5');
  expect(onScheduleChange).toHaveBeenLastCalledWith('image', {
    startFrame: 5,
  });
  await user.selectOptions(screen.getByLabelText('Image overlay position'), [
    'centre',
  ]);
  await user.selectOptions(screen.getByLabelText('Image overlay size'), [
    'large',
  ]);
  expect(onScheduleChange).toHaveBeenCalledWith('image', {
    position: 'centre',
  });
  expect(onScheduleChange).toHaveBeenCalledWith('image', { size: 'large' });

  fireEvent.load(container.querySelector('img')!);
  const pip = container.querySelector('video')!;
  Object.defineProperty(pip, 'duration', { configurable: true, value: 1.25 });
  fireEvent.loadedMetadata(pip);
  fireEvent.error(pip);
  expect(onMetadata).toHaveBeenCalledWith('image');
  expect(onMetadata).toHaveBeenCalledWith('video', 1.25);
  expect(onMetadataError).toHaveBeenCalledWith('video');

  await user.click(screen.getByRole('button', { name: 'Remove logo.png' }));
  expect(onRemove).toHaveBeenCalledWith('image');
});

it('disables empty selection until Video 1 has a valid duration', () => {
  render(<OverlayTrack {...props} totalProjectFrames={0} />);
  expect(screen.getByLabelText('Choose image overlay')).toBeDisabled();
  expect(screen.getByLabelText('Choose video overlay')).toBeDisabled();
  expect(screen.getByText(/add ready Video 1 clips/i)).toBeVisible();
});
