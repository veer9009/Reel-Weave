# AVStudio Edit History (Undo/Redo)

Date: 2026-10-10

Status: design specification for review. This document authorizes no implementation or implementation plan.

## Purpose and scope

Provide reliable in-memory Undo and Redo for completed local editing actions. Undo restores editable timeline metadata, not application sessions, uploaded media, playback, or delivery state. The implementation must remain frontend-only and use the existing timeline projection, source-frame calculations, and render contract.

Supported actions are Video 1 reorder, committed trim changes, Split at Playhead, Ripple Delete, version replacement at playhead, Video 2 PIP add/remove/position/size, original/music volume and mute, and timeline FPS selection. A PIP replacement is one atomic replacement of the existing PIP occurrence, using the approved add/remove behavior.

This design chooses immutable metadata snapshots with explicit edit transactions. An inverse-command system would require separate reversal logic for split, replacement, and deletion; watching all React state changes would incorrectly record metadata callbacks and each drag movement. Snapshots reuse the existing edit results and restore them atomically.

## Current-state integration points

The inspected working tree includes the existing Split toolbar and Ripple Delete changes.

| Location | Current behavior | History integration |
| --- | --- | --- |
| `frontend/src/App.tsx` | Owns `clips`, `overlays`, `audioSettings`, `fpsSelection`, `backgroundAudio`, jobs, errors, URL ownership, and `structuralRevision`. | Own one history controller for the editable subset. Route supported completed actions through explicit commits. Keep jobs, resources, and delivery state separate. |
| `App.reorder` / `ClipList.onMove` | Reorders the clips array for move buttons and timeline drops. | One commit for a successful drop or move-button activation. |
| `App.saveTrim` | Updates trim and `trimSaved`, closes the dialog, and increments structural revision. Also receives direct timeline drag updates. | Separate live preview updates from transaction completion. Dialog Save commits once; direct drag commits on release. |
| `TimelineTrimHandle.tsx` | Captures a starting trim and geometry; calls `onTrim` during pointer moves; ends on up/cancel/lost capture. | Expose distinct begin, preview, commit, and cancel boundaries. Do not turn every existing `onTrim` call into a history entry. |
| `ProjectTimeline.tsx` | Calls `onMove` only on a valid drop; hover changes only drop highlighting. Projects Audio 1 from the same items as Video 1. | Retain this drop boundary. Audio 1 follows restored Video 1 automatically; do not snapshot a separate original-audio sequence. |
| `App.splitAtPlayhead` | Uses `planClipSplit`; replaces one occurrence with two unique IDs and saved inclusive trims. | Commit the entire replacement once, including both occurrence IDs. Undo restores the original ID; Redo restores the same derived IDs. |
| `App.removeClip` / `EditingWorkspace.onDeleteClip` | Visible trash and guarded Delete/Backspace share array filtering; removed occurrence URL is revoked immediately. | Commit one removal. Change resource ownership so a history-reachable source remains usable after deletion. |
| `App.replaceAfterPlayhead` | Computes trims, consumes the chosen donor occurrence, inserts a new right occurrence, and may revoke the donor URL. | Commit target modification, donor consumption, and derived occurrence insertion together. Preserve all other occurrence order. |
| `App.selectOverlay`, metadata callbacks, `changeOverlaySchedule`, `removeOverlay` | PIP/image share handlers. File choice immediately installs a loading overlay and revokes the old URL; schedule fields update directly. | Apply history only to video/PIP membership, position, and size. Complete a PIP file action only after readiness; distinguish asset ingestion from placement. |
| `BackgroundAudioTrack.tsx` | Volume ranges emit `onSettings` on every change; mute controls update immediately. App passes `setAudioSettings` directly. | Commit a volume gesture once; commit each changed mute toggle once. Background-music file membership stays outside history. |
| Timeline FPS callback in `App` | Sets `fpsSelection` and increments revision. | Commit the requested selection, including `auto`, once. Resolved numeric FPS remains derived. |
| `EditingWorkspace.tsx` | Owns selection, Version 2 chooser, transient replacement anchor, and keyboard deletion; passes the Video 1 toolbar to `ProjectTimeline`. | Add history controls to this visible toolbar. Keep selection and chooser state outside snapshots. Use shared keyboard eligibility rules. |
| `useProjectPlayback.ts` | Owns frame/playing state; pauses and clamps when structural revision, FPS, duration, or availability changes. | Continue normal reconciliation after a restored edit. Never restore a historical frame, start playback, or add transport actions to history. |
| `buildTimeline`, `buildMergeManifest`, `submitMerge` | Derive sequential timing and serialize current ordered clips/settings and current files. | Consume the restored current edit state without changing calculations, manifest fields, multipart payloads, or API behavior. |
| `App.newProject` and unmount cleanup | Release URLs and reset project state. | Clear past, future, transactions, and resource ownership together. New Project itself cannot be undone. |

