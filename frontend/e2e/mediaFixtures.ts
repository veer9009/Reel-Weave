import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(program: string, args: string[], binary = false) {
  const result = spawnSync(program, args, {
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${program}: ${result.stderr.toString()}`);
  return binary ? result.stdout : result.stdout.toString();
}

export function generateAdvancedMedia(folder: string) {
  mkdirSync(folder, { recursive: true });
  const video = (
    name: string,
    color: string,
    frames: number,
    tone?: number,
  ) => {
    const path = join(folder, `${name}.mp4`);
    const inputs = ['-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=25`];
    if (tone)
      inputs.push(
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${tone}:sample_rate=48000`,
      );
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      ...inputs,
      '-frames:v',
      String(frames),
      '-t',
      String(frames / 25),
      '-c:v',
      'libx264',
      '-threads',
      '2',
      '-pix_fmt',
      'yuv420p',
      ...(tone ? ['-c:a', 'aac'] : ['-an']),
      path,
    ]);
    return path;
  };
  const music = join(folder, 'song.wav');
  const count = 8 * 48000;
  const wav = Buffer.alloc(44 + count * 4);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(192000, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 4, 40);
  for (let n = 0; n < count; n++) {
    const tone = n < 96000 ? 330 : n < 144000 ? 660 : 990;
    const sample = Math.round(
      0.08 * 32767 * Math.sin((2 * Math.PI * tone * n) / 48000),
    );
    wav.writeInt16LE(sample, 44 + n * 4);
    wav.writeInt16LE(sample, 46 + n * 4);
  }
  writeFileSync(music, wav);
  const image = join(folder, 'logo.png');
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=white:s=32x32',
    '-frames:v',
    '1',
    '-threads',
    '1',
    image,
  ]);
  return {
    base: video('base', 'red', 150, 440),
    takeA: video('take-a', 'blue', 60, 880),
    takeB: video('take-b', 'yellow', 20, 1100),
    silentTake: video('silent', 'blue', 20),
    pip: video('pip', 'lime', 10, 1200),
    image,
    music,
  };
}
export function generateContinuityVideo(folder: string, chirp = false) {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, 'base60.mp4');
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=60',
    '-f',
    'lavfi',
    '-i',
    chirp
      ? 'aevalsrc=0.125*sin(2*PI*(440*t+200*t*t)):s=48000'
      : 'sine=frequency=440:sample_rate=48000',
    '-frames:v',
    '360',
    '-t',
    '6',
    '-c:v',
    'libx264',
    '-threads',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    path,
  ]);
  return path;
}

export function probeDownloadedMp4(path: string) {
  const result = JSON.parse(
    String(
      run('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-show_streams',
        '-of',
        'json',
        path,
      ]),
    ),
  );
  const video = result.streams.find(
    (s: { codec_type: string }) => s.codec_type === 'video',
  );
  const audio = result.streams.find(
    (s: { codec_type: string }) => s.codec_type === 'audio',
  );
  return {
    frames: Number(video.nb_read_frames),
    fps:
      Number(video.r_frame_rate.split('/')[0]) /
      Number(video.r_frame_rate.split('/')[1]),
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    width: video.width,
    height: video.height,
  };
}

export function pixel(path: string, frame: number) {
  return [
    ...(run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        path,
        '-vf',
        `select=eq(n\\,${frame}),crop=2:2:100:100`,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1',
      ],
      true,
    ) as Buffer),
  ].slice(0, 3);
}

export function toneEnergy(path: string, start: number, frequency: number) {
  const pcm = run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(start),
      '-i',
      path,
      '-t',
      '0.25',
      '-f',
      'f32le',
      '-ac',
      '1',
      '-ar',
      '48000',
      'pipe:1',
    ],
    true,
  ) as Buffer;
  let real = 0,
    imaginary = 0;
  for (let n = 0; n < pcm.length / 4; n++) {
    const sample = pcm.readFloatLE(n * 4);
    real += sample * Math.cos((2 * Math.PI * frequency * n) / 48000);
    imaginary += sample * Math.sin((2 * Math.PI * frequency * n) / 48000);
  }
  return (real * real + imaginary * imaginary) / (pcm.length / 4) ** 2;
}
