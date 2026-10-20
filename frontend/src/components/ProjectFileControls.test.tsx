import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProjectFileControls } from './ProjectFileControls';
import type { ProjectFilesController } from '../hooks/useProjectFiles';
function controller(): ProjectFilesController {
  return {
    saveBusy: false,
    openPhase: 'idle',
    rows: [],
    issue: null,
    unusedFiles: [],
    canConfirm: false,
    save: vi.fn(),
    cancelSave: vi.fn(),
    open: vi.fn(),
    addMedia: vi.fn(),
    chooseCandidate: vi.fn(),
    confirmRename: vi.fn(),
    confirmOpen: vi.fn(),
    cancelOpen: vi.fn(),
    reset: vi.fn(),
  };
}
it('exposes visible Save/Open names and explains disabled controls', () => {
  render(
    <ProjectFileControls
      controller={controller()}
      availability={{
        saveDisabledReason: 'Add media before saving.',
        openDisabledReason: null,
      }}
      workspaceRef={{ current: null }}
    />,
  );
  expect(screen.getByRole('button', { name: 'Save Project' })).toBeDisabled();
  expect(screen.getByText('Add media before saving.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Open Project' })).toBeEnabled();
});
it('allows choosing the same project again by resetting the file input', () => {
  const c = controller();
  render(
    <ProjectFileControls
      controller={c}
      availability={{ saveDisabledReason: null, openDisabledReason: null }}
      workspaceRef={{ current: null }}
    />,
  );
  const input = screen.getByLabelText('Choose project file');
  const file = new File(['{}'], 'edit.avstudio.json');
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.change(input, { target: { files: [file] } });
  expect(c.open).toHaveBeenCalledTimes(2);
  expect((input as HTMLInputElement).value).toBe('');
});