## State ownership and snapshot data shape

Use an App-owned history reducer/controller. Its `present` is the committed editable state. A gesture may have a temporary preview state, but render submission cannot consume an unfinished gesture. Do not maintain separately writable copies of historical and live committed edit state.

The following conceptual TypeScript shapes describe the data contract, not implementation code:

```ts
type Video1Occurrence = {
  id: string;                 // stable timeline occurrence ID
  sourceId: string;           // lookup into the nonhistorical source registry
  trim: ClipTrim | null;      // null only while an imported source initializes
  trimSaved: boolean;
  speed: ClipSpeed;
};

type PipOccurrence = {
  id: string;
  sourceId: string;
  startFrame: number;
  endFrame: number;
  position: OverlayPosition;
  size: OverlaySize;
};

type EditSnapshot = {
  video1: readonly Video1Occurrence[]; // array order is render order
  pip: PipOccurrence | null;
  audio: AudioSettings;               // four existing volume/mute fields
  fpsSelection: ProjectFpsSelection;
};

type HistoryEntry = {
  action: HistoryAction;              // supported action kind
  label: string;                     // e.g. "Split clip"
  before: EditSnapshot;
  after: EditSnapshot;
};

type EditHistory = {
  past: readonly HistoryEntry[];      // oldest -> newest; last is next Undo
  present: EditSnapshot;
  future: readonly HistoryEntry[];    // last is next Redo
};
```

`HistoryAction` enumerates only the supported actions listed in Scope. Optional transaction state contains an action kind, a baseline snapshot, target identity, and gesture identity; it is transient and does not consume history capacity.

Snapshots contain primitive edit values and immutable metadata objects. Copy changed arrays/records, never mutate retained snapshots. No `File`, `Blob`, binary buffers, media elements, object URLs, source metadata loading/error status, promises, job IDs, or transport/selection state belongs in snapshots. Structural sharing is allowed; binary cloning and JSON serialization of runtime objects are forbidden.

A separate project-session source registry maps opaque source IDs to the original `File` object, current metadata/readiness, source kind, and probe generation. Registration occurs once per accepted source identity; split halves reference the same source ID and the same original File. Different accepted replacements use different source IDs even when filenames match. Duplicate filenames are never identity keys.

Materialize the existing `Clip` and overlay objects from current occurrence metadata plus registry resources. The public renderer still receives the same existing objects and ordered files. Source FPS comes from current registry metadata; project-frame geometry, resolved Auto FPS, total duration, and Audio 1 segments are derived, never stored in history.

Image overlay state and background-music asset membership remain current App/session state outside the snapshot. Audio settings are global mix settings, so music volume/mute history does not resurrect or remove a music file.

## History rules and capacity

1. Validate a supported action, compute its final edit result using existing helpers, and compare editable values with the committed baseline. Rejected actions and genuine no-ops leave both stacks unchanged.
2. A successful completed edit appends `{before, after, action, label}` to `past`, replaces `present` with `after`, and clears `future` atomically. A gesture that finishes at its original editable state adds nothing and preserves Redo.
3. Undo pops the newest past entry, restores its `before`, and pushes that same entry onto `future`. Redo pops the newest future entry, restores its `after`, and pushes it back onto `past`. Neither command records another edit.
4. Keep the latest **30 completed reversible edits**. `past.length + future.length` never exceeds 30. The current snapshot and the predecessor needed to reverse the oldest retained edit are bookkeeping, not extra completed edits. At the 31st commit, discard the oldest entry. Thirty Undos then reach the state after edit 1, not the initial state. This makes the capacity convention explicit.
5. Undo/Redo preserves occurrence IDs exactly. It must not rerun split/version-replacement ID generation, ingest files again, or regenerate source FPS estimates. Restored IDs remain unique.
6. A no-history metadata callback, playback tick, seek, selection, render lifecycle event, or download never appends an entry or clears Redo.
7. New Project clears both stacks, any draft gesture and pending PIP placement, and establishes the normal empty-project defaults. It increments a session generation so old asynchronous callbacks cannot repopulate the new project. Reload/unmount also ends history; there is no persistence.

## Excluded edits and source arrival

