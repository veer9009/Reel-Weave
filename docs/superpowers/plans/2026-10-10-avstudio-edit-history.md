# AVStudio Edit History (Undo/Redo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This file is planning output only; execution requires a separate user instruction.

**Goal:** Add reliable local Undo/Redo for every approved completed edit, with a 30-edit limit and no history for sources, transport, or delivery state.

**Architecture:** Use immutable metadata snapshots and an App-owned history controller, with a separate session source registry that retains original File references and manages runtime URLs. Explicit gesture transactions separate preview from completion; existing timeline calculations and manifest serialization consume materialized current edit state. Nonhistorical imports and excluded controls rebase retained snapshots according to the approved spec.

**Tech Stack:** Existing React 19, TypeScript, lucide-react, Vitest, Testing Library, Vite, ESLint, and Prettier. No dependency changes.

**Spec:** [Approved design](../specs/2026-10-10-avstudio-edit-history-design.md). Read it together with this plan; the user's approval supersedes its earlier “for review” status.

## Global constraints

- Implement only the approved frontend history scope. No backend, FFmpeg, API, multipart, package, lock-file, configuration, or system-setting changes.
- No persistence, autosave, new tracks, transitions, history browser, or platform-specific Meta shortcuts.
- Keep the latest **30 completed reversible edits**: `past.length + future.length <= 30`; present and the oldest predecessor are bookkeeping.
- Snapshots contain lightweight editable metadata only. No File, Blob, buffers, URLs, readiness status, jobs, selection, playback, focus, or dialog drafts in history.
- New Project clears past, future, transactions, pending PIP intent, and source ownership; it is never undoable.
- A changed user edit after Undo clears Redo. Rejected/no-op edits and source metadata callbacks do not.
- Supported edits: reorder, saved/direct trim, split, Ripple Delete, version replacement, PIP add/replace/remove/position/size, original/music volume/mute, and requested timeline FPS.
- Preserve excluded speed controls, PIP start/end controls, image overlays, background-music asset controls, imports, playback, rendering, downloads, and existing New Project behavior exactly as specified through rebasing or separate state.
- Do not include or execute version-control mutations, deployment operations, destructive commands, or installation steps. All commands below are prospective verification commands unless explicitly marked as the planning self-review.
- This planning task changes only this file. It does not execute the implementation tasks, tests, build, or manual checklist.

## Review focus

1. Later source imports and same-name files must survive an older Undo without identity collisions or erasing their placement: Tasks 2–3.
2. Removing one split half or consuming a Version 2 donor must not invalidate URLs still needed by survivors or history: Tasks 2, 4, 9.
3. Pointer up followed by lost capture, cancellation, or an editing lock must not double-commit or leave a tentative trim: Task 5.
4. Delayed PIP readiness after another edit, a superseding upload, Undo, or New Project must not overwrite newer state: Tasks 3, 6.
5. Render failure/results, typing, and playback reconciliation must stay outside history even when Undo is accepted: Tasks 7–9.

## Inspection findings and future file map

The current working tree already contains uncommitted Split, permanent Split toolbar, Ripple Delete, and approved design work. Preserve that baseline; do not revert or absorb unrelated changes. Source code/tests are untouched by this planning task.

| Future file | Responsibility / inspected integration |
| --- | --- |
| Create `frontend/src/lib/editHistory.ts` and `.test.ts` | Snapshot types, action kinds, immutable past/present/future transitions, equality, capacity, rebasing. |
| Create `frontend/src/lib/projectSources.ts` and `.test.ts` | Session source identity, original File references, metadata tokens, URL reachability and cleanup. |
| Create `frontend/src/lib/historyProjection.ts` and `.test.ts` | Materialize existing Clip/PIP shapes and validate restoration without changing timeline/render formulas. |
| Create `frontend/src/hooks/useEditHistory.ts` and `.test.tsx` | App-owned controller, transaction preview, source updates, atomic navigation, structural revision, lifecycle. |
| Create `frontend/src/hooks/useHistoryShortcuts.ts` and `.test.tsx` | Ctrl history commands, typing/modal/gesture/lock guards, browser-default behavior. |
| Create `frontend/src/components/PipCandidateProbe.tsx` and `.test.tsx` | Probe a staged PIP candidate separately from the committed overlay; report identity-bound readiness/error. |
| Create `frontend/src/components/BackgroundAudioTrack.test.tsx` | Volume transaction and mute boundary tests; this component currently has no dedicated test file. |
| Create `frontend/src/components/TimelineTrimHandle.test.tsx` | Direct pointer transaction boundaries; currently covered indirectly in App tests. |
| Create `frontend/src/App.history.test.tsx` | History integration tests against the real App, fetch boundary, and runtime media resources. |
| Create `frontend/src/test/historyFixtures.ts` | Test-only snapshot, health/merge stub, metadata-ready uploads, pointer events, and lane geometry utilities. |
| Modify `frontend/src/App.tsx` | Replace independent committed clip/PIP/mix/FPS setters with controller ownership. Retain external image/music/job/error state. Adapt existing handlers and New Project. |
| Modify `frontend/src/components/EditingWorkspace.tsx` and `.test.tsx` | Propagate trim transactions; add visible Undo/Redo beside Split; install history shortcuts while retaining existing delete guards and selection reconciliation. |
| Modify `frontend/src/components/ProjectTimeline.tsx` and `.test.tsx` | Pass trim gesture boundaries; retain `onMove(from,to)` on valid drop and the `videoToolbar` ReactNode slot immediately above Video 1. |
| Modify `frontend/src/components/TimelineTrimHandle.tsx` | Preserve source-FPS/speed/pixel mapping while adding begin/commit/cancel callbacks around live preview. |
| Modify `frontend/src/components/BackgroundAudioTrack.tsx` | Preserve asset controls; distinguish range preview/completion and discrete mute edits. |
| Modify `frontend/src/components/OverlayTrack.tsx` and `.test.tsx` | Keep committed PIP visible during candidate loading; expose candidate feedback/probe integration and protect metadata identities. |
| Modify `frontend/src/App.test.tsx` only where required | Update immediate URL-revocation expectations that intentionally change under history ownership. Preserve source-frame, render, layout, and delivery assertions. |
| Existing files used unchanged | `lib/clips.ts`, `lib/timeline.ts`, `lib/overlays.ts`, `lib/api.ts`, `components/ClipList.tsx`, `components/TrimEditor.tsx`, `hooks/useProjectPlayback.ts`, renderer/preview/result components, styles/config/package files. |

