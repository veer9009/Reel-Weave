import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TrimEditor } from './TrimEditor';
import { clip } from '../test/fixtures';
import type { ClipEdit } from '../lib/clips';
it('trim_dialog_contains_focus_and_escape_returns_to_trigger', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const onCancel = vi.fn();
  const { unmount } = render(
    <TrimEditor
      clip={clip() as ClipEdit}
      disabled={false}
      onSave={vi.fn()}
      onCancel={onCancel}
    />,
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  const save = screen.getByRole('button', { name: 'Save trim' });
  save.focus();
  fireEvent.keyDown(save, { key: 'Tab', code: 'Tab' });
  expect(screen.getByRole('button', { name: 'Cancel trim' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledOnce();
  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});
it('invalid_trim_fields_are_associated_with_error', () => {
  render(
    <TrimEditor
      clip={clip() as ClipEdit}
      disabled={false}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Trim start frame'), {
    target: { value: '59' },
  });
  fireEvent.change(screen.getByLabelText('Trim end frame'), {
    target: { value: '0' },
  });
  expect(screen.getByLabelText('Trim start frame')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.getByLabelText('Trim end frame')).toHaveAccessibleDescription(
    /start.*end/i,
  );
});
