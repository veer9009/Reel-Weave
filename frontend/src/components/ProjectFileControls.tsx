import { useRef } from 'react';
import type { RefObject } from 'react';
import type {
  ProjectFileAvailability,
  ProjectFilesController,
} from '../hooks/useProjectFiles';
import { ProjectRelinkDialog } from './ProjectRelinkDialog';
export function ProjectFileControls({
  controller,
  availability,
  workspaceRef,
}: {
  controller: ProjectFilesController;
  availability: ProjectFileAvailability;
  workspaceRef: RefObject<HTMLElement | null>;
}) {
  const input = useRef<HTMLInputElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const openBusy = controller.openPhase !== 'idle';
  const busyReason = controller.saveBusy
    ? 'Preparing project file…'
    : openBusy
      ? 'Finish or cancel Open Project.'
      : null;
  const saveReason = busyReason ?? availability.saveDisabledReason;
  const openReason = busyReason ?? availability.openDisabledReason;
  return (
    <div className="project-file-controls" aria-label="Project files">
      <div
        className="project-file-buttons"
        aria-busy={controller.saveBusy || openBusy}
      >
        <button
          type="button"
          className="secondary-button"
          onClick={() => void controller.save()}
          disabled={Boolean(saveReason)}
          aria-describedby="project-save-reason"
        >
          Save Project
        </button>
        <button
          type="button"
          className="secondary-button"
          ref={opener}
          onClick={() => input.current?.click()}
          disabled={Boolean(openReason)}
          aria-describedby={
            openReason === saveReason
              ? 'project-save-reason'
              : 'project-open-reason'
          }
        >
          Open Project
        </button>
        {controller.saveBusy && (
          <button
            type="button"
            className="text-button"
            onClick={() => controller.cancelSave()}
          >
            Cancel Save
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept=".avstudio.json,application/json"
        aria-label="Choose project file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void controller.open(file);
        }}
      />
      <small id="project-save-reason">{saveReason}</small>
      <small id="project-open-reason">
        {openReason !== saveReason ? openReason : null}
      </small>
      {controller.issue && !openBusy && (
        <p role="alert">
          Could not save project: {controller.issue.message} Try again.
        </p>
      )}
      <ProjectRelinkDialog
        controller={controller}
        openerRef={opener}
        workspaceRef={workspaceRef}
      />
    </div>
  );
}
