import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import {
  generateProjectFileMedia,
  createBrowserProject,
} from './projectFileFixtures';
import type {
  ProjectDocumentV2,
  ProjectSourceV1,
} from '../src/lib/projectFileTypes';

export type AudioLane = 'independent' | 'detached' | 'music';
export type AudioEdit =
  'split' | 'move' | 'trim-start' | 'trim-end' | 'delete' | 'lift' | 'replace';
export type ExpectedAudioEvent = {
  lane: 'original' | 'music';
  sourceId: 'a' | 'b' | 'picture';
  timelineStartFrame: number;
  durationFrames: number;
  sourceStartSample: number;
  gain: number;
};
type Chunk = { at: number; left: number[]; right: number[] };
export type PreviewPcm = {
  sampleRate: number;
  channels: Float32Array[];
  projectStartSeconds: number;
  buses: Chunk[][];
};

function wav(path: string, replacement: boolean) {
  const n = 192000,
    data = Buffer.alloc(44 + n * 4);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(48000, 24);
  data.writeUInt32LE(192000, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const frequency = replacement
      ? 1100
      : i < 48000
        ? 330
        : i < 96000
          ? 660
          : 990;
    const value = Math.round(
      0.12 * 32767 * Math.sin((2 * Math.PI * frequency * i) / 48000),
    );
    data.writeInt16LE(value, 44 + i * 4);
    data.writeInt16LE(-Math.floor(value / 2), 46 + i * 4);
  }
  writeFileSync(path, data);
}

export function generateAudioParityMedia(folder: string) {
  const media = generateProjectFileMedia(folder);
  const sourceA = join(folder, 'parity-a.wav'),
    sourceB = join(folder, 'parity-b.wav');
  wav(sourceA, false);
  wav(sourceB, true);
  const compressed = join(folder, 'parity-b.mp3');
  const encoded = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', sourceB, '-b:a', '320k', compressed],
    { windowsHide: true },
  );
  if (encoded.status !== 0) throw new Error(encoded.stderr.toString());
  return {
    media,
    picture: media.base,
    sourceA,
    sourceB,
    stereo: sourceA,
    compressed,
  };
}
export type ParityMedia = ReturnType<typeof generateAudioParityMedia>;

function audioSource(path: string, id: string): ProjectSourceV1 {
  const bytes = readFileSync(path);
  return {
    id,
    originalName: basename(path),
    sizeBytes: bytes.length,
    mimeType: 'audio/wav',
    lastModifiedMs: null,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mediaType: 'audio',
    metadata: { durationSeconds: 4, sampleCount: 192000 },
  };
}

export function parityProject(
  media: ParityMedia,
  lane: AudioLane,
): ProjectDocumentV2 {
  const v1 = createBrowserProject(media.media);
  const { musicSourceId, ...edit } = v1.edit;
  void musicSourceId;
  edit.binSourceIds = ['source_a'];
  edit.video1[0].outputWindow = { outputInFrame: 0, outputOutFrame: 100 };
  edit.video1[0].originalAudio = lane === 'detached' ? 'detached' : 'linked';
  edit.audio = {
    originalMuted: lane === 'music',
    originalVolume: 1,
    musicMuted: false,
    musicVolume: 1,
  };
  const window = {
    id: 'initial_audio',
    timelineStartFrame: 0,
    durationFrames: 50,
    sourceStartSample: 0,
  };
  if (lane === 'music') edit.music = [{ ...window, sourceId: 'source_a' }];
  else
    edit.independentAudio = [
      {
        ...window,
        source:
          lane === 'detached'
            ? {
                kind: 'video-edit',
                sourceId: 'source_base',
                sourceStartFrame: 0,
                sourceEndFrame: 149,
                speed: 1,
                normalizationFps: 25,
              }
            : { kind: 'audio-file', sourceId: 'source_a' },
      },
    ];
  return {
    ...v1,
    schemaVersion: 2,
    sources: [v1.sources[0], audioSource(media.sourceA, 'source_a')],
    edit,
    exportSettings: { formats: ['mp4', 'mov', 'wav', 'mp3'] },
  };
}

export function expectedEvents(
  lane: AudioLane,
  action: AudioEdit,
): ExpectedAudioEvent[] {
  const bus = lane === 'music' ? 'music' : 'original';
  const a = lane === 'detached' ? 'picture' : 'a';
  const events: ExpectedAudioEvent[] = [
    {
      lane: bus,
      sourceId: a,
      timelineStartFrame: 0,
      durationFrames: 25,
      sourceStartSample: 0,
      gain: 1,
    },
    {
      lane: bus,
      sourceId: a,
      timelineStartFrame: 25,
      durationFrames: 25,
      sourceStartSample: 48000,
      gain: 1,
    },
  ];
  if (action === 'move') events[1].timelineStartFrame = 50;
  if (action === 'trim-start')
    Object.assign(events[1], {
      timelineStartFrame: 30,
      durationFrames: 20,
      sourceStartSample: 57600,
    });
  if (action === 'trim-end') events[1].durationFrames = 20;
  if (action === 'delete') return [{ ...events[1], timelineStartFrame: 0 }];
  if (action === 'lift') return [events[1]];
  if (action === 'replace')
    Object.assign(events[1], { sourceId: 'b', sourceStartSample: 0 });
  return events;
}

