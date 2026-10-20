import type { ProjectDocumentV1 } from '../lib/projectFileTypes';
export function createProjectDocumentFixture(): ProjectDocumentV1 {
  return {
    format: 'avstudio-project',
    schemaVersion: 1,
    sources: [
      {
        id: 'source_base',
        originalName: 'base.mp4',
        sizeBytes: 3,
        mimeType: 'video/mp4',
        lastModifiedMs: 0,
        sha256:
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        mediaType: 'video',
        metadata: {
          durationSeconds: 2,
          width: 320,
          height: 180,
          clipMetadata: {
            duration: 2,
            fps: 30,
            totalFrames: 60,
            width: 320,
            height: 180,
            origin: 'browser',
          },
        },
      },
    ],
    edit: {
      binSourceIds: [],
      video1: [
        {
          id: 'occ_base',
          sourceId: 'source_base',
          trim: { startFrame: 0, endFrame: 59 },
          trimSaved: true,
          speed: 1,
          originalAudio: 'linked',
        },
      ],
      video2: [],
      musicSourceId: null,
      music: [],
      independentAudio: [],
      pip: null,
      audio: {
        originalVolume: 1,
        originalMuted: false,
        musicVolume: 0.3,
        musicMuted: false,
      },
      fpsSelection: '30',
    },
    imageOverlay: null,
    exportSettings: { formats: ['mp4'] },
    timingFps: 30,
  };
}
export function createFullProjectDocumentFixture(): ProjectDocumentV1 {
  const d = createProjectDocumentFixture(),
    base = d.sources[0];
  d.sources.push({ ...base, id: 'source_take', originalName: 'take.mp4' });
  d.sources.push({
    id: 'source_voice',
    originalName: 'voice.wav',
    sizeBytes: 3,
    mimeType: 'audio/wav',
    lastModifiedMs: 0,
    sha256: base.sha256,
    mediaType: 'audio',
    metadata: { durationSeconds: 8, sampleCount: 384000 },
  });
  d.sources.push({
    id: 'source_image',
    originalName: 'logo.png',
    sizeBytes: 3,
    mimeType: 'image/png',
    lastModifiedMs: 0,
    sha256: base.sha256,
    mediaType: 'image',
    metadata: { width: 32, height: 32 },
  });
  d.sources.push({
    id: 'source_unused',
    originalName: 'unused.wav',
    sizeBytes: 3,
    mimeType: 'audio/wav',
    lastModifiedMs: 0,
    sha256: base.sha256,
    mediaType: 'audio',
    metadata: { durationSeconds: 8, sampleCount: 384000 },
  });
  d.edit.binSourceIds = ['source_unused', 'source_take'];
  d.edit.video1 = [
    {
      id: 'occ_left',
      sourceId: base.id,
      trim: { startFrame: 0, endFrame: 29 },
      trimSaved: true,
      speed: 1,
      originalAudio: 'detached',
      outputWindow: { outputInFrame: 0, outputOutFrame: 30 },
    },
    {
      id: 'occ_right',
      sourceId: base.id,
      trim: { startFrame: 30, endFrame: 59 },
      trimSaved: true,
      speed: 0.5,
      originalAudio: 'linked',
    },
  ];
  d.edit.video2 = [
    {
      id: 'occ_take',
      sourceId: 'source_take',
      trim: { startFrame: 0, endFrame: 29 },
      trimSaved: true,
      speed: 0.75,
      originalAudio: 'detached',
      timelineStartFrame: 20,
      contentInFrame: 10,
      contentOutFrame: 25,
      contentFullSource: false,
    },
  ];
  d.edit.pip = {
    id: 'occ_pip',
    sourceId: base.id,
    startFrame: 5,
    endFrame: 19,
    position: 'bottom-right',
    size: 'medium',
  };
  d.imageOverlay = {
    id: 'occ_image',
    sourceId: 'source_image',
    startFrame: 0,
    endFrame: 39,
    position: 'top-right',
    size: 'small',
  };
  d.edit.musicSourceId = 'source_voice';
  d.edit.music = [
    {
      id: 'music_a',
      sourceId: 'source_voice',
      timelineStartFrame: 5,
      sourceStartSample: 4800,
      durationFrames: 15,
    },
    {
      id: 'music_b',
      sourceId: 'source_voice',
      timelineStartFrame: 40,
      sourceStartSample: 48000,
      durationFrames: 20,
    },
  ];
  d.edit.independentAudio = [
    {
      id: 'audio_frozen',
      timelineStartFrame: 0,
      sourceStartSample: 9600,
      durationFrames: 30,
      source: {
        kind: 'video-edit',
        sourceId: 'source_take',
        sourceStartFrame: 0,
        sourceEndFrame: 59,
        speed: 0.5,
        normalizationFps: 30,
      },
      detachedFrom: { track: 'video2', clipId: 'deleted_origin' },
    },
    {
      id: 'audio_file',
      timelineStartFrame: 30,
      sourceStartSample: 0,
      durationFrames: 10,
      source: { kind: 'audio-file', sourceId: 'source_voice' },
    },
  ];
  d.edit.audio = {
    originalVolume: 0.65,
    originalMuted: false,
    musicVolume: 0.2,
    musicMuted: true,
  };
  d.edit.fpsSelection = 'auto';
  d.exportSettings.formats = ['mp4', 'mov', 'wav', 'mp3'];
  return d;
}
