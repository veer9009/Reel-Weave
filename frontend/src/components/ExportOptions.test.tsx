import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExportOptions } from './ExportOptions';
it('keeps_mp4_mandatory_and_disables_unavailable_formats_and_locked_selection', () => {
  const change = vi.fn();
  const view = render(
    <ExportOptions
      formats={['mp4']}
      onChange={change}
      capabilities={{ mov: true, wav: true, mp3: false }}
      disabled={false}
    />,
  );
  expect(screen.getByLabelText('MP4')).toBeChecked();
  expect(screen.getByLabelText('MP4')).toBeDisabled();
  expect(screen.getByLabelText('MP3')).toBeDisabled();
  expect(screen.getByText(/MP3 is unavailable/)).toBeVisible();
  fireEvent.click(screen.getByLabelText('WAV'));
  expect(change).toHaveBeenCalledWith(['mp4', 'wav']);
  view.rerender(
    <ExportOptions
      formats={['mp4', 'wav']}
      onChange={change}
      disabled
      capabilities={{ wav: true }}
    />,
  );
  expect(screen.getByLabelText('WAV')).toBeDisabled();
  expect(screen.getByLabelText('WAV')).toBeChecked();
});
