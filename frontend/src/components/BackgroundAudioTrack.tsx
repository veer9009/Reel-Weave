import { Music, Trash2, Upload } from 'lucide-react';
import { formatDuration } from '../lib/clips';
import type { AudioSettings } from '../lib/clips';

export type BackgroundAudio = {
  file: File;
  url: string;
  duration?: number;
  status: 'loading' | 'ready' | 'error';
};

type Props = {
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
}: Props) {
  const update = (values: Partial<AudioSettings>) =>
    onSettings({ ...settings, ...values });
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
            onChange={(event) =>
              update({ originalVolume: Number(event.target.value) / 100 })
            }
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
            onChange={(event) =>
              update({ musicVolume: Number(event.target.value) / 100 })
            }
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