`ClipList` already skips FPS probing when a clip has ready metadata. Keep that behavior; bind its existing `(id, metadata)` callbacks in App to the source/session mapping captured for that render. `TrimEditor` already stages its draft locally and supplies `onSave(id, trim)` / `onCancel()`. Keep those interfaces. Background-audio metadata callbacks also need render-captured source tokens in App; no asset history is added.

## Interface contracts shared across tasks

Use the exact snapshot fields from the spec: `Video1Occurrence {id, sourceId, trim: ClipTrim | null, trimSaved, speed}`, `PipOccurrence {id, sourceId, startFrame, endFrame, position, size}`, `EditSnapshot {video1, pip, audio, fpsSelection}`, `HistoryEntry {action, label, before, after}`, and `EditHistory {past, present, future}`. Arrays/retained objects are immutable. Import existing trim/speed/FPS/audio/overlay types from their current libraries.

Export `HistoryAction` with these literal kinds: `reorder`, `trim`, `split`, `ripple-delete`, `version-replace`, `pip-add`, `pip-replace`, `pip-remove`, `pip-position`, `pip-size`, `audio-volume`, `audio-mute`, `fps`. Labels are human-readable status descriptions, not identity keys.

Define `GestureToken = string`, `SourceKind = 'video1' | 'pip' | 'image' | 'music'`, `SourceToken = {session: number; sourceId: string; requestId: number}`, and `SourceMetadata = {clipMetadata?: ClipMetadata; duration?: number}`. Validate the required metadata fields according to source kind. Readiness lives in the source registry, never snapshots.

Define `HistoryControls = {canUndo: boolean; canRedo: boolean; shortcutsAllowed: boolean; undo: () => boolean; redo: () => boolean}`. `shortcutsAllowed` means editor eligibility independently of stack emptiness; it is false while locked, a gesture is active, or a Trim draft is open. Buttons use `canUndo/canRedo`; eligible keys with an empty stack still prevent browser default.

All prospective npm commands run from `frontend` in PowerShell with existing dependencies. Use `npm.cmd` to avoid the disabled `npm.ps1` execution-policy path. `--maxWorkers=1 --pool=threads` is a command-line test-runner option already used successfully here, not a configuration change. A test process must finish with exit 0 to count as green, even if it printed passing assertions first.

## Task 1: Pure metadata history and test fixtures

**Files:** Create `lib/editHistory.ts`, `lib/editHistory.test.ts`, and `test/historyFixtures.ts` under `frontend/src`.

**Produces:**

- `createHistory(initial: EditSnapshot): EditHistory`.
- `snapshotsEqual(a: EditSnapshot, b: EditSnapshot): boolean`.
- `commitHistory(history: EditHistory, action: HistoryAction, label: string, next: EditSnapshot): EditHistory`.
- `undoHistory(history: EditHistory): EditHistory`, `redoHistory(history: EditHistory): EditHistory`.
- `rebaseHistory(history: EditHistory, rewrite: (snapshot: EditSnapshot) => EditSnapshot, userEdit: boolean): EditHistory`.
- `historySnapshot(ids?: string[]): EditSnapshot` test helper: default IDs `a,b`, source IDs `source:a,source:b`, trims `0..59`, unsaved trims, speed 1, no PIP, existing mix defaults, requested FPS `'30'`.

- [ ] Write failing `empty_and_noop`, `round_trip_and_branch`, `capacity_30`, `immutable_lightweight_values`, and `saved_flag_is_a_change` cases. Representative literal expectations:

  ```ts
  expect(initial.past).toHaveLength(0);
  expect(undoHistory(initial)).toBe(initial);
  expect(commitHistory(initial, 'reorder', 'Reorder clips', initial.present)).toBe(initial);
  // After 31 distinct trim commits and 30 Undos:
  expect(restored.present.video1[0].trim).toEqual({ startFrame: 1, endFrame: 59 });
  expect(restored.past.length + restored.future.length).toBe(30);
  expect(branch.future).toHaveLength(0);
  ```

