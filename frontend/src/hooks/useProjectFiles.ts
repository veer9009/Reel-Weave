import { useEffect, useState } from 'react';
import type { EditHistoryController } from './useEditHistory';
import type { Limits } from '../lib/clips';
import type { PreparedProject, ProjectOpenLock } from '../lib/projectContext';
import { collectSnapshotSources } from '../lib/projectContext';
import {
  createProjectDownload,
  prepareRelinkedProject,
  projectSourceRoles,
  serializeProjectCapture,
} from '../lib/projectFile';
import type { AcceptedRelink } from '../lib/projectFile';
import {
  readProjectFile,
  stringifyProjectDocument,
} from '../lib/projectFileJson';
import {
  checkRelinkCandidate,
  checkRelinkFileBasics,
  createProjectMediaVerifier,
} from '../lib/projectMedia';
import type {
  CandidateEvidence,
  ProjectMediaVerifier,
} from '../lib/projectMedia';
import { projectFailure } from '../lib/projectFileTypes';
import type {
  ProjectDocumentV1,
  ProjectIssue,
  ProjectResult,
  ProjectSourceV1,
} from '../lib/projectFileTypes';
import type { SourceKind } from '../lib/projectSources';

export type ProjectOpenPhase =
  | 'idle'
  | 'reading'
  | 'relinking'
  | 'checking'
  | 'ready'
  | 'committing'
  | 'failed';
export type RelinkRowStatus =
  | 'missing'
  | 'checking'
  | 'matched'
  | 'mismatched'
  | 'ambiguous'
  | 'rename-confirmation'
  | 'unreadable';