Do not implement “Undo upload” or silently erase newly imported clips when applying an older snapshot. Successful Video 1 import is a nonhistorical baseline addition: append each new initial occurrence in import order to `present` and to every retained entry's `before` and `after`. This preserves the new occurrence across older Undos and Redos while still allowing a later, explicitly recorded Ripple Delete to remove its placement. Existing occurrence order within each snapshot remains unchanged.

Source readiness is updated in the registry without an entry. Initialize a newly imported occurrence's null trim to its full source range in every snapshot that references that occurrence; never overwrite an explicit saved trim. Failed metadata changes availability/errors, not history topology. Rebased snapshots must remain internally consistent across neighboring entries.

Other existing editing controls outside this approved history scope also remain usable:

- Clip speed changes are not a new supported history action. Rebase the changed speed onto the same occurrence ID wherever it exists in `present` or retained snapshots; no ancestor/sibling propagation across different split IDs. Thus speed changes are not reversed by unrelated Undo, and restored split/version occurrences retain their own recorded speed.
- Existing PIP start/end schedule edits are not newly made undoable. Rebase the changed fields wherever that same PIP occurrence ID exists; null/different occurrences remain unchanged. Capture default schedule values for a supported PIP add/remove so that placement restoration is complete.
- Image overlay edits and background-music file add/replace/remove affect only their nonhistorical state; history application must leave those fields untouched.

Any actual user edit after Undo, including these excluded edits or a successful import, clears `future`. Perform the required baseline rebasing on the retained `past`; do not clear valid past history merely because a source was imported. Metadata completion or failed file selection is not a new user edit and does not clear `future`.

## Resource and asynchronous lifecycle

Undoable deletion/removal cannot use the current immediate source-release behavior unchanged. The project source registry keeps the original file references for the session, independently of placement history. Undo of PIP add removes its placement, not its uploaded source; Undo of Ripple Delete restores an occurrence without uploading or fetching again.

Preview URLs are runtime resources. Retain an existing URL while needed by live occurrences, pending probes, or history-reachable occurrences, or recreate it from the retained File before restoration. Use explicit ownership/reference accounting; do not restore a revoked URL string from a snapshot. Release an unused URL when the last relevant owner disappears, including history eviction and Redo invalidation. Shared source URLs must remain valid for surviving split halves. Source references may outlive URLs until New Project/unmount; the 30-entry limit bounds history metadata, not the total bytes of sources accepted during the session.

PIP file selection/drop stages a candidate outside committed edit state. Preserve the previous committed placement while probing; show loading feedback for the candidate. When that candidate is ready, commit its placement against the **current** committed snapshot, preserving intervening audio/FPS/other edits. File validation/probe failure produces no entry and leaves the prior placement intact. A newer PIP choice supersedes the older candidate; callbacks carry session, source, and request identity and cannot overwrite a newer choice. Removing the PIP or accepting Undo/Redo cancels pending placement intent so no stale callback can re-add it. Retain the accepted source independently of cancellation.

The same identity/generation checks apply to Video 1 and background-music metadata callbacks. Readiness notifications after history restoration update only their matching source; they cannot change occurrence topology or create history entries.

## Completed-action boundaries

| Action | Begin/preview | Commit | Cancellation / no-op |
| --- | --- | --- | --- |
| Video 1 reorder drag | Existing drag highlighting only; no committed order change. | One valid drop that changes order. | Self, external, invalid, locked, or cancelled drops create no entry. |
| Video 1 move button | No gesture draft. | One changed order per activation. | Boundary/invalid move creates no entry. |
| Timeline trim drag | Capture baseline at pointer down; continue live frame/width preview with existing source-FPS/speed calculations. | One entry on matching pointer up if editable values changed. | Pointer cancel, unexpected lost capture, disappearing target, or editing lock rolls back draft and creates no entry. Expected capture release after commit must not cancel or double-commit. |
| Trim dialog | Draft start/end/playhead remain local. | Save validates and commits one complete trim including `trimSaved`. | Cancel/Escape closes the dialog without an entry. Invalid Save cannot commit. |
| Split | Existing strict-interior eligibility and `planClipSplit` result. | One atomic original-to-left/right replacement. | Boundary, one-frame, capacity, unavailable metadata, or locked editing creates no entry. |
| Ripple Delete | Existing visible trash and keyboard action converge on one removal path. | One existing Video 1 occurrence removed; Audio 1 derives from the result. | Missing target, protected typing, or locked editing creates no entry. |
| Version replacement | Existing `planVersionReplacement` validates the operation. | One atomic edit containing target left trim, right insertion, and donor consumption. | Same-target, short-source, invalid-cut, or locked rejection creates no entry. |
| PIP add/replace | Candidate file registration/probe is nonhistorical. | One placement transaction when the latest candidate becomes ready. | Invalid/failed/superseded candidate creates no entry. |
| PIP remove | No draft. | One removal of the committed PIP occurrence. | Removing an absent PIP creates no entry. |
| PIP position/size | Select interaction. | One changed value on selection change. | Re-selecting the same value creates no entry. |
| Original/music volume | Pointer down captures baseline; range changes preview. Keyboard adjustment begins on the first value-changing range key. | Pointer up or keyboard keyup commits once; blur commits a changed keyboard adjustment if keyup did not occur. A discrete assistive-technology change with no active gesture commits once. | Pointer cancellation rolls back. Preserve any unrelated mix fields; duplicate up/blur events cannot commit twice. |
| Original/music mute | Checkbox toggle. | One changed boolean per activation. | Unchanged or disabled toggle creates no entry. |
| Timeline FPS | Existing FPS chooser. | One changed `ProjectFpsSelection` value, including `auto`. | Same selection creates no entry. |