- [ ] Run `npm.cmd test -- src/lib/editHistory.test.ts --maxWorkers=1 --pool=threads`; confirm each case fails due to the missing transition behavior. Resolve fixture/import errors before treating failure as red evidence.
- [ ] Implement the listed interfaces with last-item stack navigation, oldest-entry eviction, value equality, and immutable before/after snapshots. Include `trimSaved`, speed, identity, PIP schedule, mix values, and FPS in equality. Do not introduce a watcher of arbitrary state changes.
- [ ] Run the same command; require all cases green, snapshot objects unchanged after navigation, and no prohibited runtime/binary values in snapshots.

## Task 2: Source identity, URLs, and restoration projection

**Files:** Create `lib/projectSources.ts`, `.test.ts`, `lib/historyProjection.ts`, and `.test.ts`.

**Consumes:** Snapshot types from Task 1; existing Clip/ClipMetadata/OverlayState types and `validateTrim`.

**Produces:**

- `createProjectSources(): ProjectSources`, with `register(file: File, kind: SourceKind): SourceToken`, `get(sourceId: string): SourceRecord | undefined`, `markReady(token: SourceToken, metadata: SourceMetadata): boolean`, `markError(token: SourceToken): boolean`, `ensureUrl(sourceId: string): string`, `setExternalOwners(ids: ReadonlySet<string>): void`, `externalOwners: ReadonlySet<string>`, `reconcileUrls(reachable: ReadonlySet<string>): void`, and `clear(): void`.
- `SourceRecord` contains its token, kind, original File reference, current readiness (`loading/ready/error`), optional metadata/duration, and optional runtime URL. `clear()` releases URLs and advances the session generation; IDs never reuse filename identity. Each method rejects stale tokens without mutation.
- `collectReachableSources(history: EditHistory, preview: EditSnapshot | null, pending: readonly SourceToken[], externalOwners: ReadonlySet<string>): ReadonlySet<string>`. Include currently active nonhistorical image/music resources, not just snapshot/PIP resources; history cleanup cannot revoke their live URLs.
- `materializeSnapshot(snapshot: EditSnapshot, sources: ProjectSources): {clips: Clip[]; pip: OverlayState['video']}`.
- `validateRestoration(snapshot: EditSnapshot, sources: ProjectSources, limits: Limits): string | null`.

- [ ] Write failing registry/projection tests: same-name sources receive different IDs; both split halves materialize the exact same original File; ready/error metadata is current; no re-probe on restoration; stale session/request callbacks fail; current/past/future/preview/probe and external image/music references retain URLs; eviction/branching/unmount cleanup releases unused URLs once.
- [ ] Add atomic validation cases for missing sources, duplicate occurrence IDs, invalid integer/inclusive trims, and capacity after a later import. Assert a PIP schedule beyond project duration is preserved rather than clamped/rejected as a restoration failure. A source with latest error status must not materialize as ready.
- [ ] Run `npm.cmd test -- src/lib/projectSources.test.ts src/lib/historyProjection.test.ts --maxWorkers=1 --pool=threads`; confirm feature-related failures.
- [ ] Implement source-level runtime URL ownership; retain accepted File references until session end, independent of history placement. Permit loading imported occurrences with null trim to materialize as unavailable/loading. Validate intrinsic ready trims against source metadata; do not change project timing formulas. Unknown source IDs must fail before any history state is applied.
- [ ] Run the same command. Verify `expect(restoredClip.file).toBe(originalFile)` and `expect(restoredClip.url).not.toBe(revokedUrl)` when recreating a URL; count URL creation/release without asserting incidental distinct URLs for halves.

## Task 3: Controller, transactions, rebasing, and session clearing

**Files:** Create `hooks/useEditHistory.ts`, `.test.tsx`; extend `test/historyFixtures.ts` only with test utilities.

**Consumes:** Tasks 1–2. Define `HistoryOptions = {limits: Limits; editingLocked: boolean; trimDraftOpen: boolean; onError: (message: string) => void; onAnnouncement: (message: string) => void}`.

**Produces:** `useEditHistory(options: HistoryOptions): EditHistoryController`, owning its registry, current source revision, history, optional synchronous transaction, and pending PIP intent. The controller exposes:

