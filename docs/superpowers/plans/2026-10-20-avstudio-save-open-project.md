# AVStudio Save/Open Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download metadata-only versioned AVStudio project files and reopen them through verified local-media relinking and one undoable project replacement.

**Architecture:** Keep the portable document separate from runtime snapshots and render manifests. Use pure bounded document validation, cancellable local fingerprint/probe services, an isolated relink workflow, and a narrow project-context extension to the current history/source registry. Publish a fully prepared replacement once; continue using existing timeline, playback, manifest, and render submission code.

**Tech Stack:** Existing React 19, TypeScript, browser File/Blob/Web Crypto/media APIs, Vitest/Testing Library, and Chromium Playwright through the existing Edge channel. No new dependency.

**Spec:** [Approved design](../specs/2026-10-20-avstudio-save-open-project-design.md). Read the full specification before execution; its field tables, exact copy, and U01–U16 / I01–I16 / B01–B10 requirements are normative.

This artifact is a plan only. No execution, code changes, commits, pushes, or deployment are authorized by the request to write it. The newer user request authorizes this plan despite the specification's historical exclusion of an implementation plan from its earlier specification-only task.

## Global Constraints

- “This is a frontend feature.” No backend, database, account, cloud, package, lockfile, deployment, or configuration changes.
- “Saving, parsing, fingerprinting, relinking, and committing an opened project make no network requests.” Existing startup health requests are not attributable to Save/Open.
- “The project file does not contain video, audio, images, thumbnails, waveforms, encoded media, or filesystem access permissions.” Never persist browser URLs or media representations.
- “Only integer `schemaVersion: 1` is supported.” The format discriminator is exactly `avstudio-project`; no migrations or render-manifest import.
- “Before reading text, reject project files larger than 5 MiB (5,242,880 bytes).” Additional format bounds: 1,000 sources, 10,000 occurrences including image/PIP, depth 16 with root object depth 1; retain current app limits as additional checks.
- “Every saved source, including an unused media-bin source, is required to complete this release's Open flow.” No ignore-missing or use-anyway option.
- “New Project remains the sole operation that completely clears the project, source registry, and history.” Empty documents are not an alternate clear action.
- Preserve current inclusive trims/schedules, half-open normalized video windows, original-audio modes, 48,000 Hz audio offsets, FPS rounding, and existing render readiness/capability gates.
- No playback-hook, rendering-algorithm, split/audio semantics, render-builder, API contract, or workspace redesign. Use the existing transport cancellation/reset interface on successful replacement only.
- Keep normal image edits outside ordinary history with their current redo invalidation; export-format changes remain outside ordinary history and retain redo.
- Use `git status --short` checkpoints. No automatic commit/push commands, staging, rollback of unrelated files, or broad formatting of pre-existing edits.

## Review Focus

These additional failure modes refine the specification's cases; each has an explicit test below.

1. Escaped JSON property names can hide duplicate/prototype keys; decode names before checking them (Task 1).
2. A newer candidate choice can lose a race to an earlier hash; only the latest row generation may become accepted (Task 6).
3. A media lease can outlive its history entry; pruning must wait for the final consumer lease (Task 3).
4. Undoing B, changing only A's formats, and redoing B must retain both projects' distinct format selections without clearing redo (Task 4).
5. React remount/cleanup and a repeated same-file chooser selection must not create duplicate downloads, modal sessions, or replacement commits (Tasks 6–8).

## Execution and file map

Run tasks sequentially; later interfaces depend on earlier contracts. At execution start, record `git status --short` and run the existing `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd run build`, and `npm.cmd run test:e2e` from frontend as the baseline, recording any environment blockage separately. Preserve the already modified `frontend/e2e/playback-continuity.spec.ts` and all existing untracked files. Each task starts with its failing tests, runs the targeted command to confirm a relevant failure, implements only the named deliverable, reruns the command to green, and ends with a repository status checkpoint. An import/type failure is an acceptable initial red for a new module, but replace it with behavioral red before claiming the behavior was tested. Existing unrelated failures must be recorded separately and never suppressed by changing config or weakening tests.

All paths below are repository-relative. Shell blocks marked **frontend** run from `C:\Users\DELL\OneDrive\Desktop\ReelWeave\frontend`; Git blocks run from the repository root. Commands are separate PowerShell commands, without shell command chaining. Use `npm.cmd`/`npx.cmd` because this workspace's PowerShell execution policy blocks the `.ps1` shims; no policy change is needed. Use the existing installation and test environment; do not install packages or browsers or change test configuration.

| File                                                                                  | Responsibility / permitted change                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Create `frontend/src/lib/projectFileTypes.ts`                                         | Portable V1 DTOs, error/result types, captured-source shape.                                |
| Create `frontend/src/lib/projectFileJson.ts` and `.test.ts`                           | Bounded strict JSON read/parse/validation and canonical stringification.                    |
| Create `frontend/src/lib/projectMedia.ts` and `.test.ts`                              | Sequential fingerprinting, local metadata probes, candidate validation.                     |
| Modify `frontend/src/lib/projectSources.ts` and `.test.ts`                            | Prepared-ready registration, transactional adoption, complete ownership/pruning.            |
| Create `frontend/src/lib/projectContext.ts` and `.test.ts`                            | Runtime project-incarnation context, capture/preparation contracts, and reference helpers.  |
| Modify `frontend/src/lib/editHistory.ts` and `.test.ts`                               | Optional runtime context, scoped rebases, explicit replacement action in current history.   |
| Modify `frontend/src/hooks/useEditHistory.ts` and `.test.tsx`                         | Capture/restore context, Open lock and atomic replacement; existing transport cancellation. |
| Create `frontend/src/lib/projectFile.ts` and `.test.ts`                               | Capture-to-document serialization, document-to-staged-runtime preparation, download owner.  |
| Create `frontend/src/hooks/useProjectFiles.ts` and `.test.tsx`                        | Save/Open state machine and async lifetime.                                                 |
| Create `frontend/src/components/ProjectFileControls.tsx` and `.test.tsx`              | Header controls, busy/cancel/status and project chooser.                                    |
| Create `frontend/src/components/ProjectRelinkDialog.tsx`, `.test.tsx`, and `.css`     | Accessible Open/relink modal and its source list.                                           |
| Modify `frontend/src/App.tsx`, `frontend/src/styles.css`                              | Feature wiring and narrow header wrapping; no general layout changes.                       |
| Create `frontend/src/App.projectFiles.test.tsx`                                       | Full app atomicity, resource, render-compatibility, and accessibility integration.          |
| Create `frontend/src/lib/projectFileCompatibility.test.ts`                            | Existing builders/timeline parity after relink.                                             |
| Create `frontend/src/test/projectFileFixtures.ts`                                     | Deterministic typed unit/integration fixtures and narrow browser-API fakes.                 |
| Create `frontend/e2e/project-files.spec.ts` and `frontend/e2e/projectFileFixtures.ts` | B01–B10 browser cases and local fixture/request-normalization helpers.                      |

