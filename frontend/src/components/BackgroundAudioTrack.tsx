import { Music, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { GestureToken } from '../lib/editHistory';
import { formatDuration } from '../lib/clips';
import type { AudioSettings } from '../lib/clips';

export type BackgroundAudio = {
  file: File;
  url: string;
  duration?: number;
  status: 'loading' | 'ready' | 'error';
};

type Props = {
  onVolumeBegin?: (
    field: 'originalVolume' | 'musicVolume',
  ) => GestureToken | null;
  onVolumePreview?: (
    token: GestureToken,
    field: 'originalVolume' | 'musicVolume',
    value: number,
  ) => void;
  onVolumeEnd?: (token: GestureToken, accept: boolean) => void;
  audio: BackgroundAudio | null;
  settings: AudioSettings;
  disabled: boolean;
  onSelect: (file: File) => void;
  onMetadata: (duration: number) => void;
  onMetadataError: () => void;
  onRemove: () => void;
  onSettings: (settings: AudioSettings) => void;
};

export function BackgroundAudioTrack({
  audio,
  settings,
  disabled,
  onSelect,
  onMetadata,
  onMetadataError,
  onRemove,
  onSettings,
  onVolumeBegin,
  onVolumePreview,
  onVolumeEnd,
}: Props) {
  const gesture = useRef<{
    token: GestureToken;
    mode: 'pointer' | 'keyboard';
    pointerId?: number;
  } | null>(null);
  const endRef = useRef(onVolumeEnd);
  useEffect(() => {
    endRef.current = onVolumeEnd;
  });
  const finish = (accept: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (current) onVolumeEnd?.(current.token, accept);
  };
  useEffect(() => {
    if (disabled && gesture.current) {
      const current = gesture.current;
      gesture.current = null;
      endRef.current?.(current.token, false);
    }
  }, [disabled]);
  useEffect(
    () => () => {
      const current = gesture.current;
      gesture.current = null;
      if (current) endRef.current?.(current.token, false);
    },
    [],
  );
  const update = (values: Partial<AudioSettings>) => {
    finish(true);
    onSettings({ ...settings, ...values });
  };
  const rangeEvents = {
    onPointerDown: (
      field: 'originalVolume' | 'musicVolume',
      event: React.PointerEvent<HTMLInputElement>,
    ) => {
      if (disabled || event.button > 0) return;
      const token = onVolumeBegin?.(field);
      if (token) {
        gesture.current = {
          token,
          mode: 'pointer',
          pointerId: event.pointerId,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLInputElement>) => {
      if (
        gesture.current?.mode !== 'pointer' ||
        gesture.current.pointerId !== event.pointerId
      )
        return;
      finish(true);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: (event: React.PointerEvent<HTMLInputElement>) => {
      if (
        gesture.current?.mode === 'pointer' &&
        gesture.current.pointerId === event.pointerId
      )
        finish(false);
    },
    onLostPointerCapture: (event: React.PointerEvent<HTMLInputElement>) => {
      if (
        gesture.current?.mode === 'pointer' &&
        gesture.current.pointerId === event.pointerId
      )
        finish(false);
    },
    onKeyDown: (
      field: 'originalVolume' | 'musicVolume',
      event: React.KeyboardEvent<HTMLInputElement>,
    ) => {
      if (
        disabled ||
        gesture.current ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        ![
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
          'PageUp',
          'PageDown',
        ].includes(event.key)
      )
        return;
      const token = onVolumeBegin?.(field);
      if (token) gesture.current = { token, mode: 'keyboard' };
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        gesture.current?.mode === 'keyboard' &&
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
          'PageUp',
          'PageDown',
        ].includes(event.key)
      )
        finish(true);
    },
    onBlur: () => {
      if (gesture.current?.mode === 'keyboard') finish(true);
    },
    onChange: (
      field: 'originalVolume' | 'musicVolume',
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      const value = Number(event.target.value) / 100;
      if (gesture.current)
        onVolumePreview?.(gesture.current.token, field, value);
      else onSettings({ ...settings, [field]: value });
    },
  };
  return (
    <section
      className="background-audio panel"
      aria-labelledby="background-audio-title"
    >
      <div className="audio-heading">
        <div>
          <span className="eyebrow">FULL TIMELINE</span>
          <h2 id="background-audio-title">Background audio</h2>
        </div>
        <Music aria-hidden="true" />
      </div>
      {!audio ? (
        <label className="audio-upload">
          <Upload aria-hidden="true" />
          <span>Choose background audio</span>
          <small>MP3, WAV, AAC, or M4A · starts at 00:00</small>
          <input
            aria-label="Choose background audio"
            type="file"
            accept=".mp3,.wav,.aac,.m4a,audio/*"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onSelect(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
      ) : (
        <div className="audio-clip">
          <audio
            src={audio.url}
            preload="metadata"
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              if (Number.isFinite(duration) && duration > 0)
                onMetadata(duration);
              else onMetadataError();
            }}
            onError={onMetadataError}
          />
          <div className="audio-label">
            <strong>{audio.file.name}</strong>
            <span>
              00:00 —{' '}
              {audio.status === 'ready'
                ? formatDuration(audio.duration)
                : 'Loading duration…'}
            </span>
          </div>
          <div className="audio-band" aria-hidden="true" />
          <button
            type="button"
            className="icon-button remove"
            aria-label={`Remove ${audio.file.name}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 />
          </button>
        </div>
      )}
      <div className="audio-mix-controls">
        <label>
          Original audio volume{' '}
          <output>{Math.round(settings.originalVolume * 100)}%</output>
          <input
            aria-label="Original audio volume"
            type="range"
            min="0"
            max="100"
            value={Math.round(settings.originalVolume * 100)}
            disabled={disabled}
            onPointerDown={(event) =>
              rangeEvents.onPointerDown('originalVolume', event)
            }
            onPointerUp={rangeEvents.onPointerUp}
            onPointerCancel={rangeEvents.onPointerCancel}
            onLostPointerCapture={rangeEvents.onLostPointerCapture}
            onKeyDown={(event) =>
              rangeEvents.onKeyDown('originalVolume', event)
            }
            onKeyUp={rangeEvents.onKeyUp}
            onBlur={rangeEvents.onBlur}
            onChange={(event) => rangeEvents.onChange('originalVolume', event)}
          />
        </label>
        <label className="mute-control">
          <input
            aria-label="Mute original audio"
            type="checkbox"
            checked={settings.originalMuted}
            disabled={disabled}
            onChange={(event) =>
              update({ originalMuted: event.target.checked })
            }
          />{' '}
          Mute original
        </label>
        <label>
          Music volume{' '}
          <output>{Math.round(settings.musicVolume * 100)}%</output>
          <input
            aria-label="Music volume"
            type="range"
            min="0"
            max="100"
            value={Math.round(settings.musicVolume * 100)}
            disabled={disabled || !audio}
            onPointerDown={(event) =>
              rangeEvents.onPointerDown('musicVolume', event)
            }
            onPointerUp={rangeEvents.onPointerUp}
            onPointerCancel={rangeEvents.onPointerCancel}
            onLostPointerCapture={rangeEvents.onLostPointerCapture}
            onKeyDown={(event) => rangeEvents.onKeyDown('musicVolume', event)}
            onKeyUp={rangeEvents.onKeyUp}
            onBlur={rangeEvents.onBlur}
            onChange={(event) => rangeEvents.onChange('musicVolume', event)}
          />
        </label>
        <label className="mute-control">
          <input
            aria-label="Mute music"
            type="checkbox"
            checked={settings.musicMuted}
            disabled={disabled || !audio}
            onChange={(event) => update({ musicMuted: event.target.checked })}
          />{' '}
          Mute music
        </label>
      </div>
    </section>
  );
}