- `history: EditHistory`, `view: EditSnapshot` (preview if active, otherwise present), `sources: ProjectSources`, `structuralRevision: number`, `gestureActive: boolean`, and `controls: HistoryControls`.
- `commit(action: HistoryAction, label: string, next: EditSnapshot): boolean`.
- `begin(action: 'trim' | 'audio-volume', targetId: string): GestureToken | null`, `preview(token: GestureToken, next: EditSnapshot): void`, `finish(token: GestureToken, accept: boolean): boolean`.
- `importVideo1(files: File[]): void`, `sourceReady(token: SourceToken, metadata: SourceMetadata): boolean`, `sourceError(token: SourceToken): boolean`.
- `rebaseSpeed(id: string, speed: ClipSpeed): void`, `rebasePipRange(id: string, changes: Partial<Pick<PipOccurrence, 'startFrame' | 'endFrame'>>): void`, `excludedUserEdit(): void`, `notifyStructuralChange(): void`, `clearProject(): void`.
- Pending-PIP interfaces used by Task 6: `stagePip(file: File): SourceToken`, `pendingPip: SourceToken | null`, `completePip(token: SourceToken, metadata: SourceMetadata): boolean`, `failPip(token: SourceToken): void`, `cancelPendingPip(): void`. Define these in Task 6; until then pending reachability is empty.

The modal flag blocks Undo/Redo and unrelated gestures, not the validated `trim` commit produced by that dialog's Save button. `finish` may complete its own transaction even though navigation is disabled while that transaction exists. Other discrete edits cannot bypass an active transaction; their UI must complete/cancel the transaction first.

- [ ] Write failing hook tests using `renderHook`/`act`: changed commit clears future, no-op/rejected commit preserves it, 30-step budget, two gestures cannot overlap, multiple previews leave past unchanged, finishing once commits once, cancelling restores committed values, and controller calls reject current locked/modal/gesture eligibility regardless of button state.
- [ ] Add rebasing tests: import `c` after history of `a,b`, Undo retains `c`; readiness fills only null trims; explicit saved trims survive; speed updates only matching IDs across retained snapshots; PIP range updates only matching PIP IDs; actual excluded user edits clear future while metadata callbacks preserve it. Test capacity failure keeps stacks and present identical.
- [ ] Add `new_project_is_not_undoable_and_old_tokens_are_ignored`: after Undo with both stacks populated, clear returns defaults (`auto`, empty Video 1/PIP, volume 1/0.3, unmuted), both stacks empty, and no old source callback can repopulate state. Registry cleanup is also tested on hook unmount.
- [ ] Run `npm.cmd test -- src/hooks/useEditHistory.test.tsx --maxWorkers=1 --pool=threads`; confirm all new cases fail for missing controller behavior.
- [ ] Implement atomic controller operations and synchronous current-state access so sequential events and stale closures cannot navigate an outdated history. Validate a candidate restoration before moving stacks or preparing its resources. Reconcile URL reachability after accepted state changes and cancellation. Increment structural revision once for changed structural commits/navigation and explicit nonhistorical geometry changes; pure audio actions do not increment it.
- [ ] Implement import/speed/range rebasing through `rebaseHistory`. Append imported occurrences in order to retained snapshots, cancel a trim draft before importing geometry-changing sources, clear future for changed user operations, and preserve it for readiness/error callbacks. No current image/music/job state lives here.
- [ ] Run the same hook command plus Tasks 1–2 tests; require clean exits. Ensure Undo errors use `onError` without dropping entries and delivery errors are not cleared implicitly.

## Task 4: Integrate discrete Video 1 actions with App

**Files:** Modify `App.tsx`, `EditingWorkspace.tsx`, and `EditingWorkspace.test.tsx`; create `App.history.test.tsx`; extend `test/historyFixtures.ts`. Existing calculation libraries remain unchanged.

**Consumes:** Controller methods and materialization from Tasks 2–3; existing `moveClip`, `planClipSplit`, `planVersionReplacement`, `buildTimeline`, and `buildMergeManifest`.

**Interfaces:** Keep current `reorder(from: number, to: number): void`, `saveTrim(id: string, trim: ClipTrim): void`, `removeClip(id: string): void`, `splitAtPlayhead(id: string, frame: number): string | void`, and `replaceAfterPlayhead(targetId: string, sourceId: string, frame: number): number | void` signatures for their existing consumers. Their results now update controller metadata rather than independent clip state. New IDs are generated on a new action only, never on history replay. Add `historyControls?: HistoryControls` to `EditingWorkspace` here so integration tests can navigate the real App using the actual buttons; Task 8 adds shortcuts to this interface.

Test fixtures provide `serveHistoryMerge(expectedNames: string[]): void` at the fetch boundary, `uploadReadyVideos(files: File[], fps?: number): Promise<void>`, and `readSubmittedManifest(): MergeManifest`. Adapt the current health/merge job stub and metadata events into this test-only helper; do not expose test hooks in application classes or migrate unrelated old tests.

