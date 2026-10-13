import { render, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { advancedFixture } from '../test/historyFixtures';
import { PositionedClipEditor } from './PositionedClipEditor';
it('numeric_range_Save_is_one_complete_explicit_edit', () => {
  const f = advancedFixture(),
    save = vi.fn(() => true);
  render(
    <PositionedClipEditor
      track="video2"
      item={f.snapshot.video2[0]}
      name="take.mp4"
      fps={25}
      disabled={false}
      onSave={save}
      onSourceEdit={() => true}
    />,
  );
  fireEvent.change(screen.getByLabelText('Timeline start frame'), {
    target: { value: '45' },
  });
  fireEvent.change(screen.getByLabelText('Content out frame (exclusive)'), {
    target: { value: '55' },
  });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save timeline range' }));
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      timelineStartFrame: 45,
      contentOutFrame: 55,
      contentFullSource: false,
    }),
  );
});