Only one synchronous preview transaction may be active. Undo/Redo is disabled during that transaction and while a Trim dialog draft is open. Render submission must resolve a changed range interaction by its normal completion boundary first and must never serialize a tentative pointer-move state. If a new source import would change timeline geometry during a trim transaction, cancel that draft before rebasing the imported occurrences. Playback and selection changes may occur without becoming transactions.

Saving the same trim can still be a real edit if `trimSaved` changes from false to true: that flag affects existing render behavior. Equality must include all editable snapshot fields, not merely visible frame numbers.

## Keyboard and toolbar behavior

Add always-visible native `Undo` and `Redo` buttons to the existing toolbar directly above Video 1, alongside Split. Each has a clear accessible name, visible text, an optional decorative icon, and an `aria-keyshortcuts` value describing its supported chord. Native disabled state is required; an empty timeline alone must not disable Undo when a recorded deletion can be reversed. Provide shortcut hints and announce a successful action through the existing polite status region, for example `Undid Split clip.`

Both buttons and keys use the same App/controller functions and eligibility checks:

- Ctrl+Z: Undo.
- Ctrl+Y: Redo.
- Ctrl+Shift+Z: Redo; match this before Ctrl+Z.
- Accept case-insensitive key values. Ignore Alt-modified chords, composition events, repeated keydown events, and already-handled events. Do not add platform-specific Meta shortcuts in this scope.
- Ignore events originating from input, textarea, select, a contenteditable descendant, or a textbox. Keep native text Undo/Redo intact. Also ignore events inside the open Trim dialog and when a gesture is active.
- Disable history navigation during existing `editingLocked` states: upload-to-render, queued/processing, and completed result. Do not unlock the editor after a completed render just to allow Undo.
- Check the same rules in controller functions so direct calls cannot bypass disabled UI.
- Prevent browser default for an eligible editor history chord, even if its corresponding stack is empty; an empty stack is an editor no-op. Do not prevent default for excluded typing, modal, gesture, or locked cases.
- Do not require a selected clip to undo/redo: PIP, audio, FPS, and final-clip deletion all need selection-independent history navigation.

## Restoration, errors, and edge handling

Apply each history step atomically after validating and resolving its source references. If a required source is missing, an identity conflicts, a restored source trim is intrinsically invalid, or Video 1 capacity would exceed current limits after a later import, show a concise error and leave current state and both stacks unchanged. Do not partially restore or discard the blocking entry. A latest source probe error remains an error after Undo; do not counterfeit readiness from a historical snapshot.

Restoration may legitimately leave a PIP schedule outside the restored project duration, for example after reversing a FPS change or deleting the final Video 1 clip. Preserve the recorded schedule, show the existing validation guidance, and disable rendering through existing validation. Do not silently clamp or remove overlays. Missing current music or image assets are unaffected because their membership is not historical.

After a structural restoration, rebuild the timeline and increment structural revision once. The playback hook retains its normal pause/clamp behavior for changed geometry; playback frame and playing state never come from history. Pure audio-mix restoration must not force a seek or a structural revision. Do not move the playhead to a split's old cut point during Undo/Redo.

Retain the current selection if its identity still exists; otherwise reconcile it to none using current workspace behavior. Undo does not restore a former selection, chooser value, or deleted-clip focus target. Keep keyboard focus on the triggering history control when possible; reconciliation must not focus a removed DOM node. Preview current restored occurrences through valid runtime URLs.

History application never submits uploads, starts/cancels jobs, polls, changes a download link, resets job results, or invokes New Project. Keep render results and errors outside snapshots. While editing is available after a render failure, a local history step may change editable state but must not clear delivery/network errors or rewrite the failed job. A render uses the current committed metadata and existing ordered source files; no historical manifest cache is introduced.

