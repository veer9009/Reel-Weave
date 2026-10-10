import type { EditSnapshot } from '../lib/editHistory';

export function historySnapshot(ids = ['a', 'b']): EditSnapshot {
  return {
    video1: ids.map((id) => ({
      id,
      sourceId: `source:${id}`,
      trim: { startFrame: 0, endFrame: 59 },
      trimSaved: false,
      speed: 1,
    })),
    pip: null,
    audio: {
      originalVolume: 1,
      originalMuted: false,
      musicVolume: 0.3,
      musicMuted: false,
    },
    fpsSelection: '30',
  };
}
