import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BackgroundAudioTrack } from './BackgroundAudioTrack';
it.each(['pointer', 'keyboard', 'cancel'] as const)(
  'audio_history range %s previews and completes once',
  (mode) => {
    const props = {
      audio: null,
      settings: {
        originalVolume: 1,
        originalMuted: false,
        musicVolume: 0.3,
        musicMuted: false,
      },
      disabled: false,
      onSelect: vi.fn(),
      onMetadata: vi.fn(),
      onMetadataError: vi.fn(),
      onRemove: vi.fn(),
      onSettings: vi.fn(),
      onVolumeBegin: vi.fn(() => 'volume'),
      onVolumePreview: vi.fn(),
      onVolumeEnd: vi.fn(),
    };
    render(<BackgroundAudioTrack {...props} />);
    const range = screen.getByLabelText('Original audio volume', {
      selector: 'input',
    });
    if (mode === 'keyboard') fireEvent.keyDown(range, { key: 'ArrowLeft' });
    else fireEvent.pointerDown(range);
    fireEvent.change(range, { target: { value: '80' } });
    fireEvent.change(range, { target: { value: '60' } });
    expect(props.onVolumeBegin).toHaveBeenCalledOnce();
    expect(props.onVolumePreview).toHaveBeenLastCalledWith(
      'volume',
      'originalVolume',
      0.6,
    );
    expect(props.onVolumeEnd).not.toHaveBeenCalled();
    if (mode === 'keyboard') {
      fireEvent.keyUp(range, { key: 'ArrowLeft' });
      fireEvent.blur(range);
    } else if (mode === 'cancel') fireEvent.pointerCancel(range);
    else fireEvent.pointerUp(range);
    fireEvent.blur(range);
    expect(props.onVolumeEnd).toHaveBeenCalledExactlyOnceWith(
      'volume',
      mode !== 'cancel',
    );
    expect(props.onSettings).not.toHaveBeenCalled();
  },
);