## Test plan and acceptance criteria

Implementation must be test-first. Add failing tests for the behaviors below before production changes, then verify focused tests, the complete frontend suite, lint, format check, production build, and `git diff --check`. No new dependency or test configuration is required. Existing fixtures and Vitest/Testing Library are sufficient.

### History controller tests

- Empty stacks and no-op commits; exact before/after restoration; Redo ordering across multiple Undos; new edit clears Redo; rejected/no-op edits do not clear it.
- At 31 completed edits, exactly 30 remain reversible; moving entries between past and future never grows the budget. Evicted metadata and URL references can be released.
- Snapshot immutability and equality include trim, `trimSaved`, speed, IDs, PIP placement/settings, all mix fields, and requested FPS. Snapshots contain no binaries/URLs/runtime state.
- Split Undo/Redo restores exact inclusive ranges, source references, IDs, speed, and order. Version replacement restores the consumed donor at its original position and Redo reuses derived IDs.
- Source import rebasing preserves new clips across older Undo; imports clear Redo only as user actions. Metadata readiness does not record or clear history and cannot overwrite an explicit trim.
- Excluded occurrence-specific speed and PIP range updates survive unrelated Undo via rebasing; image and music source state remain untouched.
- Missing-source/capacity/identity failure leaves all state unchanged; New Project resets every stack/transaction and isolates old callback generations.

### Component interaction tests

- Visible Undo/Redo toolbar names and native disabled states, including Undo enabled after deleting the only clip.
- Ctrl+Z, Ctrl+Y, and Ctrl+Shift+Z invoke one action with matching buttons; typing tests cover each form-control kind and contenteditable descendants. Test composition, repeats, modal drafts, and locked editing.
- A trim drag with many moves previews the range but commits only once on release; cancel/lost capture rolls back with no history entry. Move-away-and-back is a no-op. A valid reorder drop commits once; drag-over and cancel commit nothing.
- Trim dialog Save creates one entry; Cancel creates none. Range keyboard/pointer/blur boundaries do not double-commit volume changes. Mute, PIP selects, and FPS selects each commit only a changed value.
- Selection-only, seek, playback ticks, and Version 2 chooser changes leave stacks unchanged.

### App and resource integration tests

- Undo/Redo Ripple Delete of a middle clip and each split half: Video 1 and Audio 1 stay contiguous, the remaining/restored order is exact, source files are reused, and no URL needed by the surviving half is revoked.
- Undo final-clip deletion restores normal preview/render eligibility; PIP and music asset membership survive empty Video 1 and history navigation.
- PIP add/remove/replacement/position/size round trips without rereading file bytes, duplicate placement entries, or restored revoked URLs. Probe failure/supersession and late callbacks after Undo/New Project cannot overwrite current placement.
- Undo/Redo FPS and mix settings appear correctly in the existing manifest. Auto resolves from the restored first occurrence; no change to source-frame or speed math.
- Submit render after Undo and after Redo and inspect the existing multipart files, IDs, ranges, saved-trim flags, ordering, audio, and overlay fields. Preserve one-clip/multi-clip rendering, failures/retry, completed preview/download, and New Project behavior.
- Job polling/results/downloads never enter history; locked shortcuts cannot alter them. Pure audio Undo does not reset playback; structural Undo uses normal clamp/pause without historical transport restoration.
- URL cleanup respects current/past/future/probe owners, Redo clearing, eviction, session reset, and unmount. Count original File identities to prove no video/audio binary duplication.

Existing trim, reorder, version replacement, Split, PIP, preview, audio, Ripple Delete, and delivery regression suites remain required.

## Explicit out of scope

- Backend, FFmpeg, API contracts, multipart formats, new packages, lock files, configuration, system settings, commits, pushes, deployment.
- Persistence, autosave, server-side history, project save/load, crash recovery, collaboration, branching history, a history browser, or arbitrary history jumping.
- Undo/Redo for source uploads/imports, source metadata probing, clip-speed controls, image/logo edits, PIP start/end schedule edits, or background-music asset add/replace/remove. Snapshot fidelity and baseline rebasing for these existing controls do not add Undo actions for them.
- Playback positions, playback toggles, selection-only changes, inspector state, Version 2 chooser state, transient dialog drafts, hover/drop highlights, focus history, delivery/network errors, render jobs/results, and downloads.
- Undoing New Project, adding another track, transitions, crossfades, changing split/trim/reorder calculations, or changing original-audio alignment and rendering behavior.
- Application or test changes as part of this design-only task, and an implementation plan before separate approval.