- [ ] Write failing `reorder_history`, `split_history`, `ripple_delete_history`, `version_replace_history`, and `saved_trim_history` groups in `App.history.test.tsx`. Verify visible button/keyboard deletion share one removal, reorder drops create one changed order, and direct reorder rejects self/external/cancelled drops without history.
- [ ] Write failing `history_toolbar` cases in `EditingWorkspace.test.tsx`: one always-visible Undo/Redo pair beside Split even with Inspector closed; native disabled states and accessible names; `aria-keyshortcuts="Control+Z"` / `"Control+Y Control+Shift+Z"`; visible hints; no selection requirement; Undo enabled after a recorded final deletion; connected triggering focus retained. Cases use a real controller harness and changed edit states, not a fake history implementation.
- [ ] Use hand-checked literals: split a 30-FPS `0..59` source at project frame 19 -> `0..19`, `20..59`; a 0.5x source at project frame 39 -> source cut 19. Undo restores original IDs/ranges, Redo restores the same derived IDs. For replacement with a preceding donor, Undo restores donor/target positions; Redo preserves source-time mapping and consumed-occurrence order.
- [ ] Assert deletion of either split half and final-clip deletion round-trip Video 1 and Audio 1 consecutively. Restoring the final clip restores render eligibility without resurrecting a historical selection or resetting PIP/music membership.
- [ ] Run `npm.cmd test -- src/App.history.test.tsx src/components/EditingWorkspace.test.tsx -t 'reorder_history|split_history|ripple_delete_history|version_replace_history|saved_trim_history|history_toolbar' --maxWorkers=1 --pool=threads`; confirm failures before integration. Use native Undo/Redo toolbar clicks against the real App; no temporary test API or mock editor is permitted.
- [ ] Replace committed clip ownership in App with `controller.view` materialization; replace import/speed/metadata setters with controller methods. Keep image/music, render jobs, errors, results, announcements, and dialog identity outside history. Capture source/session tokens in existing ClipList callback closures; retain its ready-source probing guard.
- [ ] Route supported action results to one metadata commit each. Retain original forward split selection/playhead behavior and forward replacement anchor; Undo/Redo itself does not call those handlers or restore those anchors. Preserve saved-trim flags and every existing speed value. Remove immediate clip/donor URL release in favor of registry ownership.
- [ ] Connect New Project to `clearProject()` plus the existing external state resets. Keep current render locks and max-clips validation. Undo/Redo functions must not call `setJob(null)` or erase network/delivery errors.
- [ ] Render native Undo/Redo buttons through the current `ProjectTimeline.videoToolbar` slot, alongside Split. Use the exact accessibility/hint values asserted above and controller controls for clicks/disabled state; harnesses with no controls render disabled buttons. Supply `trimDraftOpen` from App's `editingClipId`, and announce accepted navigation through the existing polite status region.
- [ ] Run the same focused command and existing `App.test.tsx`, `lib/split.test.ts`, and `lib/versionReplacement.test.ts`. Only update old immediate-URL-release expectations after new resource-ownership tests demonstrate why the retained URL is required. In particular, the old donor-removal/unmount tests may assert eventual release at history eviction/session end instead of immediate removal; retain their survivor/order assertions.

## Task 5: Direct trim and dialog action boundaries

**Files:** Modify `TimelineTrimHandle.tsx`, `ProjectTimeline.tsx`, `EditingWorkspace.tsx`, `App.tsx`; create `TimelineTrimHandle.test.tsx`; extend `App.history.test.tsx`, `ProjectTimeline.test.tsx`, and `EditingWorkspace.test.tsx` as needed. Keep `TrimEditor.tsx` unchanged.

**Interfaces:** Add the same optional boundary props to the three timeline layers: `onTrimBegin?: (id: string) => GestureToken | null`, `onTrimPreview?: (token: GestureToken, id: string, trim: ClipTrim) => void`, `onTrimEnd?: (token: GestureToken, accept: boolean) => void`. Store the token with the pointer drag. Retain the existing `onTrim(id, trim)` path for consumers without transaction callbacks; App uses the full transaction path. `onDragActive(active)` remains solely timeline geometry/highlight control.

- [ ] Write failing `trim_gesture_history` component/App tests: five moves update visible width/source frames, no history before release, one Undo returns the full baseline, and a second Undo cannot walk individual movements. Test matching pointer identity, disabled interaction, and preserved FPS/speed math.
- [ ] Add cancellation/lost-capture/lock/unmount/target-removal tests. Assert accept-false restores range with no entry; ordinary capture release after accepted up is inert. A move away and back to baseline must leave `trimSaved` unchanged and preserve Redo; otherwise the drag would appear changed solely because a preview set a saved flag.
- [ ] Add dialog Save/Cancel tests: Save toggling `trimSaved` false->true is one edit even at unchanged frame values; invalid Save and Cancel/Escape add nothing. History controls stay unavailable throughout the open draft.
- [ ] Run `npm.cmd test -- src/components/TimelineTrimHandle.test.tsx src/App.history.test.tsx -t 'trim_gesture_history|trim_dialog_history' --maxWorkers=1 --pool=threads`; confirm missing-boundary failures.
- [ ] Forward callbacks through workspace/timeline. Begin captures committed baseline, previews retain baseline saved-flag semantics, accepted changed trim sets `trimSaved: true` once, and cancel rolls back. Use token identity to ignore late up/cancel events. Keep existing pixel-to-source-frame calculation and drag-only geometry freeze intact.
- [ ] Cancel pending trim on loss of target, editing lock, or geometry-changing import; never serialize an unfinished preview. Disable submission during active gestures and let normal pointer up complete the edit before an ordinary Render click. Dialog Save continues calling `saveTrim`; dialog draft-open status participates in controller eligibility.
- [ ] Run the focused command and existing App direct-trim, `TrimEditor.test.tsx`, and `ProjectTimeline.test.tsx` tests; verify no changed calculation assertions.