export function expectedFrequency(
  lane: AudioLane,
  events: ExpectedAudioEvent[],
  time: number,
): number {
  const event = events.find(
    (v) =>
      time * 25 >= v.timelineStartFrame &&
      time * 25 < v.timelineStartFrame + v.durationFrames,
  );
  if (!event) return lane === 'independent' ? 440 : 0;
  if (event.sourceId === 'picture') return 440;
  if (event.sourceId === 'b') return 1100;
  const sourceTime =
    event.sourceStartSample / 48000 + time - event.timelineStartFrame / 25;
  return sourceTime < 1 ? 330 : sourceTime < 2 ? 660 : 990;
}

export function toneAmplitude(
  values: readonly number[] | Float32Array,
  frequency: number,
  rate = 48000,
) {
  let re = 0,
    im = 0;
  for (let i = 0; i < values.length; i++) {
    re += values[i] * Math.cos((2 * Math.PI * frequency * i) / rate);
    im += values[i] * Math.sin((2 * Math.PI * frequency * i) / rate);
  }
  return (2 * Math.hypot(re, im)) / values.length;
}

export async function installPreviewCapture(page: Page) {
  await page.addInitScript(() => {
    const capture = { buses: [] as { chunks: Chunk[] }[], rate: 48000 };
    Object.assign(window, { avstudioCapturedAudio: capture });
    const native = AudioNode.prototype.connect;
    let internal = false;
    AudioNode.prototype.connect = function (
      this: AudioNode,
      ...args: unknown[]
    ) {
      const result = (
        native as unknown as (...args: unknown[]) => AudioNode
      ).apply(this, args);
      if (
        !internal &&
        this instanceof GainNode &&
        args[0] === this.context.destination
      ) {
        internal = true;
        const ctx = this.context as AudioContext;
        const node = ctx.createScriptProcessor(1024, 2, 2),
          bus = { chunks: [] as Chunk[] };
        capture.buses.push(bus);
        capture.rate = ctx.sampleRate;
        node.onaudioprocess = (event) => {
          const picture = document.querySelector<HTMLVideoElement>(
            '[aria-label="Uploaded clip preview"]',
          );
          if (picture && !picture.paused)
            bus.chunks.push({
              at: picture.currentTime + event.playbackTime - ctx.currentTime,
              left: Array.from(event.inputBuffer.getChannelData(0)),
              right: Array.from(event.inputBuffer.getChannelData(1)),
            });
          for (let i = 0; i < event.outputBuffer.numberOfChannels; i++)
            event.outputBuffer.getChannelData(i).fill(0);
        };
        native.call(this, node);
        native.call(node, ctx.destination);
        internal = false;
      }
      return result;
    } as typeof native;
  });
}

export async function capturePreviewPcm(
  page: Page,
  durationFrames: number,
  fps: number,
): Promise<PreviewPcm> {
  await page.evaluate(() => {
    const c = (
      window as unknown as {
        avstudioCapturedAudio: { buses: { chunks: Chunk[] }[] };
      }
    ).avstudioCapturedAudio;
    c.buses.forEach((bus) => {
      bus.chunks = [];
    });
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Timeline position"]',
    )!;
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    set.call(input, '0');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await page.waitForFunction((end) => {
    const v = document.querySelector<HTMLVideoElement>(
      '[aria-label="Uploaded clip preview"]',
    );
    return Boolean(v && v.currentTime >= end);
  }, durationFrames / fps);
  await page
    .getByRole('button', { name: 'Pause preview', exact: true })
    .click();
  const data = await page.evaluate(() => {
    const c = (
      window as unknown as {
        avstudioCapturedAudio: { buses: { chunks: Chunk[] }[]; rate: number };
      }
    ).avstudioCapturedAudio;
    return { rate: c.rate, buses: c.buses.map((v) => v.chunks) };
  });
  const channels = [
    new Float32Array(Math.ceil((durationFrames / fps) * data.rate)),
    new Float32Array(Math.ceil((durationFrames / fps) * data.rate)),
  ];
  for (const chunks of data.buses)
    for (const chunk of chunks) {
      const start = Math.round(chunk.at * data.rate);
      for (let i = 0; i < chunk.left.length; i++)
        if (start + i >= 0 && start + i < channels[0].length) {
          channels[0][start + i] += chunk.left[i];
          channels[1][start + i] += chunk.right[i];
        }
    }
  return {
    sampleRate: data.rate,
    channels,
    projectStartSeconds: 0,
    buses: data.buses,
  };
}

export function decodedAudio(path: string) {
  const output = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-f',
      'f32le',
      '-',
    ],
    { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  );
  if (output.status !== 0) throw new Error(output.stderr.toString());
  const view = new DataView(
    output.stdout.buffer,
    output.stdout.byteOffset,
    output.stdout.byteLength,
  );
  return Float32Array.from({ length: output.stdout.length / 4 }, (_, i) =>
    view.getFloat32(i * 4, true),
  );
}