Existing `historyProjection.ts`, `advancedManifest.ts`, `api.ts`, timeline/positioned/audio libraries, playback/audio hooks, existing browser tests, `mediaFixtures.ts`, package files, and all configuration files remain production-read-only. Import their existing functions and reuse their fixtures rather than rewriting them. Tests may assert their behavior from the new files.

## Task 1: Define the portable contract and strict document parser

**Files:** Create `projectFileTypes.ts`, `projectFileJson.ts`, `projectFileJson.test.ts`, and `src/test/projectFileFixtures.ts` at the paths above.

**Interfaces:**

- Define `ProjectIssueCode = 'not-project' | 'read' | 'corrupt' | 'unsupported-version' | 'limit' | 'invalid' | 'media' | 'cancelled' | 'resource'` and `ProjectIssue = { code: ProjectIssueCode; message: string; path?: string }`.
- Define `ProjectResult<T> = { ok: true; value: T } | { ok: false; issue: ProjectIssue }`; all new public feature services use this result union. Do not use the existing edit-operation `{ value } | { error }` union interchangeably.
- Define `ProjectDocumentV1`, `ProjectSourceV1`, `PortableEditV1`, `PortableImageOverlayV1`, and the three metadata variants by spelling out every property from spec section 2. `ProjectSourceV1` is a discriminated union on `mediaType`, so metadata narrows with it. Do not alias `EditSnapshot` as the portable DTO: its nullable trims, optional audio mode, legacy normalization, and future runtime context are incompatible with the closed V1 format.
- Define `CapturedSource = Readonly<Pick<SourceRecord, 'kind' | 'mediaType' | 'file' | 'status' | 'metadata' | 'duration' | 'sampleCount'>>`; clone nested metadata during capture, omit URL/token, and retain the immutable File reference.
- `parseProjectText(text: string, limits: Limits): ProjectResult<ProjectDocumentV1>`.
- `readProjectFile(file: File, limits: Limits, signal: AbortSignal): Promise<ProjectResult<ProjectDocumentV1>>`.
- `validateProjectDocument(input: unknown, limits: Limits): ProjectResult<ProjectDocumentV1>`.
- `stringifyProjectDocument(document: ProjectDocumentV1, limits: Limits): ProjectResult<string>`.
- Export constants `MAX_PROJECT_BYTES = 5242880`, `MAX_PROJECT_SOURCES = 1000`, `MAX_PROJECT_OCCURRENCES = 10000`, and `MAX_PROJECT_DEPTH = 16`.
- Fixture API: `createProjectDocumentFixture(): ProjectDocumentV1`; return a new independent object for each call. Use V1-safe IDs such as `source_base`, not `historySnapshot()`'s colon-containing source IDs.

- [ ] **1.1 Write failing tests** with named groups `version_and_discriminator`, `strict_utf8_and_json`, `closed_v1_contract`, `numeric_and_reference_invariants`, `source_relative_ranges`, `format_and_application_bounds`, and `render_blocked_drafts_are_documents`. Map all U04–U10 and the saved-metadata portion of U14 into these groups, with each specification subcase a parameterized row.

  Explicit ownership: U04 versions/discriminator; U05 encoding/strict JSON/decoded keys; U06 enum/numeric/identity/reference validation; U07 format and application bounds; U08 source-relative frames/samples/overlap; U09 FPS selection/fallback consistency; U10 empty/bin-only/repairable-draft distinction. U14 adds invalid saved timing and metadata consistency.

  Include executable assertions of this form in the eventual tests:

  ```ts
  expect(
    parseProjectText('{"format":"avstudio-project","format":"other"}', limits)
      .ok,
  ).toBe(false);
  expect(
    parseProjectText(
      '{"format":"avstudio-project","\\u0066ormat":"other"}',
      limits,
    ).ok,
  ).toBe(false);
  expect(
    validateProjectDocument(
      { ...createProjectDocumentFixture(), schemaVersion: 2 },
      limits,
    ),
  ).toMatchObject({ ok: false, issue: { code: "unsupported-version" } });
  ```

  Test escaped `__proto__`, keys nested in arrays, quotes/backslashes/braces inside filename strings, invalid UTF-8, one BOM, duplicate occurrence IDs across lanes/image, required non-null trims/audio modes, all enum/finite/safe-integer boundaries, and every reference/media-category constraint. Size tests use padded valid JSON to reach exactly 5,242,880 bytes; separate format-limit tests from current smaller application limits. Test depth 16/17 in the lexical guard independently of closed-schema rejection. Completely empty fails; bin-only and valid out-of-base schedules remain accepted. Verify saved `timingFps` against current resolver rules without making an empty base timeline renderable.

- [ ] **1.2 Run red** (**frontend**): `npm.cmd test -- src/lib/projectFileJson.test.ts`. Confirm a relevant new test fails before implementation.
- [ ] **1.3 Implement the interfaces.** Read bytes only after checking File size; decode with fatal UTF-8 validation and allow exactly one leading BOM. Use a bounded lexical scanner to count container nesting and decode each object property name before duplicate/prototype-key checks, then `JSON.parse` for grammar, followed by explicit shape validation/copying. Never use reviver-based duplicate detection, object merging, eval, or unsafe casts from parsed JSON. Dispatch version errors before interpreting V1-only fields.
- [ ] **1.4 Implement source-relative DTO checks** using existing pure `validateTrim`, `projectFrameCount`, FPS resolver, and the exact positioned/audio arithmetic as reference. This parser cannot register media, create URLs, or fetch metadata. Keep document integrity separate from ordinary render readiness; do not reject a repairable out-of-base schedule. Prove arithmetic parity later in Task 8 rather than changing the render validators.
- [ ] **1.5 Run green** with the command in 1.2. Every new test must pass, including escaped-key Review Focus 1; verify invalid parse returns no partially validated document.
- [ ] **1.6 Checkpoint** (**root**): `git status --short`.

## Task 2: Verify original media locally

**Files:** Create `frontend/src/lib/projectMedia.ts` and `frontend/src/lib/projectMedia.test.ts`; extend only `frontend/src/test/projectFileFixtures.ts` for deferred File reads and local probe fakes.

**Interfaces:**