## Task 6: PIP placement history and asynchronous candidates

**Files:** Create `PipCandidateProbe.tsx` and `.test.tsx`; modify `OverlayTrack.tsx`, `App.tsx`, `useEditHistory.ts`; extend `OverlayTrack.test.tsx`, `useEditHistory.test.tsx`, `App.history.test.tsx`.

**Consumes/produces:** Implement the pending-PIP controller methods declared in Task 3. `PipCandidateProbe` receives `{token: SourceToken; url: string; onReady: (token: SourceToken, duration: number) => void; onError: (token: SourceToken) => void}`. It renders a metadata probe for that source and validates finite positive duration. `OverlayTrack` adds `pipCandidate?: {token: SourceToken; url: string} | null`, `onPipCandidateReady?: (token: SourceToken, duration: number) => void`, and `onPipCandidateError?: (token: SourceToken) => void`; existing image handlers stay intact.

- [ ] Write failing `pip_history` tests for ready add/replace/remove and position/size round trips. After add Undo, asset reference remains registered but placement is null; Redo reuses source ID, occurrence ID, File, and valid preview URL. Removing absent PIP is a no-op.
- [ ] Write `pip_candidate_races`: committed old PIP remains visible during loading; invalid/failed probe produces no entry; latest candidate wins; an audio/FPS edit before readiness survives the PIP completion; accepted Undo/Redo/removal cancels placement intent; old readiness cannot repopulate after New Project. Source metadata notifications themselves preserve Redo.
- [ ] Test PIP range-field rebasing and unrelated image edits, and restored out-of-duration schedules using existing overlay validation rather than silent clamping/removal.
- [ ] Run `npm.cmd test -- src/components/PipCandidateProbe.test.tsx src/hooks/useEditHistory.test.tsx src/App.history.test.tsx -t 'pip_history|pip_candidate_races|PipCandidateProbe' --maxWorkers=1 --pool=threads`; require feature-related failures before code changes.
- [ ] Separate file validation/registration from committed placement. On latest valid readiness, apply only the PIP placement to the latest committed snapshot, using the existing schedule preservation/default rules. Generate a placement ID only for a new ready placement; commit replacement atomically. Complete/fail callbacks are bound to session/source/request identity.
- [ ] If a valid candidate becomes ready while editing is locked or a synchronous transaction/dialog is active, update only its registry readiness and defer placement. Revalidate the still-current candidate when eligibility returns; never edit a locked/completed render project. Supersession, removal, accepted navigation, or New Project cancels that deferred intent. Test that no ready callback bypasses controller eligibility.
- [ ] Branch `changeOverlaySchedule`: PIP position/size -> discrete supported commits; PIP start/end -> same-ID nonhistorical rebasing; image changes -> external state plus changed-user-edit Redo clearing. Preserve image/source loading/error behavior and existing PIP EOF preview behavior.
- [ ] For external image assets, hold the current source token in App's nonhistorical state and update `sources.setExternalOwners` synchronously before cleanup can run. Bind image callbacks to that token. Registry-owned URLs must not also be revoked by the legacy App URL set; maintain one cleanup owner per URL.
- [ ] Run the focused command plus `OverlayTrack.test.tsx` and existing PIP/drop App tests. Update only PIP candidate-timing/resource assertions intentionally changed by the approved design; failed candidates must leave the prior committed overlay intact.

## Task 7: Audio gestures and requested FPS history

**Files:** Modify `BackgroundAudioTrack.tsx`, `App.tsx`; create `BackgroundAudioTrack.test.tsx`; extend `App.history.test.tsx`, `useEditHistory.test.tsx`.

**Interfaces:** Preserve `onSettings(settings: AudioSettings)` for discrete settings changes. Add optional range callbacks `onVolumeBegin?: (field: 'originalVolume' | 'musicVolume') => GestureToken | null`, `onVolumePreview?: (token: GestureToken, field: 'originalVolume' | 'musicVolume', value: number) => void`, `onVolumeEnd?: (token: GestureToken, accept: boolean) => void`. Keep all background asset controls unchanged. FPS stays `(selection: ProjectFpsSelection) => void` at the workspace boundary.

