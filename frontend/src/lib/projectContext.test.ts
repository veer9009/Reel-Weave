import { expect, it } from 'vitest';
import {
  createHistory,
  commitHistory,
  commitProjectReplacement,
  rebaseHistory,
  redoHistory,
  undoHistory,
} from './editHistory';
import { createProjectContext } from './projectContext';
import { historySnapshot } from '../test/historyFixtures';
it('keeps Open as one replacement entry including external context', () => {
  const a = {
    ...historySnapshot(['a']),
    projectContext: createProjectContext(),
  };
  const b = {
    ...historySnapshot(['b']),
    projectContext: {
      ...createProjectContext(),
      exportFormats: ['mp4', 'wav'] as const,
    },
  };
  const opened = commitProjectReplacement(createHistory(a), b);
  expect(opened.past).toHaveLength(1);
  expect(opened.past[0].label).toBe('Open Project');
  expect(undoHistory(opened).present).toEqual(a);
  expect(redoHistory(undoHistory(opened)).present).toEqual(b);
});
it('scopes rebases to one incarnation including sides of replacement entries', () => {
  const a = {
    ...historySnapshot(['a']),
    projectContext: createProjectContext(),
  };
  const b = {
    ...historySnapshot(['b']),
    projectContext: createProjectContext(),
  };
  const opened = commitProjectReplacement(createHistory(a), b);
  const rebased = rebaseHistory(
    opened,
    (s) => ({ ...s, fpsSelection: '60' }),
    false,
    b.projectContext.incarnationId,
  );
  expect(rebased.present.fpsSelection).toBe('60');
  expect(rebased.past[0].before).toEqual(a);
});
it('context mirroring does not make ordinary external settings undoable', () => {
  const a = {
    ...historySnapshot(['a']),
    projectContext: createProjectContext(),
  };
  const changed = {
    ...a,
    projectContext: {
      ...a.projectContext,
      exportFormats: ['mp4', 'wav'] as const,
    },
  };
  expect(
    commitHistory(createHistory(a), 'audio-volume', 'Volume', changed).past,
  ).toHaveLength(0);
});
