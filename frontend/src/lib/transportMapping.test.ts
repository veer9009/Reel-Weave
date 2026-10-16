import { expect, it } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { buildAdvancedTimeline } from './advancedTimeline';
import { mapTransportAnchor } from './transportMapping';
import type { TransportAnchor, TransportEdit } from './transportMapping';
const anchor = (frame: number): TransportAnchor => ({
  frame,
  projectSeconds: frame / 25,
  playingIntent: true,
  occurrenceId: 'base',
  sourceId: '',
  sourceTime: frame / 25,
});
it('version_replacement_follows_the_target_when_an_earlier_donor_is_consumed', () => {
  const f = setup(),
    a = f.before.base.items[0];
  const before = {
    ...f.before,
    base: {
      ...f.before.base,
      totalFrames: 300,
      items: [
        { ...a, clip: { ...a.clip, id: 'donor' } },
        { ...a, startFrame: 150, endFrame: 299 },
      ],
    },
  };
  const after = {
    ...f.before,
    base: {
      ...f.before.base,
      items: [
        { ...a, frameCount: 50, endFrame: 49 },
        {
          ...a,
          clip: { ...a.clip, id: 'replacement' },
          startFrame: 50,
          endFrame: 149,
          frameCount: 100,
        },
      ],
    },
  };
  expect(
    mapTransportAnchor(
      { ...anchor(180), sourceTime: 1.2 },
      { ...f.edit, before, after, action: 'version-replace' },
    ),
  ).toEqual({ frame: 30, playingIntent: true });
});
it('absolute_edits_preserve_elapsed_time_between_project_ticks', () => {
  const f = setup(),
    live = { ...anchor(20), projectSeconds: 0.82, sourceTime: 0.82 };
  expect(
    mapTransportAnchor(live, { ...f.edit, action: 'detach-audio' }).frame,
  ).toBeCloseTo(20.5, 5);
});
function setup() {
  const f = advancedFixture(),
    before = buildAdvancedTimeline({ ...f.snapshot, video2: [] }, f.sources, {
      image: null,
      video: null,
    });
  return {
    ...f,
    before,
    edit: {
      token: 1,
      before,
      after: before,
      action: 'split',
      lineage: new Map(),
    } as TransportEdit,
  };
}
it('split_overwrite_and_audio_changes_keep_absolute_frame_and_intent', () => {
  const f = setup();
  for (const action of [
    'overwrite',
    'detach-audio',
    'independent-move',
    'music-ripple-delete',
    'video2-add',
  ] as const)
    expect(mapTransportAnchor(anchor(73), { ...f.edit, action })).toEqual({
      frame: 73,
      playingIntent: true,
    });
});
it('reorder_follows_occurrence_and_ripple_maps_inside_to_splice_or_EOF', () => {
  const f = setup(),
    a = f.before.base.items[0],
    before = {
      ...f.before,
      base: {
        ...f.before.base,
        items: [
          { ...a, endFrame: 49, frameCount: 50 },
          {
            ...a,
            clip: { ...a.clip, id: 'b' },
            startFrame: 50,
            endFrame: 149,
            frameCount: 100,
          },
        ],
      },
    };
  const after = {
    ...before,
    base: {
      ...before.base,
      items: [
        { ...before.base.items[1], startFrame: 0, endFrame: 99 },
        { ...before.base.items[0], startFrame: 100, endFrame: 149 },
      ],
    },
  };
  expect(
    mapTransportAnchor(anchor(20), {
      ...f.edit,
      before,
      after,
      action: 'reorder',
    }),
  ).toEqual({ frame: 120, playingIntent: true });
  const removed = {
    ...before,
    base: {
      ...before.base,
      totalFrames: 100,
      items: [{ ...before.base.items[1], startFrame: 0, endFrame: 99 }],
    },
  };
  expect(
    mapTransportAnchor(
      { ...anchor(80), occurrenceId: 'b' },
      { ...f.edit, before, after: removed, action: 'ripple-delete' },
    ),
  ).toEqual({ frame: 30, playingIntent: true });
  expect(
    mapTransportAnchor(anchor(20), {
      ...f.edit,
      before,
      after: removed,
      action: 'ripple-delete',
    }),
  ).toEqual({ frame: 0, playingIntent: true });
  const tail = {
    ...before,
    base: { ...before.base, totalFrames: 50, items: [before.base.items[0]] },
  };
  expect(
    mapTransportAnchor(
      { ...anchor(80), occurrenceId: 'b' },
      { ...f.edit, before, after: tail, action: 'ripple-delete' },
    ),
  ).toEqual({ frame: 49, playingIntent: false });
});
it('fps_changes_preserve_live_seconds_and_empty_projects_pause', () => {
  const f = setup();
  expect(
    mapTransportAnchor(
      { ...anchor(20), projectSeconds: 0.82 },
      {
        ...f.edit,
        action: 'fps',
        after: {
          ...f.before,
          base: { ...f.before.base, fps: 60, totalFrames: 360 },
        },
      },
    ),
  ).toEqual({ frame: 49, playingIntent: true });
  expect(
    mapTransportAnchor(anchor(20), {
      ...f.edit,
      after: {
        ...f.before,
        base: { ...f.before.base, status: 'empty', totalFrames: 0 },
      },
    }),
  ).toEqual({ frame: null, playingIntent: false });
});
it('legacy_split_maps_live_source_time_into_derived_fragments_and_undo_uses_source_lineage', () => {
  const f = setup(),
    a = f.before.base.items[0];
  const after = {
    ...f.before,
    base: {
      ...f.before.base,
      items: [
        {
          ...a,
          clip: {
            ...a.clip,
            id: 'left',
            trim: { startFrame: 0, endFrame: 49 },
          },
          endFrame: 49,
          frameCount: 50,
        },
        {
          ...a,
          clip: {
            ...a.clip,
            id: 'right',
            trim: { startFrame: 50, endFrame: 149 },
          },
          startFrame: 50,
          frameCount: 100,
        },
      ],
    },
  };
  const edit = {
    ...f.edit,
    after,
    lineage: new Map([
      ['left', 'base'],
      ['right', 'base'],
    ]),
  };
  expect(
    mapTransportAnchor({ ...anchor(73), sourceId: f.base.sourceId }, edit),
  ).toEqual({ frame: 73, playingIntent: true });
  expect(
    mapTransportAnchor(
      {
        ...anchor(73),
        occurrenceId: 'right',
        sourceId: f.base.sourceId,
        playingIntent: false,
      },
      { ...edit, before: after, after: f.before, action: 'undo' },
    ),
  ).toEqual({ frame: 73, playingIntent: false });
});