- [ ] Write failing `audio_history` tests for original/music volumes and mutes. Pointer drag with repeated values commits once on up; cancellation restores; range keyboard keys coalesce until keyup; blur commits a keyboard adjustment only once; discrete assistive change commits once without an active token; unchanged values preserve Redo. Check changed volume is divided by 100 exactly as today and unrelated mix fields survive.
- [ ] Write `fps_history`: `'30' -> '25' -> Undo -> Redo` yields requested `'30'/'25'` and correct projection; `auto` derives from the restored first source. Selecting the existing value adds no entry.
- [ ] Add exclusion checks: music file replacement/removal and image edits survive Undo, clear Redo only when changed by the user, and do not create entries. Captured generation/source tokens prevent obsolete music metadata errors/readiness from overwriting a replacement.
- [ ] Run `npm.cmd test -- src/components/BackgroundAudioTrack.test.tsx src/App.history.test.tsx -t 'audio_history|fps_history|excluded_assets' --maxWorkers=1 --pool=threads`; confirm red behavior.
- [ ] Connect volume gestures to controller begin/preview/finish, covering pointer capture, keyup, blur, cancel, and duplicate event guards. Mute calls commit only the changed boolean. A changed user command outside the active range must complete/cancel that range first; never fold unrelated fields into its baseline rollback.
- [ ] Replace direct `setAudioSettings` and FPS setters with metadata commits; keep music membership/readiness external and source-bound. Pure audio navigation never increments structural revision or seeks. FPS commits/navigation increment structural revision once and use existing resolution/timeline functions.
- [ ] Keep a nonhistorical current music source token in App; update external owners together with the image token when music is added/replaced/removed. Reconcile after membership changes without adding an entry, and retain the captured token for metadata callbacks. New Project clears external owners and registry URLs once; no duplicate legacy revocation remains for registry-owned sources.
- [ ] Run focused tests and existing audio/FPS manifest tests; existing transport regression tests stay green.

## Task 8: Guarded shortcuts and toolbar integration regression

**Files:** Create `hooks/useHistoryShortcuts.ts`, `.test.tsx`; modify `EditingWorkspace.tsx`, `.test.tsx`, `App.tsx`; extend `App.history.test.tsx`. Existing `ProjectTimeline.videoToolbar` and CSS suffice; do not redesign the editor.

**Interfaces:** `useHistoryShortcuts(controls: HistoryControls): void`; consume the `historyControls?: HistoryControls` workspace prop and actual toolbar controls introduced in Task 4. The hook owns its listener cleanup and does not alter the separate existing Ripple Delete keys.

- [ ] Write failing table-driven `history_shortcuts` tests for Ctrl+z/Z, Ctrl+y/Y, Ctrl+Shift+z/Z and keyboard/button parity. Match shifted Z before ordinary Z; reject Meta-only, Alt, composition, repeat, and pre-handled events. Input/textarea/select/contenteditable/textbox descendants retain native defaults and call neither action. Open Trim draft, active gesture, and each existing upload/queued/processing/completed lock are protected both in shortcuts and controller calls. Reuse the already-green `history_toolbar` cases as regressions; do not claim they demonstrate a new missing feature here.
- [ ] Assert eligible empty-stack chords prevent browser default, while protected typing/modal/gesture/locked chords do not. Toolbar clicks use the same functions as keys and never depend on selected Video 1 identity. Keep current focus if connected; valid current selection persists and missing IDs reconcile to none.
- [ ] Run `npm.cmd test -- src/hooks/useHistoryShortcuts.test.tsx src/components/EditingWorkspace.test.tsx -t 'history_toolbar|history_shortcuts' --maxWorkers=1 --pool=threads`; confirm missing-listener/parity failures for new shortcut cases.
- [ ] Implement the history hook with current eligibility refs/listener cleanup and install it in the workspace. Do not remap editor Delete/Backspace or native text Undo, duplicate toolbar buttons, or add another history controller.
- [ ] Run real toolbar/key interactions in `App.history.test.tsx`, all history UI/App tests, and existing Split-toolbar/Ripple Delete tests. Validate keyboard announcements use the same accepted-action messages as buttons.

## Task 9: Delivery invariants, complete verification, and manual acceptance

**Files:** Extend `App.history.test.tsx`, `useEditHistory.test.tsx`, and test-only fixtures. No changes to `lib/api.ts`, manifest types/functions, timeline formulas, playback hook, backend, or configuration.

- [ ] Before any integration correction, write failing `history_delivery` tests: after Undo and Redo, submitted files retain original File identity and exact remaining/restored order; manifest IDs, inclusive ranges, saved flags, speeds, audio, PIP, and requested output FPS match current committed state. Exercise one-clip and multi-clip output.
- [ ] Add failure/result isolation tests: Undo after a failed render leaves its job and delivery/network error unchanged; playback ticks/seeks, chooser/selection changes, downloads, and job polling do not add history or clear Redo. Completed/active jobs reject history navigation without unlocking the editor or changing preview/download URLs.
- [ ] Add resource/session regression tests for 31st edit eviction, Redo invalidation, Undo/Redo of both split halves, version donor restoration, PIP cancel/replace, New Project/unmount cleanup, and original File reuse. Audio Undo while playing does not pause/seek; structural Undo uses existing pause/clamp and never restores an old playhead or selection.
- [ ] Classify any new acceptance assertion that already passes as a regression check. Do not manufacture a failure or change production code solely to satisfy a red ritual. Any actual correction must have its own observed failing test before that correction is implemented.
- [ ] Run `npm.cmd test -- src/App.history.test.tsx src/hooks/useEditHistory.test.tsx src/lib/projectSources.test.ts --maxWorkers=1 --pool=threads`; record red evidence for any new behavior requiring correction, then make only the corresponding minimal frontend correction. Rerun to exit 0.
- [ ] Run focused unit/UI verification from `frontend`:

  ```powershell
  npm.cmd test -- src/lib/editHistory.test.ts src/lib/projectSources.test.ts src/lib/historyProjection.test.ts src/hooks/useEditHistory.test.tsx src/hooks/useHistoryShortcuts.test.tsx src/components/TimelineTrimHandle.test.tsx src/components/PipCandidateProbe.test.tsx src/components/BackgroundAudioTrack.test.tsx src/components/EditingWorkspace.test.tsx src/components/ProjectTimeline.test.tsx src/components/OverlayTrack.test.tsx src/App.history.test.tsx --maxWorkers=1 --pool=threads
  ```

  Require every test to pass and process exit 0; record file/test totals and any warnings.

