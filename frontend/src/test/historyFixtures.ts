import { createProjectSources } from '../lib/projectSources';
import type { EditSnapshot } from '../lib/editHistory';

export function historySnapshot(ids = ['a', 'b']): EditSnapshot {
  return {
    binSourceIds: [],
    independentAudio: [],
    video2: [],
    musicSourceId: null,
    music: [],
    video1: ids.map((id) => ({
      id,
      sourceId: `source:${id}`,
      trim: { startFrame: 0, endFrame: 59 },
      trimSaved: false,
      speed: 1,
      originalAudio: 'linked',
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

export function advancedFixture() {
  const sources = createProjectSources();
  const base = sources.register(new File(['base'], 'base.mp4'), 'video1');
  const take = sources.register(new File(['take'], 'take.mp4'), 'video2');
  for (const [token, frames] of [
    [base, 150],
    [take, 60],
  ] as const)
    sources.markReady(token, {
      clipMetadata: {
        duration: frames / 25,
        fps: 25,
        totalFrames: frames,
        width: 320,
        height: 180,
        source: 'browser',
      },
    });
  const snapshot = {
    ...historySnapshot([]),
    fpsSelection: '25' as const,
    video1: [
      {
        id: 'base',
        sourceId: base.sourceId,
        trim: { startFrame: 0, endFrame: 149 },
        trimSaved: true,
        speed: 1 as const,
        originalAudio: 'linked' as const,
      },
    ],
    video2: [
      {
        id: 'take',
        sourceId: take.sourceId,
        trim: { startFrame: 0, endFrame: 59 },
        trimSaved: true,
        speed: 1 as const,
        originalAudio: 'linked' as const,
        timelineStartFrame: 40,
        contentInFrame: 0,
        contentOutFrame: 60,
        contentFullSource: false,
      },
    ],
    musicSourceId: null,
    music: [],
  };
  return { sources, snapshot, base, take };
}