export type RelinkRow = {
  source: ProjectSourceV1;
  roles: readonly SourceKind[];
  occurrenceCount: number;
  status: RelinkRowStatus;
  candidates: readonly CandidateEvidence[];
  accepted: AcceptedRelink | null;
  issue: ProjectIssue | null;
};
export type ProjectFileAvailability = {
  saveDisabledReason: string | null;
  openDisabledReason: string | null;
};
export type UseProjectFilesOptions = {
  history: EditHistoryController;
  limits: Limits;
  availability: ProjectFileAvailability;
  onOpened: () => void;
  onAnnounce: (message: string) => void;
};
export type ProjectFilesController = {
  readonly saveBusy: boolean;
  readonly openPhase: ProjectOpenPhase;
  readonly rows: readonly RelinkRow[];
  readonly issue: ProjectIssue | null;
  readonly unusedFiles: readonly File[];
  readonly canConfirm: boolean;
  save(): Promise<void>;
  cancelSave(): void;
  open(file: File): Promise<void>;
  addMedia(files: readonly File[], sourceId?: string): Promise<void>;
  chooseCandidate(sourceId: string, candidateIndex: number): void;
  confirmRename(sourceId: string): void;
  confirmOpen(): ProjectResult<void>;
  cancelOpen(): void;
  reset(): void;
};
function createController(initial: UseProjectFilesOptions, notify: () => void) {
  let options = initial,
    mounted = true,
    phase: ProjectOpenPhase = 'idle',
    rows: RelinkRow[] = [],
    issue: ProjectIssue | null = null;
  let unused: File[] = [],
    document: ProjectDocumentV1 | null = null,
    prepared: PreparedProject | null = null,
    lock: ProjectOpenLock | null = null;
  let generation = 0,
    saveGeneration = 0,
    saveBusy = false,
    openAbort = new AbortController(),
    saveAbort: AbortController | null = null;
  let releaseSave: (() => void) | null = null,
    verifier: ProjectMediaVerifier | null = null,
    download: ReturnType<typeof createProjectDownload> | null = null;
  const rowGenerations = new Map<string, number>();
  const rowAborts = new Map<string, AbortController>();
  const change = () => {
    if (mounted) notify();
  };
  const media = () => (verifier ??= createProjectMediaVerifier());
  const discardPrepared = () => {
    prepared?.dispose();
    prepared = null;
  };
  const updateRow = (sourceId: string, patch: Partial<RelinkRow>) => {
    rows = rows.map((r) => (r.source.id === sourceId ? { ...r, ...patch } : r));
  };
  const accepted = () =>
    new Map(
      rows.flatMap((r) =>
        r.accepted ? [[r.source.id, r.accepted] as const] : [],
      ),
    );
  const settle = () => {
    if (
      !document ||
      phase === 'idle' ||
      phase === 'reading' ||
      phase === 'failed' ||
      phase === 'committing'
    )
      return;
    discardPrepared();
    if (rows.some((r) => r.status === 'checking')) phase = 'checking';
    else if (rows.every((r) => r.status === 'matched' && r.accepted)) {
      const result = prepareRelinkedProject(
        document,
        accepted(),
        options.limits,
        () => crypto.randomUUID(),
      );
      if (result.ok) {
        prepared = result.value;
        phase = 'ready';
        issue = null;
      } else {
        phase = 'relinking';
        issue = result.issue;
      }
    } else phase = 'relinking';
    options.onAnnounce(
      `${rows.filter((r) => r.status === 'matched').length} of ${rows.length} sources matched.`,
    );
    change();
  };
  const selectEvidence = (sourceId: string, evidence: CandidateEvidence) => {
    const row = rows.find((r) => r.source.id === sourceId);
    if (!row) return;
    const result = checkRelinkCandidate(
      row.source,
      evidence,
      options.limits,
      new Set(row.roles),
    );
    if (!result.ok) {
      updateRow(sourceId, {
        status: 'mismatched',
        issue: result.issue,
        accepted: null,
      });
      return;
    }
    updateRow(sourceId, {
      status: result.value.renamed ? 'rename-confirmation' : 'matched',
      accepted: result.value.renamed
        ? null
        : { sourceId, evidence, renamedConfirmed: false },
      candidates: [evidence],
      issue: null,
    });
  };
  const api = {
    configure(next: UseProjectFilesOptions) {
      options = next;
    },
    mount() {
      mounted = true;
    },
    dispose() {
      mounted = false;
      api.reset();
    },
    get saveBusy() {
      return saveBusy;
    },
    get openPhase() {
      return phase;
    },
    get rows() {
      return rows;
    },
    get issue() {
      return issue;
    },
    get unusedFiles() {
      return unused;
    },
    get canConfirm() {
      return phase === 'ready' && prepared !== null;
    },
    async save() {
      if (
        saveBusy ||
        phase !== 'idle' ||
        options.availability.saveDisabledReason
      )
        return;
      const run = ++saveGeneration;
      saveBusy = true;
      issue = null;
      const abort = new AbortController();
      saveAbort = abort;
      const lease = options.history.sources.acquireLease(
        `project-save-${run}`,
        collectSnapshotSources(options.history.history.present),
      );
      releaseSave = lease;
      options.onAnnounce('Preparing project file…');
      change();
      try {
        const capture = options.history.captureProject(new Date());
        const result = await serializeProjectCapture(
          capture,
          media(),
          options.limits,
          abort.signal,
        );
        if (run !== saveGeneration || !mounted || abort.signal.aborted) return;
        if (!result.ok) {
          issue = result.issue;
          return;
        }
        const json = stringifyProjectDocument(result.value, options.limits);
        if (!json.ok) {
          issue = json.issue;
          return;
        }
        const requested = (download ??= createProjectDownload()).request(
          json.value,
          capture.capturedAt,
        );
        if (!requested.ok) issue = requested.issue;
        else
          options.onAnnounce(
            'Project file download requested. Keep your original media files to reopen it.',
          );
      } catch {
        if (run === saveGeneration)
          issue = {
            code: 'resource',
            message:
              'Could not save project: metadata or local media is unavailable. Try again.',
          };
      } finally {
        lease();
        if (run === saveGeneration) {
          saveBusy = false;
          saveAbort = null;
          releaseSave = null;
          change();
        }
      }
    },
    cancelSave() {
      ++saveGeneration;
      saveAbort?.abort();
      saveAbort = null;
      releaseSave?.();
      releaseSave = null;
      saveBusy = false;
      change();
    },
    async open(file: File) {
      if (saveBusy || options.availability.openDisabledReason) return;
      api.cancelOpen();
      lock = options.history.acquireProjectOpenLock();
      if (!lock) {
        issue = {
          code: 'resource',
          message:
            'Finish or cancel the current operation before opening a project.',
        };
        change();
        return;
      }
      const run = ++generation;
      openAbort = new AbortController();
      phase = 'reading';
      issue = null;
      change();
      const result = await readProjectFile(
        file,
        options.limits,
        openAbort.signal,
      );
      if (run !== generation || !mounted) return;
      if (!result.ok) {
        phase = 'failed';
        issue = result.issue;
        change();
        return;
      }
      document = result.value;
      const roles = projectSourceRoles(document);
      const e = document.edit;
      rows = document.sources.map((source) => ({
        source,
        roles: [...(roles.get(source.id) ?? [])],
        occurrenceCount: [
          ...e.video1,
          ...e.video2,
          ...e.music,
          ...e.independentAudio.map((v) => ({ sourceId: v.source.sourceId })),
          ...(e.pip ? [e.pip] : []),
          ...(document!.imageOverlay ? [document!.imageOverlay] : []),
        ].filter((v) => v.sourceId === source.id).length,
        status: 'missing',
        candidates: [],
        accepted: null,
        issue: null,
      }));
      phase = 'relinking';
      change();
    },
    async addMedia(files: readonly File[], sourceId?: string) {
      if (
        !document ||
        phase === 'reading' ||
        phase === 'failed' ||
        phase === 'idle' ||
        phase === 'committing'
      )
        return;
      const run = generation;
      const signal = openAbort.signal;
      discardPrepared();
      issue = null;
      const targets = rows.filter((r) =>
        sourceId
          ? r.source.id === sourceId
          : files.some(
              (f) =>
                f.name === r.source.originalName ||
                f.size === r.source.sizeBytes,
            ),
      );
      const work = targets.map((row) => {
        rowAborts.get(row.source.id)?.abort();
        const abort = new AbortController(),
          onAbort = () => abort.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        rowAborts.set(row.source.id, abort);
        const serial = (rowGenerations.get(row.source.id) ?? 0) + 1;
        rowGenerations.set(row.source.id, serial);
        updateRow(row.source.id, {
          status: 'checking',
          accepted: null,
          issue: null,
        });
        return { row, serial, abort, onAbort };
      });
      const used = new Set<File>();
      phase = work.length ? 'checking' : 'relinking';
      change();
      for (const { row, serial, abort, onAbort } of work) {
        const candidates = sourceId ? [] : [...row.candidates];
        let failure: ProjectIssue | null = null;
        for (const file of files) {
          if (
            run !== generation ||
            signal.aborted ||
            abort.signal.aborted ||
            rowGenerations.get(row.source.id) !== serial
          )
            break;
          const basics = checkRelinkFileBasics(
            row.source,
            file,
            options.limits,
            new Set(row.roles),
          );
          if (!basics.ok) {
            failure = basics.issue;
            continue;
          }
          const hash = await media().fingerprint(file, abort.signal);
          if (!hash.ok) {
            failure = hash.issue;
            continue;
          }
          if (hash.value !== row.source.sha256) {
            failure = {
              code: 'media',
              message: 'Fingerprint does not match the original media.',
            };
            continue;
          }
          const metadata = await media().inspect(
            file,
            row.source.mediaType,
            abort.signal,
          );
          if (!metadata.ok) {
            failure = metadata.issue;
            continue;
          }
          const evidence = {
            file,
            sha256: hash.value,
            metadata: metadata.value,
          };
          const checked = checkRelinkCandidate(
            row.source,
            evidence,
            options.limits,
            new Set(row.roles),
          );
          if (!checked.ok) {
            failure = checked.issue;
            continue;
          }
          if (!candidates.some((c) => c.file === file))
            candidates.push(evidence);
          used.add(file);
        }
        signal.removeEventListener('abort', onAbort);
        if (rowAborts.get(row.source.id) === abort)
          rowAborts.delete(row.source.id);
        if (
          run !== generation ||
          signal.aborted ||
          abort.signal.aborted ||
          rowGenerations.get(row.source.id) !== serial
        )
          continue;
        if (candidates.length > 1)
          updateRow(row.source.id, {
            status: 'ambiguous',
            candidates,
            accepted: null,
            issue: null,
          });
        else if (candidates.length === 1)
          selectEvidence(row.source.id, candidates[0]);
        else
          updateRow(row.source.id, {
            status: failure
              ? failure.code === 'cancelled'
                ? 'missing'
                : 'mismatched'
              : 'missing',
            candidates: [],
            accepted: null,
            issue: failure,
          });
      }
      if (
        run !== generation ||
        signal.aborted ||
        (work.length > 0 &&
          !work.some((w) => rowGenerations.get(w.row.source.id) === w.serial))
      )
        return;
      unused = [
        ...new Set([...unused, ...files.filter((f) => !used.has(f))]),
      ].filter((f) => !used.has(f));
      settle();
    },
    chooseCandidate(sourceId: string, candidateIndex: number) {
      if (phase === 'committing') return;
      const row = rows.find((r) => r.source.id === sourceId);
      const evidence = row?.candidates[candidateIndex];
      if (evidence) {
        selectEvidence(sourceId, evidence);
        settle();
      }
    },
    confirmRename(sourceId: string) {
      if (phase === 'committing') return;
      const row = rows.find((r) => r.source.id === sourceId);
      const evidence = row?.candidates[0];
      if (row?.status === 'rename-confirmation' && evidence) {
        updateRow(sourceId, {
          status: 'matched',
          accepted: { sourceId, evidence, renamedConfirmed: true },
        });
        settle();
      }
    },
    confirmOpen(): ProjectResult<void> {
      if (phase !== 'ready' || !prepared || !lock || !document)
        return projectFailure(
          'invalid',
          'Relink every required source before opening.',
        );
      if (options.availability.openDisabledReason)
        return projectFailure(
          'resource',
          options.availability.openDisabledReason,
        );
      const candidate = prepared;
      phase = 'committing';
      change();
      const result = lock.replace(candidate);
      if (!result.ok) {
        issue = result.issue;
        phase = 'ready';
        change();
        return result;
      }
      const count = rows.length;
      candidate.dispose();
      prepared = null;
      lock.release();
      lock = null;
      ++generation;
      openAbort.abort();
      rows = [];
      document = null;
      unused = [];
      issue = null;
      phase = 'idle';
      options.onOpened();
      options.onAnnounce(
        `Project opened. ${count} sources linked. Undo is available.`,
      );
      change();
      return result;
    },
    cancelOpen() {
      if (phase === 'committing') return;
      ++generation;
      openAbort.abort();
      for (const abort of rowAborts.values()) abort.abort();
      rowAborts.clear();
      discardPrepared();
      lock?.release();
      lock = null;
      rows = [];
      document = null;
      unused = [];
      issue = null;
      rowGenerations.clear();
      phase = 'idle';
      change();
    },
    reset() {
      api.cancelSave();
      api.cancelOpen();
      verifier?.dispose();
      verifier = null;
      download?.dispose();
      download = null;
    },
  };
  return api;
}
export function useProjectFiles(
  options: UseProjectFilesOptions,
): ProjectFilesController {
  const [, update] = useState(0);
  const [controller] = useState(() =>
    createController(options, () => update((n) => n + 1)),
  );
  controller.configure(options);
  useEffect(() => {
    controller.mount();
    const release = options.history.sources.onBeforeClear(() =>
      controller.reset(),
    );
    return () => {
      release();
      controller.dispose();
    };
  }, [controller, options.history.sources]);
  return controller;
}