- [ ] Run all frontend tests, including existing App, source-frame/speed, replacement, split, trim, PIP, preview, audio, and API suites:

  ```powershell
  npm.cmd test -- --maxWorkers=1 --pool=threads
  npm.cmd run lint
  npm.cmd run format:check
  npm.cmd run build
  ```

  Require exit 0 for each command. Do not install missing tools or change the test configuration/execution policy. If runner resource limits require a retry, report the unsuccessful attempt as well as the final result; passing assertion text with an abnormal exit is insufficient.

- [ ] Complete the manual checklist below against the existing local frontend/backend setup. Use the existing development command only if a frontend server is needed (`npm.cmd run dev`); do not change backend/configuration or deploy. If the existing renderer is unavailable, report which MP4/manual checks remain blocked rather than asserting they passed.
- [ ] From the repository root, inspect the diff for frontend scope and prohibited file changes, then run `git diff --check`; require no whitespace errors. Report pre-existing modifications separately. Do not perform broad formatting that changes unrelated files.
- [ ] Finish with the final **read-only** checkpoint `git status --short`. Include its exact output, files changed, focused/full test totals, lint/format/build/diff exit results, manual outcomes, and unresolved limitations in the implementation report. No version-control mutation or publishing step follows this checkpoint.

### Manual verification checklist

- [ ] Import three distinguishable clips; reorder via drag and move buttons. Undo/Redo preserves sequence and Audio 1 alignment. Hover/cancel/self-drop creates no history.
- [ ] Trim repeatedly during one drag; Undo returns directly to the original range. Cancel a drag and a Trim dialog; neither adds an entry. Save a dialog trim and reverse it once.
- [ ] Split a normal clip and a slow-motion clip at an interior playhead. Undo/Redo retains exact ranges and IDs. Delete either half and reverse it; survivor preview stays valid and no gap appears.
- [ ] Replace after playhead with a donor before the target. Undo restores both occurrences and order; Redo consumes the same donor and retains other order.
- [ ] Delete the only clip: normal empty timeline/render disabled; Undo restores it without requiring selection. PIP/music membership remains present.
- [ ] Add/replace/remove PIP, then position/size changes; reverse each completed action. Failed/superseded loading candidates leave prior placement intact. Undo or New Project during loading prevents late reappearance.
- [ ] Drag original/music volumes and toggle mutes; Undo reverses one gesture/toggle at a time. Test FPS including Auto. Audio-only Undo preserves transport; structural changes pause/clamp normally.
- [ ] Exercise Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z and visible buttons. Type/edit in the current input/select controls and Trim dialog; native editing remains unaffected. Verify textarea/contenteditable protection through the automated UI fixtures rather than adding new application controls. Empty-stack keys do not invoke browser navigation.
- [ ] Undo, make a new supported edit or successful import/excluded edit, and verify Redo clears. Import after existing history; older Undo keeps the imported occurrence. Same-name files stay independent. Seek/select/download/readiness does not clear Redo.
- [ ] Perform 31 distinct completed edits; exactly 30 remain reversible. New Project clears everything and cannot be reversed.
- [ ] Render once after Undo and in another project after Redo; verify actual MP4 source order, trims, speed, original audio, background mix, and PIP. Completed preview/download and locks work normally; a failed render's error/result is not erased by history.

## Coverage and planning self-review

| Approved requirement | Owning tasks |
| --- | --- |
| Metadata snapshots, 30 steps, branch clearing, no-op/rejection rules | 1, 3 |
| Source identity/no binary duplication, URL retention, callback generations | 2, 3, 6, 9 |
| Reorder, saved/direct trim, split, Ripple Delete, version replacement | 4, 5 |
| PIP add/replace/remove/position/size and candidate races | 6 |
| Original/music volume/mute and timeline FPS | 7 |
| Toolbar, keyboard chords, disabled states, typing protection | 4, 8 |
| Excluded state rebasing, New Project clearing, no persistence | 3, 4, 6, 7, 9 |
| Playback/selection/error/job/download isolation and existing MP4 behavior | 4, 7, 8, 9 |
| Focused/full suite, lint, formatting, build, diff, manual, final status | 9 |

Planning self-review: checked against every spec section; all five review-focus cases map to named tests; types and signatures are defined before consumption; pending PIP completion is based on latest committed state; resource ownership permits history restoration without binary cloning; pure audio does not force structural revision; excluded edits are rebased rather than accidentally made undoable. No placeholders, implementation bodies, package/config changes, version-control mutation steps, or implementation execution are included. The only artifact created for this task is this plan file.
