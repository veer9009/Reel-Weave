import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type {
  ProjectFilesController,
  RelinkRow,
} from '../hooks/useProjectFiles';
import './ProjectRelinkDialog.css';
const statusText = {
  missing: 'Missing',
  checking: 'Checking…',
  matched: 'Matched',
  mismatched: 'Mismatched',
  ambiguous: 'Choose a matching file',
  'rename-confirmation': 'Same media, different filename',
  unreadable: 'Could not read',
};
function RelinkSourceRow({
  row,
  index,
  controller,
}: {
  row: RelinkRow;
  index: number;
  controller: ProjectFilesController;
}) {
  const input = useRef<HTMLInputElement>(null);
  const source = row.source;
  const controlName = `Locate file for ${source.originalName}, source ${index + 1}`;
  const errorId = `project-source-error-${index}`;
  const selected = row.accepted?.evidence.file ?? row.candidates[0]?.file;
  return (
    <li className="project-source-row">
      <div>
        <strong className="project-source-name">{source.originalName}</strong>
        <p>
          {source.mediaType} · {source.sizeBytes.toLocaleString()} bytes ·{' '}
          {source.mediaType === 'image'
            ? `${source.metadata.width} × ${source.metadata.height}`
            : `${source.metadata.durationSeconds.toFixed(3)} s`}
        </p>
        <p>
          {row.roles.join(', ')} · {row.occurrenceCount} occurrence
          {row.occurrenceCount === 1 ? '' : 's'}
        </p>
      </div>
      <p className={`project-source-status status-${row.status}`}>
        {statusText[row.status]}
      </p>
      {selected && (
        <p className="project-source-name">Selected: {selected.name}</p>
      )}
      {row.issue && (
        <p id={errorId} className="error-text" role="alert">
          {row.issue.message}
        </p>
      )}
      <button
        type="button"
        className="secondary-button"
        aria-label={controlName}
        aria-describedby={row.issue ? errorId : undefined}
        disabled={controller.openPhase === 'committing'}
        onClick={() => input.current?.click()}
      >
        Locate file
      </button>
      <input
        ref={input}
        hidden
        type="file"
        aria-label={`Choose original for ${source.originalName}, source ${index + 1}`}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void controller.addMedia(files, source.id);
        }}
      />
      {row.status === 'rename-confirmation' && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => controller.confirmRename(source.id)}
        >
          Confirm renamed file for {source.originalName}
        </button>
      )}
      {row.status === 'ambiguous' && (
        <fieldset>
          <legend>Choose the original for {source.originalName}</legend>
          {row.candidates.map((candidate, candidateIndex) => (
            <button
              type="button"
              className="secondary-button"
              key={candidateIndex}
              onClick={() =>
                controller.chooseCandidate(source.id, candidateIndex)
              }
            >
              Use {candidate.file.name}, candidate {candidateIndex + 1}
            </button>
          ))}
        </fieldset>
      )}
    </li>
  );
}
export function ProjectRelinkDialog({
  controller,
  openerRef,
  workspaceRef,
}: {
  controller: ProjectFilesController;
  openerRef: RefObject<HTMLButtonElement | null>;
  workspaceRef: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    media = useRef<HTMLInputElement>(null),
    choose = useRef<HTMLButtonElement>(null),
    project = useRef<HTMLInputElement>(null);
  const previouslyOpen = useRef(false),
    relinkFocused = useRef(false),
    succeeded = useRef(false);
  const phase = controller.openPhase,
    open = phase !== 'idle',
    busy = phase === 'reading' || phase === 'committing';
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (!element.open) {
        element.showModal();
        previouslyOpen.current = true;
        succeeded.current = false;
        heading.current?.focus();
      }
      if (!busy && phase !== 'failed' && !relinkFocused.current) {
        choose.current?.focus();
        relinkFocused.current = true;
      }
    } else if (previouslyOpen.current) {
      element.close();
      previouslyOpen.current = false;
      relinkFocused.current = false;
      if (succeeded.current) workspaceRef.current?.focus();
      else openerRef.current?.focus();
    }
  }, [open, busy, phase, openerRef, workspaceRef]);
  return (
    <dialog
      ref={dialog}
      className="project-relink-dialog"
      aria-labelledby="project-relink-title"
      aria-describedby="project-relink-instructions"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy || phase === 'reading') controller.cancelOpen();
      }}
    >
      <h2 id="project-relink-title" tabIndex={-1} ref={heading}>
        Open Project
      </h2>
      <p id="project-relink-instructions">
        Select the original media files. Your current project will be replaced
        only after all files are matched.
      </p>
      {phase === 'reading' && (
        <p role="status" aria-busy="true">
          Reading and validating project…
        </p>
      )}
      {controller.issue && <p role="alert">{controller.issue.message}</p>}
      {phase === 'failed' ? (
        <>
          <button
            type="button"
            className="secondary-button"
            onClick={() => project.current?.click()}
          >
            Choose another project
          </button>
          <input
            ref={project}
            type="file"
            hidden
            accept=".avstudio.json,application/json"
            aria-label="Choose another project file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void controller.open(file);
            }}
          />
        </>
      ) : (
        phase !== 'reading' && (
          <>
            <div className="project-relink-picker">
              <button
                type="button"
                ref={choose}
                className="secondary-button"
                disabled={busy}
                onClick={() => media.current?.click()}
              >
                Choose media files
              </button>
              <input
                ref={media}
                type="file"
                multiple
                hidden
                aria-label="Choose project media files"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length) void controller.addMedia(files);
                }}
              />
            </div>
            <p role="status" aria-live="polite">
              {controller.rows.filter((row) => row.status === 'matched').length}{' '}
              of {controller.rows.length} sources matched
            </p>
            <ul
              className="project-relink-sources"
              aria-label="Required project media"
              aria-busy={phase === 'checking'}
            >
              {controller.rows.map((row, index) => (
                <RelinkSourceRow
                  key={row.source.id}
                  row={row}
                  index={index}
                  controller={controller}
                />
              ))}
            </ul>
            {controller.unusedFiles.length > 0 && (
              <div>
                <p>Not used by this project:</p>
                <ul>
                  {controller.unusedFiles.map((file, index) => (
                    <li key={index} className="project-source-name">
                      {file.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {controller.issue && (
              <button
                type="button"
                className="text-button"
                onClick={() => void controller.addMedia([])}
              >
                Retry validation
              </button>
            )}
          </>
        )
      )}
      <div className="project-relink-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={phase === 'committing'}
          onClick={() => controller.cancelOpen()}
        >
          {phase === 'failed' ? 'Close' : 'Cancel'}
        </button>
        {phase !== 'failed' && (
          <button
            type="button"
            className="primary-button"
            disabled={!controller.canConfirm || busy}
            onClick={() => {
              const result = controller.confirmOpen();
              if (result.ok) succeeded.current = true;
            }}
          >
            Open Project
          </button>
        )}
      </div>
    </dialog>
  );
}
