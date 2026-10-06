import type { Clip } from '../lib/clips';
import type { OverlayState } from '../lib/overlays';
export function clip(id = 'a', fps = 30, speed: 1 | 0.5 | 0.75 = 1): Clip {
  return {
    id,
    file: new File(['video'], `${id}.mp4`),
    url: `blob:${id}`,
    metadataStatus: 'ready',
    metadata: {
      duration: 2,
      fps,
      totalFrames: 60,
      width: 1280,
      height: 720,
      source: 'browser',
    },
    trim: { startFrame: 0, endFrame: 59 },
    trimSaved: false,
    speed,
  };
}
export const overlays: OverlayState = {
  image: {
    kind: 'image',
    file: new File(['image'], 'logo.png'),
    url: 'blob:image',
    metadataStatus: 'ready',
    startFrame: 10,
    endFrame: 49,
    position: 'top-right',
    size: 'small',
  },
  video: {
    kind: 'video',
    file: new File(['pip'], 'pip.mp4'),
    url: 'blob:pip',
    metadataStatus: 'ready',
    startFrame: 10,
    endFrame: 49,
    position: 'bottom-right',
    size: 'medium',
    duration: 0.4,
  },
};
