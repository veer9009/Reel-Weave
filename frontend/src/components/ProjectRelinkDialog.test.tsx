import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProjectRelinkDialog } from './ProjectRelinkDialog';
import type { ProjectFilesController } from '../hooks/useProjectFiles';
import { createProjectDocumentFixture } from '../test/projectFileFixtures';
it('lists missing media, labels row controls and blocks confirmation', () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  const c: ProjectFilesController = {
    saveBusy: false,
    openPhase: 'relinking',
    rows: [
      {
        source: createProjectDocumentFixture().sources[0],
        roles: ['video1'],
        occurrenceCount: 1,
        status: 'missing',
        candidates: [],
        accepted: null,
        issue: null,
      },
    ],
    unusedFiles: [],
    issue: null,
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
  render(
    <ProjectRelinkDialog
      controller={c}
      openerRef={{ current: null }}
      workspaceRef={{ current: null }}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: 'Open Project' });
  expect(within(dialog).getByText('base.mp4')).toBeVisible();
  expect(within(dialog).getByText('Missing')).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: 'Open Project' }),
  ).toBeDisabled();
  expect(
    within(dialog).getByRole('button', {
      name: 'Locate file for base.mp4, source 1',
    }),
  ).toBeEnabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(c.cancelOpen).toHaveBeenCalledTimes(1);
});
