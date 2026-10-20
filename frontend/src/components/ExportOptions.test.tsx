import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExportOptions } from './ExportOptions';
it('a_restored_unavailable_format_can_be_deselected_without_enabling_new_unsupported_exports', () => {
  const change = vi.fn();
  render(
    <ExportOptions
      formats={['mp4', 'wav']}
      onChange={change}
      capabilities={{ wav: false, mov: false }}
      disabled={false}
    />,
  );
  expect(screen.getByLabelText('WAV')).toBeChecked();
  expect(screen.getByLabelText('WAV')).toBeEnabled();
  expect(screen.getByLabelText('MOV')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('WAV'));
  expect(change).toHaveBeenCalledWith(['mp4']);
});
it.each([false, true])(
  'keeps_optional_capability_and_locked_states_visible_%s',
  (locked) => {
    render(
      <ExportOptions
        formats={['mp4', 'mov', 'wav', 'mp3']}
        onChange={() => {}}
        capabilities={{ mov: true, wav: true, mp3: true }}
        disabled={locked}
      />,
    );
    for (const format of ['MP4', 'MOV', 'WAV', 'MP3']) {
      const input = screen.getByLabelText(format);
      expect(input).toBeChecked();
      if (locked || format === 'MP4') expect(input).toBeDisabled();
      else expect(input).toBeEnabled();
    }
    expect(screen.getByText(/MP4 is included with every render/)).toBeVisible();
  },
);
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
