import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TimelinePlacementDialog } from './TimelinePlacementDialog';
import { clip } from '../test/fixtures';
it('overlong_candidate_stays_explicit_and_Escape_cancels', () => {
  const save = vi.fn(() => false),
    cancel = vi.fn();
  const source = clip('take');
  render(
    <TimelinePlacementDialog
      name="take.mp4"
      metadata={source.metadata}
      startFrame={140}
      disabled={false}
      onSave={save}
      onCancel={cancel}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save replacement' }));
  expect(save).toHaveBeenCalledWith({ timelineStartFrame: 140 });
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.keyDown(screen.getByLabelText('Replacement start frame'), {
    key: 'Escape',
  });
  expect(cancel).toHaveBeenCalledOnce();
});