- `LocalMediaMetadata = { mediaType: 'video'; durationSeconds: number; width: number; height: number } | { mediaType: 'audio'; durationSeconds: number } | { mediaType: 'image'; width: number; height: number }`.
- `CandidateEvidence = { file: File; sha256: string; metadata: LocalMediaMetadata }`.
- `createProjectMediaVerifier(): ProjectMediaVerifier`, with methods `fingerprint(file: File, signal: AbortSignal): Promise<ProjectResult<string>>`, `inspect(file: File, expectedType: ProjectSourceV1['mediaType'], signal: AbortSignal): Promise<ProjectResult<LocalMediaMetadata>>`, and `dispose(): void`.
- `checkRelinkCandidate(source: ProjectSourceV1, evidence: CandidateEvidence, limits: Limits, roles: ReadonlySet<SourceKind>): ProjectResult<{ renamed: boolean }>`.
- These methods return feature result unions; abort/timeouts do not escape as unhandled promise rejections. A cancelled digest may finish internally, but no result is published to the caller as accepted.

- [ ] **2.1 Write failing tests** named `fingerprint_matches_known_sha256`, `cache_is_by_file_identity`, `serializes_file_reads`, `rejects_before_hash_for_size`, `checks_local_category_and_decode`, `duration_tolerance_boundaries`, `renamed_original_needs_confirmation`, `probe_timeout_cleans_up`, and `cancelled_probe_cannot_publish`. Cover U11, U12, U14, U15, and I11.

  Use bytes `abc` with expected SHA-256 `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; mock only media inspection for this cryptographic test, not the digest. If JSDOM lacks the browser primitive, provide Node Web Crypto within this test file only. Do not change shared setup or configuration. Assert File instances with identical name/size/timestamp but different bytes get different verification results.

  Test 0.050/0.051 second differences at 24 FPS and audio/PIP; test `1/15` and `1/15 + 0.001` seconds for saved 15 FPS. Use a narrowly defined machine-roundoff comparison (at most a few machine epsilons scaled to compared durations), not an additional media tolerance. Dimensions match exactly. Different timestamps/empty MIME pass; wrong category, wrong digest, decode errors, and zero-duration media fail. Assert ready/error/abort/15,000 ms timeout each removes listeners, clears media `src`, and revokes its probe URL once.

- [ ] **2.2 Run red** (**frontend**): `npm.cmd test -- src/lib/projectMedia.test.ts`.
- [ ] **2.3 Implement the verifier and comparison.** Use a per-verifier WeakMap keyed by File for successful digests, a single-file read/hash queue, and browser `crypto.subtle.digest('SHA-256', buffer)`. Check cancellation before and after queued work and release large buffers between files. Inspect with muted detached video/audio elements or image elements; video requires positive video dimensions to avoid accepting audio-only files as video. Probe with a 15,000 ms timeout; never call a backend, guess frame count, or create extracted media. Apply the strictest existing size limit across all roles. Restore saved authoritative clip/sample timing only after byte identity and observable metadata pass.
- [ ] **2.4 Run green** with 2.2; assert zero feature fetches and no surviving probe resources.
- [ ] **2.5 Checkpoint** (**root**): `git status --short`.

## Task 3: Make source adoption and release transactional

**Files:** Modify `frontend/src/lib/projectSources.ts` and `frontend/src/lib/projectSources.test.ts` only.

**Interfaces:**

- Add `ReadySourceInput = { id: string; file: File; kind: SourceKind; mediaType: SourceRecord['mediaType']; metadata: SourceMetadata }` for already validated imported sources. Add `registerReady(input: ReadySourceInput): SourceToken`; validate consistency and create ready records without invoking the normal import/probe lifecycle. Retain existing `register`/`markReady` semantics.
- Add `SourceAdoption = { commit(): void; rollback(): void }` and `adoptFrom(staged: ProjectSources): SourceAdoption`. Until commit, staged sources own their records/URLs, and a provisional lease protects the live copies; rollback removes only newly adopted live records. Commit transfers ownership without revocation, detaches staged records, and releases the provisional lease only after live history roots exist. IDs must be fresh and collision-checked. Adopted tokens use the live registry session and fresh request identities.
- Add `collectGarbage(next: ReadonlySet<string>): void`. It reconciles URLs and removes otherwise unreachable records, respecting external owners and leases. Keep `reconcileUrls`' public URL-only behavior for callers that retain Files without a URL. History/controller publication will call complete garbage collection after all roots are computed.
- `collectReachableSources` will include runtime context image roots once Task 4 adds that field. Add that narrow extension in Task 4, not a forward import to a nonexistent type.

- [ ] **3.1 Write failing tests** named `adoption_is_all_or_nothing`, `adoption_does_not_invalidate_existing_tokens`, `rollback_preserves_staged_owner`, `transfer_does_not_revoke_shared_url`, `history_eviction_waits_for_render_lease`, and `clear_rejects_stale_adoption`. Include injected mid-batch failures, collisions, twice-called commit/rollback, old lease-release callbacks, and repeated clears. Assert target records/URLs/tokens are identical after rollback; an existing render/save lease protects its File after history eviction (Review Focus 3).
- [ ] **3.2 Run red** (**frontend**): `npm.cmd test -- src/lib/projectSources.test.ts`.
- [ ] **3.3 Implement the interfaces.** Keep mutation synchronous; store the live session epoch at adoption start, invalidate transactions before clear, and make settlement idempotent. Do not call `clear()` on the installed registry when opening. Garbage collection removes a record only after all current, historical, pending, and consumer roots have been supplied. Retain that latest complete root set so releasing the final lease/external owner also removes newly unreachable records, even without another history publication. Registration must be protected by a pending root/lease before any reconciliation. Never share a URL across two independent source owners without an explicit ownership transfer.
- [ ] **3.4 Run green** with 3.2; run `npm.cmd test -- src/hooks/useEditHistory.test.tsx src/lib/projectSources.test.ts` to ensure existing import/token behavior remains intact.
- [ ] **3.5 Checkpoint** (**root**): `git status --short`.

## Task 4: Add a project-replacement boundary to existing history

**Files:** Create `frontend/src/lib/projectContext.ts` and `.test.ts`; modify `frontend/src/lib/editHistory.ts`, `.test.ts`, `frontend/src/hooks/useEditHistory.ts`, `.test.tsx`, and `frontend/src/lib/projectSources.ts`, `.test.ts`.

**Interfaces:**

- In `projectContext.ts`, define `ProjectContext = { incarnationId: string; imageOverlay: PortableImageOverlayV1 | null; exportFormats: readonly ExportFormat[]; timingFps: ProjectFps | null }`. The image object's IDs are runtime IDs here, although its schedule shape matches the DTO. Define `ProjectEnvelope = EditSnapshot & { projectContext: ProjectContext }`, `ProjectCapture = { envelope: ProjectEnvelope; sources: ReadonlyMap<string, CapturedSource>; capturedAt: Date }`, and `PreparedProject = { envelope: ProjectEnvelope; sources: ProjectSources; dispose(): void }`. These contracts exist now so Task 4 compiles without importing a future module. Use type-only imports for the runtime-history type relationships.
- Add optional `projectContext?: ProjectContext` to `EditSnapshot` for compatibility with legacy snapshots and existing fixtures. The controller initializes it to a fresh incarnation, null image, MP4-only exports, and null FPS fallback. `normalizeSnapshot` preserves/deep-copies it. `snapshotsEqual` remains an edit-content equality check ignoring context; explicit Open commits bypass its normal no-op rule.
- Add `HistoryAction` value `project-open` with label `Open Project` and `commitProjectReplacement(history: EditHistory, next: ProjectEnvelope): EditHistory` in `editHistory.ts`.
- Extend `rebaseHistory(history, rewrite, userEdit, incarnationId?: string): EditHistory`; with an incarnation, rewrite only matching sides of past/future/present. Existing callers without context retain legacy behavior. The controller must pass the current incarnation at every existing rebase call site.
- Add controller `get projectContext(): ProjectContext`, `updateExternalProjectContext(patch: Pick<Partial<ProjectContext>, 'imageOverlay' | 'exportFormats'>, userEdit: 'image' | 'export' | 'metadata'): void`, and `captureProject(capturedAt: Date): ProjectCapture`. Context updates mirror image/export values across that incarnation's sides without creating entries or rewriting other projects. Image user edits invalidate redo; exports and metadata initialization do not. Capture clones the current envelope and reachable source metadata, keeps immutable File references, and includes the current image source; Task 5 consumes it without changing the controller contract.
- Add `acquireProjectOpenLock(): ProjectOpenLock | null`, where `ProjectOpenLock = { replace(prepared: PreparedProject): ProjectResult<void>; release(): void }`. The lock suspends current editing/history admission but does not set the existing `editingLocked` prop, which would pause preview. The lock's owner is the only replacement caller; it cannot bypass active/completed locks or drafts.
- Define `ProjectContextRestore = { context: ProjectContext; image: ImageOverlay | null; imageToken: SourceToken | null }` in `projectContext.ts`, and add optional `HistoryOptions.onProjectContextRestore?: (restored: ProjectContextRestore) => void`. Prepare this payload, including any image URL, before publication. The App callback only applies React state setters synchronously, with no probing, URL allocation, or asynchronous work. Invoke it in the same synchronous history-publication batch when crossing Open boundaries; ordinary history navigation does not invoke it.

- [ ] **4.1 Write failing tests** named `open_is_one_history_entry`, `undo_redo_restore_project_context`, `normal_image_export_history_is_unchanged`, `rebase_stays_in_current_incarnation`, `replacement_failure_is_atomic`, `open_lock_does_not_pause_preview`, `history_limit_releases_both_images`, `capture_clones_current_source_graph`, and `multiple_replacements_restore_each_incarnation`. Cover I06–I09 and I12 in controller/history tests. Construct a typed `PreparedProject` fixture using Task 3's ready registry directly; Task 5 later exercises the same interface through real portable-document preparation.

  Pin Review Focus 4 with assertions equivalent to:

  ```ts
  // A was installed, then B opened; use the existing history controls.
  expect(controller.controls.undo()).toBe(true);
  controller.updateExternalProjectContext(
    { exportFormats: ["mp4", "wav"] },
    "export",
  );
  expect(controller.controls.canRedo).toBe(true);
  expect(controller.controls.redo()).toBe(true);
  expect(controller.projectContext.exportFormats).toEqual(["mp4", "mov"]);
  expect(controller.controls.undo()).toBe(true);
  expect(controller.projectContext.exportFormats).toEqual(["mp4", "wav"]);
  ```

  Also test Open B → Open C → Undo twice → Redo twice; image updates, FPS fallback, and both sides' File roots must belong to the correct incarnation. Test legacy fixtures without context. Test 31 replacement/edit entries and a surviving render lease. Apply speed/FPS rebases in B and assert A remains byte-for-byte unchanged.

- [ ] **4.2 Run red** (**frontend**): `npm.cmd test -- src/lib/projectContext.test.ts src/lib/editHistory.test.ts src/hooks/useEditHistory.test.tsx src/lib/projectSources.test.ts`.
- [ ] **4.3 Implement pure history/context behavior first.** Use one current undo stack and the existing 30-entry limit, preserving earlier past entries and clearing future only when the existing semantics call for it. Never create separate image/export entries. Maintain per-snapshot timing FPS rather than globally replacing historical timing during image/export synchronization. Add historical image references to source reachability. For a project incarnation re-entered through navigation, restore its most recently synchronized external context.
- [ ] **4.4 Implement the controller transaction.** Before publication, validate and materialize the staged target, prepare adoption and the complete next history value, and recheck the lock/session. On failure rollback without changing history/revisions/external owners or stopping playback. On success use `transport?.cancel()` (already bound to `resetPlayback`) instead of ordinary edit-anchor mapping; install one replacement/history/context update, advance structural/source revisions, reconcile complete roots, then finalize ownership transfer. The same replacement path handles crossing a `project-open` entry on Undo/Redo. Ordinary navigation still uses current transport mapping. Do not edit `useProjectPlayback.ts`, `useProjectAudio.ts`, or `transportMapping.ts`.
- [ ] **4.5 Keep rollback boundaries explicit.** No async work or potentially failing allocations after the final publication point. Prepare required URLs and history copies first. Catch preparation/adoption failures into `ProjectResult`; retain the Open lock for retry. New Project/dispose invalidates the lock, sources, and outstanding callbacks. Extend current readiness validation with a supplemental `validatePositioned` call using context `timingFps` for auto/empty Video 1, without changing existing validator/render logic.
- [ ] **4.6 Run green** with 4.2, then `npm.cmd test -- src/App.history.test.tsx src/hooks/useProjectPlayback.test.tsx src/hooks/useProjectAudio.test.tsx` to prove ordinary behavior remains unchanged.
- [ ] **4.7 Checkpoint** (**root**): `git status --short`.

## Task 5: Serialize captures, prepare relinked projects, and own downloads

**Files:** Create `frontend/src/lib/projectFile.ts` and `.test.ts`; extend `src/test/projectFileFixtures.ts`. Consume Task 4's capture/preparation contracts without redefining them.

**Interfaces:**

- Import `ProjectCapture` and `PreparedProject` from `projectContext.ts`. Define `AcceptedRelink = { sourceId: string; evidence: CandidateEvidence; renamedConfirmed: boolean }` in `projectFile.ts`; its sourceId is the document-local ID until preparation remaps it.
- `serializeProjectCapture(capture: ProjectCapture, verifier: ProjectMediaVerifier, limits: Limits, signal: AbortSignal): Promise<ProjectResult<ProjectDocumentV1>>`.
- `prepareRelinkedProject(document: ProjectDocumentV1, matches: ReadonlyMap<string, AcceptedRelink>, limits: Limits, newId: () => string): ProjectResult<PreparedProject>`.
- `createProjectDownload(): { request(text: string, capturedAt: Date): ProjectResult<void>; dispose(): void }`; it owns only JSON download URLs/anchors/timers.
- Fixture addition: `createProjectCaptureFixture(): ProjectCapture`. Use actual source File references with stable content and metadata, and register the image/PIP/music and detached-only dependencies explicitly.

- [ ] **5.1 Write failing tests** named `capture_allowlists_all_tracks`, `source_graph_excludes_undo_only_media`, `save_is_immutable_during_edits`, `output_size_is_not_media_payload_size`, `relink_remaps_all_ids`, `same_document_opens_as_distinct_incarnations`, `preserves_repairable_drafts`, `preparation_does_not_touch_installed_registry`, and `download_owner_releases_after_dispatch`. Cover U01–U03, U08–U10, U15–U16 and service-level I01/I09/I12.

  Capture every approved metadata field, including required `originalAudio` defaults, trimSaved, windows, frozen detached recipes/provenance, musicSourceId, bin order, image/PIP schedules, volumes/mutes, auto/explicit FPS/fallback, and all exports. Inject arbitrary internal fields and assert they never appear. Compare equal-length metadata fixtures with differently sized media and assert equal JSON byte size as specified by U03. Assert a renamed original's next Save records the linked File's current name/timestamp.

  For remapping, inject deterministic fresh IDs and verify each source and occurrence reference, including dangling provenance, is consistently remapped. Use a shared Video 1/PIP source fixture: register its staged kind as `pip` with both duration and clip metadata so existing `validateRestoration`'s PIP-kind check and video timing checks both pass. A bin-only video without clip timing remains ready but cannot bypass existing placement requirements.

- [ ] **5.2 Run red** (**frontend**): `npm.cmd test -- src/lib/projectFile.test.ts`.
- [ ] **5.3 Implement serialization from the capture.** Use Task 4's copied current envelope and reachable File records, including its maintained image occurrence ID. Do not copy history or URLs. The workflow acquires the source lease before capture. Hash sequentially; inspect images locally only when dimensions are not cached, otherwise preserve existing source timing/provenance. Convert internal metadata `source` to portable `origin` and back explicitly. Validate then canonicalize sources by ID and formats in `mp4,mov,wav,mp3` order, leaving edit arrays intact. Check encoded byte limit after serialization too.
- [ ] **5.4 Implement preparation.** Require all source matches and rename confirmations, revalidate evidence/limits, allocate a fresh incarnation and IDs, and construct a separate ready registry using Task 3. Preserve each document source's identity even when several share one File. Run `validateRestoration`, supplemental fallback-FPS `validatePositioned`, image/source invariants, and `materializeSnapshot` on staging only. Do not require ordinary render readiness or repair schedules. On error dispose staging and return an issue. On success return its explicit disposable owner; adoption occurs in Task 4's lock transaction.
- [ ] **5.5 Implement download ownership.** Use `application/json`, the exact local-time filename `AVStudio-project-YYYY-MM-DD-HHmmss.avstudio.json`, a temporary anchor, and deferred URL revocation after click dispatch. Clean timers/URLs on dispose; no disk-write-success claim, File System Access API, or network. Test the format with a fixed local Date and a repeated capture; browser collision suffixes are not controlled by the application.
- [ ] **5.6 Run green** with 5.2 and the Task 4 command, now using real preparation/capture interfaces in its fixtures. All type imports must resolve at this checkpoint.
- [ ] **5.7 Checkpoint** (**root**): `git status --short`.

## Task 6: Build cancellable Save/Open orchestration

**Files:** Create `frontend/src/hooks/useProjectFiles.ts` and `.test.tsx`.

**Interfaces:**

- `ProjectOpenPhase = 'idle' | 'reading' | 'relinking' | 'checking' | 'ready' | 'committing' | 'failed'`.
- `RelinkRowStatus = 'missing' | 'checking' | 'matched' | 'mismatched' | 'ambiguous' | 'rename-confirmation' | 'unreadable'`.
- `RelinkRow = { source: ProjectSourceV1; roles: readonly SourceKind[]; occurrenceCount: number; status: RelinkRowStatus; candidates: readonly CandidateEvidence[]; accepted: AcceptedRelink | null; issue: ProjectIssue | null }`. Candidate array position is the dialog's choice key, never a persisted identity. Use `video`/`audio` roles for bin entries and explicit track kinds for timeline/overlay use, with human-readable labels only in the UI.
- `ProjectFileAvailability = { saveDisabledReason: string | null; openDisabledReason: string | null }`.
- `UseProjectFilesOptions = { history: EditHistoryController; limits: Limits; availability: ProjectFileAvailability; onOpened: () => void; onAnnounce: (message: string) => void }`.
- `useProjectFiles(options: UseProjectFilesOptions): ProjectFilesController`, exposing `saveBusy: boolean`, `openPhase: ProjectOpenPhase`, `rows: readonly RelinkRow[]`, `issue: ProjectIssue | null`, `unusedFiles: readonly File[]`, `canConfirm: boolean`, and methods `save(): Promise<void>`, `cancelSave(): void`, `open(file: File): Promise<void>`, `addMedia(files: readonly File[], sourceId?: string): Promise<void>`, `chooseCandidate(sourceId: string, candidateIndex: number): void`, `confirmRename(sourceId: string): void`, `confirmOpen(): ProjectResult<void>`, `cancelOpen(): void`, and `reset(): void`.
- `reset` invalidates both workflows for New Project; unmount cleanup disposes all workflow resources. Cancelled is a cleanup transition to idle, not an indefinitely rendered phase.

- [ ] **6.1 Write failing tests** named `save_lease_pins_captured_files`, `parse_failure_keeps_live_project`, `every_dependency_is_required`, `ambiguous_batch_is_order_independent`, `rename_does_not_autocommit`, `latest_candidate_generation_wins`, `cancel_at_each_await_discards_results`, `double_confirmation_commits_once`, and `strict_mode_cleanup_is_idempotent`. Cover U13, I03–I05, I09–I11, I15 and Review Focus 2/5.

  Use deferred read/hash/probe promises and fake timers. Start row selection A, then B; resolve B then A and assert accepted evidence stays B. Assert an unmatched same-name file does not prevent finding a renamed matching candidate; two passing distinct Files remain Ambiguous; identical document records may share one accepted File. Cancel each phase, start another Open, invoke New Project/reset, and unmount before resolving stale work. Assert no history/URL mutation or late download. Test the React StrictMode mount/cleanup cycle without permanently disposing a newly mounted verifier.

- [ ] **6.2 Run red** (**frontend**): `npm.cmd test -- src/hooks/useProjectFiles.test.tsx`.
- [ ] **6.3 Implement the workflow.** Use monotonically increasing operation and per-row generations plus AbortControllers. Acquire the existing-history Open lock only for an admitted Open; parse and validate fully before any candidate registry creation. Read/hash/probe candidates sequentially with Task 2. Replacing a row immediately clears its prior acceptance but leaves other rows intact. Track extraneous files separately. Required-source completion plus final preparation enables confirmation; the last match never opens automatically.
- [ ] **6.4 Implement Save/commit/cancel lifetimes.** Save captures under a distinct source lease, permits subsequent ordinary editing, and uses its original capture timestamp. Confirm rechecks lock, source acceptance, generation, and limits, then calls the lock's atomic replace once. On error retain accepted evidence and lock for retry while disposing failed prepared resources. On success release staging/lock after ownership transfer and call `onOpened` once. Cancel/error close never resets transport or current project. Do not let busy-state React updates be the only double-submit guard.
- [ ] **6.5 Run green** with 6.2 and `npm.cmd test -- src/lib/projectFile.test.ts src/hooks/useEditHistory.test.tsx`.
- [ ] **6.6 Checkpoint** (**root**): `git status --short`.

## Task 7: Add accessible Save/Open controls and relink dialog

**Files:** Create `frontend/src/components/ProjectFileControls.tsx`, `.test.tsx`, `ProjectRelinkDialog.tsx`, `.test.tsx`, and `ProjectRelinkDialog.css`.

**Interfaces:**

- `ProjectFileControls({ controller, availability, workspaceRef }: { controller: ProjectFilesController; availability: ProjectFileAvailability; workspaceRef: React.RefObject<HTMLElement | null> }): React.JSX.Element`.
- `ProjectRelinkDialog({ controller, openerRef, workspaceRef }: { controller: ProjectFilesController; openerRef: React.RefObject<HTMLButtonElement | null>; workspaceRef: React.RefObject<HTMLElement | null> }): React.JSX.Element | null`.
- The controls component owns the Open button ref and dialog rendering; the App supplies the workspace ref. Use these exact props at Task 8; do not create a second opener ref in App.

- [ ] **7.1 Write failing tests** named `visible_labels_and_disabled_reasons`, `dialog_focus_and_escape`, `all_source_rows_remain_visible`, `keyboard_rename_and_ambiguity`, `live_regions_do_not_spam`, and `same_project_can_be_selected_again`. Cover I02/I05/I16. Assert dialog name “Open Project”, native buttons/file inputs, associated row errors, alert versus polite status, inert background semantics, and focus restoration after cancel/error close. Confirm actions disabled during atomic commit. Reset file input values after reading so reselecting the identical JSON triggers a new Open attempt (Review Focus 5).
- [ ] **7.2 Run red** (**frontend**): `npm.cmd test -- src/components/ProjectFileControls.test.tsx src/components/ProjectRelinkDialog.test.tsx`.
- [ ] **7.3 Implement controls** with exact Save/Open names and spec messages. Use chooser hints `.avstudio.json,application/json`, a single project file, multiple media-file selection, and named per-row pickers. Cancelled choosers are silent. During Save show “Preparing project file…” and Cancel; on completion announce download requested, never saved-to-disk. Expose visible disabled reasons through associated text.
- [ ] **7.4 Implement the dialog** using native `<dialog>.showModal()` and its keyboard/modal semantics, plus explicit focus management and cancellation prevention while committing. Place it outside the inert workspace. Catch `cancel` for Escape cleanup; guard repeated show/close calls. Test JSDOM's missing dialog primitives with file-local doubles, then verify real modal behavior in Task 9. Show every required source with metadata, roles/counts, chosen filename, status/reason, Locate, rename confirmation, and ambiguous candidate choices. Unused files are informational text, never bin imports.
- [ ] **7.5 Implement scoped CSS** for visible focus, long filenames, a scrollable list, reachable actions, 320 CSS-pixel width, and 200% zoom. No color-only state, global shortcut, motion dependency, or workspace rearrangement. Use the specified initial/return/success focus targets and announce progress only on state changes.
- [ ] **7.6 Run green** with 7.2. DOM/focus assertions must pass; visual responsiveness is verified in Task 9 rather than inferred from JSDOM.
- [ ] **7.7 Checkpoint** (**root**): `git status --short`.

## Task 8: Wire the app and prove render compatibility

**Files:** Modify `frontend/src/App.tsx` and `frontend/src/styles.css`; create `frontend/src/App.projectFiles.test.tsx` and `frontend/src/lib/projectFileCompatibility.test.ts`; extend only new feature fixtures as required.

**Consumes:** Tasks 4–7 interfaces and existing `materializeSnapshot`, `buildTimeline`, `buildAdvancedTimeline`, `buildAdvancedMergeRequest`, `buildV3MergeRequest`, `requiresV3`, existing source leases and API submission. Do not modify these builders or API implementations.

**Produces:** Header controls and a modal with admission/render guards; a synchronous App bridge between current external image/export state and runtime project context. Keep existing App state and ordinary event semantics; do not move unrelated UI into new components.

- [ ] **8.1 Write failing integration tests** with the exact names `save_preserves_current_edit_and_redo`, `open_error_preserves_complete_A`, `open_is_atomic_A_to_B`, `cancel_preserves_running_preview`, `all_drafts_and_locks_guard_controls`, `context_bridge_handles_image_and_exports`, `new_project_is_only_complete_clear`, `unavailable_exports_remain_selected`, `invalid_input_never_registers_live_media`, and `save_open_make_no_feature_requests`. Cover remaining I01–I16 assertions and repeat StrictMode/repeated same-file behavior at App level.

  Assert all current pending imports, PIP/bin/positioned candidates, active placement/drag/trim drafts and history gestures produce explicit disabled reasons. Active/completed results block Open but permit settled Save. Unknown/offline health does not block Save/Open. Do not relax render or import health checks. Attempt controller/history/render callbacks directly while the modal is open and verify guards reject them without pausing the already-running preview.

- [ ] **8.2 Write failing compatibility tests** `advanced_manifest_is_equivalent_after_relink` and `v3_manifest_is_equivalent_after_relink`, plus `empty_video1_draft_keeps_readiness_errors`. Cover I13/I14 using real Task 5 preparation and current builders. Compare every field after a bijective ID remapping, all upload File byte contents, original vs detached audio ownership, normalized sample offsets, image/PIP schedules, formats, FPS, windows, and resolved intervals. Include Music-only/detached-source dependencies, speed 0.5/0.75, source FPS 15/29.97 with supported project FPS, one-frame trims, and sample-EOF tolerance. Do not normalize away changed timing/settings or compare only object shape.
- [ ] **8.3 Run red** (**frontend**): `npm.cmd test -- src/App.projectFiles.test.tsx src/lib/projectFileCompatibility.test.ts`.
- [ ] **8.4 Wire `useProjectFiles` and controls in App.** Derive Save/Open availability separately from existing edit locks; add explicit modal guards to app/history action admission and `canMerge`/submit handler. Do not pass modal state as `EditingWorkspace.editingLocked`, which would pause current playback. Native modal focus/inertness and the controller lock suspend commands while old preview can continue. Keep existing startup health requests independent of the feature.
- [ ] **8.5 Bridge context synchronously.** Before admitting Save/Open ensure current image schedule/source and export selection are mirrored into controller context; initialize an overlay occurrence ID when normal image selection first creates it. Route existing image/export callbacks through context updates with their current redo semantics, not a delayed effect vulnerable to immediate Save. Supply `HistoryOptions.onProjectContextRestore` from Task 4 to set App image/token/format state in the same React publication as successful replacement/navigation; consume its prepared image payload without allocating resources in the callback. Validate image callbacks against the currently installed image token/incarnation as well as source request tokens; a retained historical image owner is not sufficient permission for an old callback to update the current overlay.
- [ ] **8.6 Wire successful-open and clear cleanup only.** Clear transient selection/placement/trim/error/result state as applicable after successful replacement, advance App callback epoch without calling New Project, focus the workspace, and announce source count. Undo/Redo across Open runs the same external-context projection. Invoke workflow `reset` before existing New Project clears sources; retain the existing completed-result path. Keep preview-hook and render-builder files unchanged. A preparation failure leaves all current UI/history/source values identical.
- [ ] **8.7 Run green** with 8.3, then `npm.cmd test` from frontend. Existing unit/integration regressions must remain passing; classify any already-present failures against the baseline instead of modifying unrelated tests.
- [ ] **8.8 Checkpoint** (**root**): `git status --short`.

## Task 9: Exercise the actual browser flow

**Files:** Create `frontend/e2e/project-files.spec.ts` and `frontend/e2e/projectFileFixtures.ts`. Existing e2e tests, media fixture generator, Playwright config, and backend files remain unchanged.

**Interfaces:** New helper `generateProjectFileMedia(folder: string): ReturnType<typeof generateAdvancedMedia> & { renamedBase: string; duplicateBase: string; sameSizeWrongBase: string }` uses existing `generateAdvancedMedia`. Helpers may use Node filesystem/crypto only in the test process, with all generated files inside `testInfo.outputPath('media')`. Add `normalizeProjectRequestIds` locally in this helper file to compare captured requests by a bijective source/occurrence identity map; keep every other field unchanged.

- [ ] **9.1 Add failing browser cases** named `B01_full_roundtrip_fresh_context` through `B10_new_project_and_reload` with individual assertions matching each B01–B10 specification row. Intercept render submissions for deterministic manifest/File-byte checks while exercising real downloads, File APIs, hashing, image/media decode, chooser inputs, dialog focus, and history. A copied renamed/duplicate fixture has the exact original bytes. For the adversarial fixture, replace a known fixed-length MP4 metadata/free-box payload without changing byte length or decodability; verify different SHA, same bytes length, browser duration, and dimensions before using it. Do not rely on equal-size different encodes happening by chance.
- [ ] **9.2 Run red** (**frontend**): `npm.cmd run test:e2e -- e2e/project-files.spec.ts`. A missing/new UI behavior must be demonstrated before implementation adjustments. Browser-case failures found after Tasks 7–8 are fixed only through corresponding new red unit/integration coverage, without broad playback/render changes.
- [ ] **9.3 Complete browser assertions.** Parameterize missing image/music/detached-only sources, corrupt/version/size/reference failures, rename/ambiguity confirmation, chooser and relink cancellation, retry/reselect, and feature-no-network behavior. In B01 construct fresh page contexts with no retained source registry. Capture rendered request metadata before starting a simulated job lock, or use the existing failed-job response pattern so another project can subsequently open. Never bypass completed locks in production for a test.
- [ ] **9.4 Verify B07 with real native dialog keyboard behavior**, including Tab/Shift+Tab containment, Escape, visible focus, row controls, alerts, long names, and actions at 320 CSS pixels and 200% zoom. Use Edge/Chromium CDP `Emulation.setPageScaleFactor` for a zoomed accessibility smoke test alongside the narrow-layout test; assert actionable controls remain reachable and focus stays in the dialog. Record that CDP scaling is an automated proxy for browser UI zoom, and manually verify actual Edge 200% browser zoom before acceptance if the automation cannot reproduce that layout behavior. No new browser framework/configuration.
- [ ] **9.5 Run green** with 9.2, then run existing `npm.cmd run test:e2e -- e2e/avstudio.spec.ts e2e/advanced-timeline.spec.ts e2e/timeline-drag-audio-export.spec.ts e2e/playback-continuity.spec.ts e2e/normal-playback-recovery.spec.ts e2e/pause-resume-display.spec.ts e2e/pause-resume-readiness.spec.ts e2e/play-pause-baseline.spec.ts` as the targeted existing-flow regression check. Do not edit these pre-existing files to make this feature pass.
- [ ] **9.6 Checkpoint** (**root**): `git status --short`.

## Task 10: Complete validation and scope review

**Files:** Inspect only the implementation's named file set and the existing baseline; this task introduces no backend/configuration changes. Do not create an additional implementation document.

- [ ] **10.1 Confirm full spec coverage** using the table below and inspect every requirement in sections 1–9 of the approved specification. All 42 IDs require their complete subcases, not merely a test carrying the ID. Repair gaps with a new failing test first.
- [ ] **10.2 Run full unit/integration tests** (**frontend**): `npm.cmd test`. Expected: zero new failures; all feature cases and existing regressions pass.
- [ ] **10.3 Run full browser tests** (**frontend**): `npm.cmd run test:e2e`. Existing configuration starts/reuses Vite and the existing local backend test process. This is validation of current rendering, not backend implementation or deployment. Prerequisites are the already available `.venv`, FFmpeg/FFprobe, and Edge. If unavailable, report the exact blocked command and prerequisite; do not install or change backend/config/packages to force completion. A blocked mandatory suite means verification is incomplete, not passed.
- [ ] **10.4 Run lint** (**frontend**): `npm.cmd run lint`. Expected: exit 0.
- [ ] **10.5 Format only the feature's file set**, if needed, using this explicit command (**frontend**); never run a repository-wide write:

  ```powershell
  $projectFeaturePaths = @(
    'src/lib/projectFileTypes.ts'
    'src/lib/projectFileJson.ts'
    'src/lib/projectFileJson.test.ts'
    'src/lib/projectMedia.ts'
    'src/lib/projectMedia.test.ts'
    'src/lib/projectSources.ts'
    'src/lib/projectSources.test.ts'
    'src/lib/projectContext.ts'
    'src/lib/projectContext.test.ts'
    'src/lib/editHistory.ts'
    'src/lib/editHistory.test.ts'
    'src/hooks/useEditHistory.ts'
    'src/hooks/useEditHistory.test.tsx'
    'src/lib/projectFile.ts'
    'src/lib/projectFile.test.ts'
    'src/hooks/useProjectFiles.ts'
    'src/hooks/useProjectFiles.test.tsx'
    'src/components/ProjectFileControls.tsx'
    'src/components/ProjectFileControls.test.tsx'
    'src/components/ProjectRelinkDialog.tsx'
    'src/components/ProjectRelinkDialog.test.tsx'
    'src/components/ProjectRelinkDialog.css'
    'src/App.tsx'
    'src/styles.css'
    'src/App.projectFiles.test.tsx'
    'src/lib/projectFileCompatibility.test.ts'
    'src/test/projectFileFixtures.ts'
    'e2e/project-files.spec.ts'
    'e2e/projectFileFixtures.ts'
  )
  npx.cmd --no-install prettier --write @projectFeaturePaths
  npm.cmd run format:check
  ```

  Expected: exit 0 or separately documented baseline-only violations. Before formatting a modified existing file, inspect its baseline diff so formatting cannot silently overwrite another task's changes. To check this plan file itself from frontend, use `npx.cmd --no-install prettier --check ../docs/superpowers/plans/2026-10-20-avstudio-save-open-project.md`.

- [ ] **10.6 Run build** (**frontend**): `npm.cmd run build`. Expected: TypeScript and Vite both exit 0, with no package/config changes. Do not change settings to hide type failures.
- [ ] **10.7 Check whitespace and scope** (**root**), with each command run separately:

  ```powershell
  git diff --check
  git diff --stat
  git diff --name-only
  git status --short
  git diff -- backend frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/playwright.config.ts
  ```

  Expected: no feature changes to forbidden paths or production playback/render logic. Compare status against the execution baseline; a pre-existing diff is not a feature edit. New files are untracked until separately authorized integration: inspect their complete contents and run explicit Prettier checks too, because `git diff` alone omits untracked files. Confirm approved spec is unchanged, no fixture media accidentally entered source/public directories, no backend/API calls were added to Save/Open, no automatic browser persistence exists, and no package/config files were modified.

- [ ] **10.8 Verify no automatic Git write commands** were introduced into scripts or task instructions; no commit/push/deployment was performed. Report actual test/lint/format/build outcomes and any baseline/environment limitations. Stop after verification; implementation execution and integration remain separate authorization boundaries.

## Coverage ledger

| Specification obligation                                                   | Owning tasks / assertions                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 schema/versioning, closed/strict parser, invalid input atomicity        | Task 1: U04–U10/U14; Tasks 6/8: I04/I09; Task 9: B05.                                                                                                                                       |
| All edit/export metadata, no media or runtime state, immutable Save        | Task 5: U01–U03/U15/U16 and I01; Tasks 6/8: I01/I10; Task 9: B01.                                                                                                                           |
| Fingerprints, original-file selection, tolerances, rename/ambiguity        | Task 2: U11/U12/U14/U15; Task 6: U13/I05/I11; Task 9: B03/B04.                                                                                                                              |
| Missing/unmatched/bin/detached sources and render blocking                 | Tasks 5–8: U02/U10/U13, I02/I03/I05/I14; Task 9: B03/B08.                                                                                                                                   |
| Single replacement, ordinary history behavior, cross-incarnation isolation | Task 4: I06/I07/I08; Task 8 context bridge; Task 9: B02/B10.                                                                                                                                |
| Staging/download/preview/render/history resource ownership                 | Tasks 2–6: I09/I10/I11/I12; Task 8 stale image callback test; Task 9: B06/B10.                                                                                                              |
| Same existing timeline/manifest/upload flow                                | Tasks 5/8: U08/U09/I13/I14/I15; Task 9: B01/B08/B09 and existing regressions.                                                                                                               |
| Accessibility, chooser/cancel/error behavior and complete UI states        | Tasks 6–8: I02/I03/I04/I05/I10/I16; Task 9: B05/B06/B07.                                                                                                                                    |
| No backend/config/package/draft/playback/render scope expansion            | Tasks 8–10: I15, B08/B09/B10, full verification and forbidden-path diff.                                                                                                                    |
| Unit IDs                                                                   | Task 1 owns U04–U10 and saved-metadata U14; Task 2 owns U11/U12/U14/U15; Task 5 owns U01–U03/U08–U10/U15/U16; Task 6 owns U13.                                                              |
| Integration IDs                                                            | Task 3 owns lease/adoption I09/I12; Task 4 owns I06–I09/I12; Task 5 owns service I01/I09/I12; Task 6 owns I03–I05/I09–I11/I15; Task 7 owns I02/I05/I16; Task 8 completes app-level I01–I16. |
| Browser IDs                                                                | Task 9 owns every B01–B10, including B09's unchanged regression suites.                                                                                                                     |

## Plan self-review

Checked against all approved specification sections and 42 test IDs. Interfaces consistently use the named `ProjectResult` union; portable DTOs stay separate from runtime context, and metadata `origin` maps explicitly to existing `source`. Runtime capture/preparation types are defined in Task 4 before either controller or Task 5 uses them. Normal image/export undo rules, empty-base FPS fallback, repairable render errors, PIP source kind, stale historical-image callbacks, staging adoption, and last-lease cleanup each have explicit owners and tests. The plan contains no unresolved placeholders, automatic commit/push commands, backend/package/configuration work, playback-hook changes, or render-builder changes. No implementation or verification-suite success is claimed by writing this plan.
