# AVStudio Save/Open Project design

Date: 2026-10-20  
Status: Design specification only; implementation is not authorized by this document.

## 1. Purpose and boundary

Save Project downloads a portable `.avstudio.json` file containing the current edit decisions and source identity metadata. Open Project reads that file, asks the user to select the original local media, and replaces the current project only after validation and successful relinking. Media stays in the user's original files. The project file does not contain video, audio, images, thumbnails, waveforms, encoded media, or filesystem access permissions.

This is a frontend feature. Saving, parsing, fingerprinting, relinking, and committing an opened project make no network requests. Existing initial health checks and unrelated app requests are outside this operation. After opening, rendering continues through the existing materialization, timeline, manifest selection, upload, and rendering flow.

Success means that the same edit can be downloaded, opened in a fresh browser session with the same original media selected, and rendered with equivalent timing, picture, audio, and selected download formats. Opening is one undoable project replacement. New Project remains the sole operation that completely clears the project, source registry, and history.

### Existing application contracts

The design is grounded in these current frontend boundaries:

- `lib/editHistory.ts`: `EditSnapshot`, occurrence identity, one-entry commits, and a 30-entry history limit.
- `lib/projectSources.ts`: local `File` registry, source tokens, URL ownership, leases, and history reachability.
- `lib/historyProjection.ts`, `lib/timeline.ts`, `lib/advancedTimeline.ts`, `lib/positionedEdits.ts`, and `lib/audioTimeline.ts`: materialization, validation, frame timing, positioned edits, and detached audio recipes.
- `App.tsx`: image overlay state and selected export formats currently live outside `EditSnapshot`. Both belong in the portable document and the Open replacement boundary.
- `lib/advancedManifest.ts`: existing advanced/V3 request builders and their selection remain unchanged.

The downloadable format is a separate contract from backend render manifests and internal history serialization. Do not dump React state, the source registry, an upload request, or a history object into JSON.

### Design choice

Three approaches were considered: metadata-only heuristic matching; metadata plus whole-file fingerprints; and an archive containing media. Use metadata plus SHA-256 fingerprints. Heuristic matching alone cannot distinguish different files with identical names, sizes, and durations. Fingerprints add local read cost but permit safe identity checks and restoration of saved source timing without a new backend probe. Media archives violate the approved portability and size boundary.

## 2. Version 1 document contract

The following tables define the complete schema, including required fields, optional fields, unions, and validation. They are a normative schema description, not an implementation. Objects are closed: reject unknown properties at every level. Optional means omitted, never `null`, unless explicitly specified. Do not silently repair, drop, or coerce fields.

### Primitive definitions

| Name | Contract |
| --- | --- |
| ID | Case-sensitive opaque string, 1–128 characters matching `[A-Za-z0-9_-]+`; no special meaning or path interpretation. |
| Integer | Nonnegative JavaScript safe integer. Arithmetic on frame/sample counts and their sums must remain safe. |
| Positive integer | Integer greater than zero. |
| FPS | One of the numbers `24`, `25`, `30`, `50`, `60`. |
| FPS selection | One of the strings `auto`, `24`, `25`, `30`, `50`, `60`. |
| Speed | Exactly `1`, `0.75`, or `0.5`. |
| Original audio | Exactly `linked` or `detached`. |
| Position | `top-left`, `top-right`, `bottom-left`, `bottom-right`, or `centre`. |
| Size | `small`, `medium`, or `large`. |
| Trim | Object with required Integer `startFrame` and `endFrame`; both are inclusive source frames; `startFrame <= endFrame < totalFrames`. |
| Schedule | Required Integer `startFrame`, Integer `endFrame`, Position `position`, Size `size`; inclusive project-frame interval with `startFrame <= endFrame`. |

All numeric fields must be finite numbers, not numeric strings. Booleans must be JSON booleans. Negative, fractional, unsafe, or overflowing frame/sample integers are invalid. JSON `null`, strings, arrays, and numbers are not document objects.

### Root

| Property | Required value |
| --- | --- |
| `format` | Literal `avstudio-project`. |
| `schemaVersion` | Integer literal `1`. Independent of render manifest versions. |
| `sources` | Array of Source objects, with unique `id`. Contains exactly the sources referenced by `edit` or `imageOverlay`, including the media bin. |
| `edit` | Edit object described below. |
| `imageOverlay` | `null` or Image overlay object. |
| `exportSettings` | Object containing only required `formats`. |
| `timingFps` | FPS or `null`: current resolved project FPS, or the controller's last resolved FPS when Video 1 is empty. |

References in `imageOverlay` also contribute to `sources`. At least one source must be referenced somewhere in the document. An entirely empty document is rejected with “This project contains no media or edits. Use New Project to start over.” Save is disabled for an entirely empty project. A bin-only project, or a project with no Video 1 but retained positioned edits, is not an empty project. This avoids introducing Open Empty Project as another complete clear action.

`exportSettings.formats` is a nonempty array of unique values drawn from `mp4`, `mov`, `wav`, `mp3`, and must include `mp4`. Save writes this canonical order. Open accepts any order and normalizes to that order. These are the only current selectable export settings; do not invent codec, resolution, quality, or backend options.

`timingFps` must equal the existing FPS resolver's result when it resolves from Video 1 or an explicit selection. With `auto` and no Video 1, retain the last resolved FPS for positioned-edit validation and subsequent editing; this does not create a renderable Video 1 timeline. It may be `null` only when there are no timed occurrences or overlays requiring a project FPS. A bin-only project with an explicit FPS must store that FPS.

### Source

| Property | Contract |
| --- | --- |
| `id` | Required ID, document-local source identity. |
| `mediaType` | Required `video`, `audio`, or `image`. |
| `originalName` | Required nonempty original `File.name`, at most 1,024 UTF-16 code units; informational text only. |
| `sizeBytes` | Required positive safe integer equal to original `File.size`. |
| `mimeType` | Required string, at most 255 characters; original `File.type`, including empty string if unknown. Advisory. |
| `lastModifiedMs` | Required Integer or `null` if unavailable. Advisory; not identity. |
| `sha256` | Required 64-character lowercase hexadecimal SHA-256 of all original file bytes. |
| `metadata` | Required media-specific object below. |

Metadata shapes:

- Video: required finite positive `durationSeconds`; optional `clipMetadata` object; optional positive integer `width` and `height`, present together. `clipMetadata` has required finite positive `duration`, finite positive `fps`, positive integer `totalFrames`, positive integer `width`, positive integer `height`, and `origin` equal to `browser` or `backend`. It mirrors existing source timing, with the internal metadata `source` provenance mapped to `origin`. It is mandatory for sources used by Video 1, Video 2, or a `video-edit` audio recipe. A PIP-only or unused bin video may lack it. When clip metadata is present, outer width/height are also required; durations must agree under the duration rule in section 3 and dimensions must agree exactly.
- Audio: required finite positive `durationSeconds` and positive integer `sampleCount`. `sampleCount` is the existing normalized 48,000 Hz timeline sample count, not a native codec sample count. Preserve the current registry value; do not decode or resample differently for this feature.
- Image: required positive integer `width` and `height`; no duration, sample count, or clip metadata.

Only the listed metadata is persisted. Do not persist arbitrary probe output, local paths, directory handles, URLs, backend IDs, codecs, or unknown metadata bags. Original filenames are retained as metadata even if their text resembles a path; never use them for navigation, network access, HTML, or generated download paths.

Multiple occurrences of one registry source reference one Source object. Separate registry sources with identical bytes may remain separate source IDs; digest equality does not merge edit identities. One selected local file may satisfy all such records after each record's metadata is validated.

### Edit

All properties in this table are required. Empty arrays and explicit nullable fields are written consistently.

| Property | Shape and meaning |
| --- | --- |
| `binSourceIds` | Ordered array of unique video/audio source IDs, including unused imported bin assets, following the current bin's supported categories. |
| `video1` | Ordered array of Video 1 occurrences. Array order defines the contiguous Video 1 timeline. |
| `video2` | Array of Video 2 occurrences; preserve stored order and explicit placement. |
| `musicSourceId` | Audio source ID or `null`, following the existing music model. |
| `music` | Array of music occurrences. |
| `independentAudio` | Array of independent/detached audio segments. |
| `pip` | PIP occurrence or `null`. |
| `audio` | Object with required `originalVolume`, `originalMuted`, `musicVolume`, `musicMuted`. Volumes are finite numbers in `[0,1]`; mute values are booleans. |
| `fpsSelection` | FPS selection, preserving `auto` separately from its resolved value. |

Occurrence shapes:

- Video 1: required `id`, `sourceId`, `trim` (Trim, non-null), boolean `trimSaved`, Speed `speed`, Original audio `originalAudio`; optional `outputWindow` containing required Integer `outputInFrame` and Integer `outputOutFrame`. The window is a half-open interval in normalized output frames within the source edit. Require `outputInFrame < outputOutFrame` and the current normalized-source bound. Preserve both trim and output window; neither can be reconstructed from the other without potentially losing an overwrite/split boundary.
- Video 2: required `id`, `sourceId`, Trim `trim`, boolean `trimSaved`, Speed `speed`, Original audio `originalAudio`, Integer `timelineStartFrame`, Integer `contentInFrame`, Integer `contentOutFrame`, boolean `contentFullSource`. Content intervals are half-open normalized output frames; their difference is the placed duration. Apply existing source-range and lane-overlap rules.
- Music: required `id`, audio `sourceId`, Integer `timelineStartFrame`, Integer `sourceStartSample`, positive integer `durationFrames`. Sample offsets use the current 48,000 Hz normalized audio domain. Preserve current music constraints: a nonempty music array requires `musicSourceId`, every music occurrence references it, and an empty array requires `null`.
- Independent audio: required `id`, Integer `timelineStartFrame`, positive integer `durationFrames`, Integer `sourceStartSample`, and `source` recipe. Optional `detachedFrom` has required `track` (`video1` or `video2`) and ID `clipId`. This is provenance, not a live dependency: the originating occurrence may have been deleted. Preserve it without requiring that occurrence to exist.
- Audio recipe: an object with exactly the required properties `kind` (literal `audio-file`) and ID `sourceId` referencing audio; or an object with exactly the required properties `kind` (literal `video-edit`), ID `sourceId` referencing video, Integer `sourceStartFrame`, Integer `sourceEndFrame`, Speed `speed`, and FPS `normalizationFps`. The latter uses an inclusive source-frame interval with `sourceStartFrame <= sourceEndFrame < totalFrames`, and preserves the frozen recipe independently of later video edits. No media is extracted into the project file.
- PIP: required `id`, video `sourceId`, and all Schedule properties.
- Image overlay: required `id`, image `sourceId`, and all Schedule properties. This is the root `imageOverlay`, not an additional PIP or Video 2 occurrence.

IDs for every occurrence and the image overlay are unique across the document and distinct from source IDs. References must resolve to the correct media type. Split halves have separate occurrence IDs but may share a source. Source-only assets needed by detached audio must be retained even when their originating video occurrence is gone. Unreferenced historical sources are excluded.

Video 1 positions are derived using the existing trim/speed/FPS rounding and output-window rules; do not add a second stored `timelineStartFrame` for Video 1. Video 2, music, independent audio, and overlay positions retain their explicit current frame values. Preserve gaps and all current lane rules. Do not convert frames to seconds for serialization.

### Validation, bounds, and compatibility

Before reading text, reject project files larger than 5 MiB (5,242,880 bytes). Also bound documents to 1,000 sources, 10,000 total occurrences including image/PIP, and nesting depth 16. The root object is depth 1; each nested object or array adds one, while primitive values do not. These format safety bounds supplement existing frontend media and clip limits; exceeding either produces a clear compatibility error, never truncation. Save checks the same bounds before downloading. Size depends on decisions/source count, not media byte size.

Decode UTF-8 strictly; allow one leading UTF-8 BOM. Reject empty input, malformed JSON, duplicate object property names, forbidden prototype keys (`__proto__`, `prototype`, `constructor`) at every object level, unknown fields, missing fields, invalid unions, invalid metadata, duplicate identities, dangling references, and invalid arithmetic. Construct explicit validated plain data; never merge imported objects into application state.

Validation has two layers:

1. Document integrity: the schema and source-relative edit invariants, including existing restoration/positioned/audio rules, evaluated with saved source metadata and `timingFps`. Failure is an invalid project and cannot change the current project.
2. Existing render readiness: e.g. Video 1 is empty, or a retained Video 2/overlay range extends beyond the shortened Video 1 timeline. Such states can already be produced by editing and remain saveable/openable if layer 1 passes. Preserve them and show existing repair/render errors after opening; do not clamp or repair them. Existing readiness gates continue to block rendering. Metadata-loading/error sources and unfinished edit drafts are not saveable.

`format` must match exactly. Only integer `schemaVersion: 1` is supported. Missing/noninteger versions are invalid; other positive integer versions are unsupported, with the detected version in the error and advice to use a compatible AVStudio version. There is no migration, fallback to a render manifest, partial import, best-effort field dropping, or upgrade writeback in this release. Any future change to this closed contract requires a new version and explicit compatibility design.

## 3. Source identity and relinking

### Save identity

Save collects sources reachable from the current edit, bin, music selection, PIP, image overlay, and audio recipes. It does not collect undo/redo-only sources. Compute SHA-256 locally from every distinct source File, caching only against that immutable File instance in the current session. Read/hash one file at a time to avoid concurrent full-file allocations. A digest is identity metadata; no file bytes or encoded derivatives are serialized. No new dependency, configuration change, backend probe, or service is required by this design.

Source timing is the metadata already used by this edit, including existing browser/backend provenance. Saving does not re-probe or alter trims, FPS, samples, or schedules. For an image, obtain local intrinsic dimensions if they have not been cached. Read, decode, digest, or metadata failure aborts Save with a recoverable error; no incomplete file is downloaded.

### Relink rules

Every saved source, including an unused media-bin source, is required to complete this release's Open flow. List all of them. Do not silently omit unused bin entries, muted media, hidden Video 1 sources under Video 2, or detached audio sources.

Relinking only examines files explicitly selected in the relink dialog. Never search disks, reuse browser permissions, resolve saved paths, fetch URLs, or silently reuse the currently open project's files. Selection can be a multiple-file batch or a per-row file picker, without directory traversal.

The acceptance rules are deterministic:

1. Check supported local media file rules and existing size limits for every role the source serves. Exact byte size and media category must match. Empty or oversized media is rejected before hashing. MIME strings and extensions are hints, never proof of category; an empty/different MIME string alone is not a mismatch. A misleading extension cannot override a failed local decode/category check.
2. Match original name exactly and size first to prioritize likely candidates, then compare SHA-256. Also consider differently named candidates with matching size so renamed originals can be found; a same-name mismatch must not suppress that search. A different digest is always a mismatch, including when all other metadata matches. No “use anyway” override exists.
3. Verify local decode and available browser metadata for the expected category. Duration comparison allows an absolute difference of at most `max(0.050 seconds, 1 / saved clipMetadata.fps)` for video with clip metadata; otherwise 0.050 seconds for video/audio. Width/height, when saved and locally measurable, must match exactly. A file whose bytes match but whose observable metadata conflicts is blocked as a project/media metadata mismatch.
4. The byte-identical file allows restoration of saved FPS, totalFrames, and normalized sampleCount. Browser media elements cannot reliably re-probe exact source FPS/frame count, so do not estimate them differently or call a backend. Validate saved metadata and source ranges, then use that same saved timing. Inability to decode or obtain mandatory local duration/image dimensions is an explicit relink error. Inability to measure browser video FPS alone is not an error.
5. A unique candidate passing all rules, with the original name, becomes Matched. If its name differs but size/digest/metadata pass, show “Same media, different filename” with original and selected names and require the user to confirm that row. `lastModifiedMs` differences never block a match. Keep the original metadata in the document until a subsequent Save records the newly linked file's current name and timestamp.
6. When more than one distinct selected file qualifies for a source, mark Ambiguous and require a per-row choice, even if their bytes are identical. Selection order never chooses a winner. Identical source records may deliberately share the chosen file after validation. Multiple occurrences sharing a single source need only one relink.

Name mismatch with a different digest is Mismatched, never a renamed match. Fingerprinting prevents accidental replacement by a different same-name edit; it does not authenticate a project against deliberate modification. A user-authored JSON file is untrusted and can change edit decisions or metadata, so structural validation remains mandatory.

Local probes use owned temporary URLs and event listeners. Validate image decode/dimensions, video duration/category, or audio duration/category as appropriate; do not create thumbnails or extracted audio. All candidate failures are row-local until the user cancels or retries. Unselected/extraneous batch files are reported as “Not used by this project” and never imported into the bin.

## 4. Controls, states, and errors

### Save Project

Add visible text buttons “Save Project” and “Open Project” in the existing application header, next to project-level controls without moving or redesigning the workspace. On narrow viewports the controls wrap; neither may obscure transport, history, or status controls. No new global keyboard shortcut is introduced.

Save is available without backend connectivity, including while a render/result locks editing, provided all saved sources are ready and there is no pending import, replacement candidate, placement dialog, active gesture, trim draft, or Save/Open flow. Save is disabled for a completely empty project. An adjacent explanatory status identifies why Save is unavailable; it must not rely on a disabled-button tooltip.

On Save, capture one immutable project snapshot with its source File references, image overlay, export selections, and timing FPS. Hash/serialize that snapshot while editing may continue. Hold a source lease until completion/cancellation so later edits cannot invalidate the save. Announce “Preparing project file…” and show a Cancel action. A New Project or unmount cancels the save; late results must not trigger a download. A successful save adds no history entry, changes no project/selection/playback state, and does not clear redo.

Download UTF-8 JSON with MIME `application/json`, suggested name `AVStudio-project-YYYY-MM-DD-HHmmss.avstudio.json` using the user's local clock at capture time. Repeated saves are independent downloads; the browser controls collision suffixes and destination. Serialize only allowlisted fields, with deterministic source-ID ordering and canonical export-format ordering; preserve edit arrays. The UI says “Project file download requested. Keep your original media files to reopen it.” Do not claim the browser confirmed a disk write. Save failures show “Could not save project: [reason]. Try again.” and preserve the current edit.

### Open Project state machine

| State | UI and allowed transitions |
| --- | --- |
| Idle | Open opens a single-file chooser with `.avstudio.json` and JSON hints. Chooser cancellation changes nothing. |
| Reading/validating | Modal “Open Project”; text progress and Cancel. Old project remains installed. Parse and validate before any media registration or project mutation. |
| Relinking | Explain “Select the original media files. Your current project will be replaced only after all files are matched.” Show all source rows and “Choose media files”, per-row “Locate file”, Cancel, and disabled/enabled “Open Project” confirmation. |
| Probing/matching | Rows show Checking, Matched, Missing, Mismatched, Ambiguous, Renamed awaiting confirmation, or Could not read. Show `N of M sources matched`; only confirmed accepted rows count. Candidate replacement invalidates its previous result immediately. |
| Ready | All sources accepted and final candidate validation passes. “Open Project” confirmation is enabled. No automatic commit on the last match. |
| Committing | Disable repeated confirmation; perform the atomic replacement and close on success. No intermediate partially installed project is visible. |
| Failed | Clear alert identifying the error; keep old project. Pre-relink document errors offer “Choose another project” and Close. Relink failures remain in the dialog with Locate/Retry/Cancel. Commit/resource allocation failure returns to relinking with a recoverable alert. |
| Cancelled | Discard the staged document/candidates, release resources, and return focus to Open Project. No history entry or mutation. |

Open is disabled while the existing editing lock is active (uploading, queued, processing, or completed result), during any unfinished edit/import/placement/replacement gesture or draft, or during Save/Open. Its explanatory text tells users to finish/cancel the pending operation, or use the existing New Project action for the completed-result lock. Do not change existing locks or result behavior. A failed render that no longer locks editing does not prevent Open.

While the Open modal is present, its modal boundary suspends workspace editing, transport commands, history shortcuts, and render submission. Do not modify the stored project or pause/reset the existing transport merely to validate an invalid file. Any already-running preview may continue behind the modal; candidate probes must not join its playback/audio graph. Cancel and invalid input therefore leave playback state as it was. On successful replacement, stop the old playback/audio graph, invalidate its callbacks, install the new state paused at project frame 0, clear transient selection/drafts, and use existing preview readiness handling. Undo/redo across replacement likewise enters the restored project paused at frame 0; playhead/playing state is not saved or historical project content.

Each row shows original filename, media category, byte size, duration or image dimensions, roles/occurrence count, selected filename if any, and a text status with actionable reason. Missing and unmatched rows stay visible; no omission or silent skipping is allowed. Mismatches show which criterion failed. Names are rendered as text. Long names wrap or truncate visually while remaining fully accessible.

Document errors include: “Not an AVStudio project”, “Could not read project file”, “Project JSON is corrupt”, “Unsupported project version [N]”, “Project exceeds supported limits”, and “Invalid project: [field path and reason]”. A JSON render manifest, a mislabeled media file, and an unrelated JSON file are rejected. File extension and MIME are chooser hints only; a correctly structured document with a different filename is accepted. Error messages must never display raw input contents, stack traces, or filesystem paths.

Row errors include wrong size, wrong media category, fingerprint mismatch, duration/dimension mismatch, unsupported media, unreadable media, and ambiguous candidates. A failed row does not erase other accepted rows. Cancel, retry, or replacing a candidate is always available until commit.

Rendering is blocked for the entire staged Open flow, including Ready before confirmation, and for any unresolved source. After commit, all sources are ready; the ordinary existing render-readiness checks still apply. Known but currently unavailable selected export formats remain selected and show an actionable compatibility message; do not silently deselect them or change render capability behavior. Users may change them through the existing export controls.

## 5. Atomicity, history, and resources

### Replacement transaction

Reading, document validation, candidate matching, and final source-dependent validation occur in an isolated staging context. None calls New Project, clears history, rebases current history, installs image/export state, or marks current sources ready/error. Before commit, recheck current operation epoch, editing lock, limits, accepted matches, and candidate integrity. Hold the current project stable from dialog entry through confirmation.

On confirmation, allocate fresh runtime source IDs, occurrence IDs, and request/session tokens, and remap every reference, including bin IDs, musicSourceId, audio recipes, overlay IDs, and any `detachedFrom.clipId` that references a saved occurrence. Preserve dangling provenance as a newly namespaced historical ID. Never reuse imported IDs directly in a live registry that also contains the previous project's sources.

Prepare a complete replacement envelope: edit snapshot, image overlay identity/schedule, selected export formats, timing FPS fallback, and an internal project-incarnation identity. Register/adopt fully validated candidate Files and materialize the candidate before publishing anything. If any allocation, validation, or materialization fails, release all newly allocated resources and keep the installed envelope and history exactly unchanged. No temporary empty project may be published.

Commit one history action labeled “Open Project”. Append it within the existing 30-entry limit; preserve prior past entries, clear redo as a normal new edit does, and retain both envelopes. Do not reset the source registry or history. Undo once restores the previous edit, image overlay, export formats, and FPS fallback; redo once restores the opened envelope without asking for files again. Repeated opens remain separate undoable actions even when the file is the same: their runtime incarnations differ.

### History isolation

The current snapshot history omits image overlays and export selections. The replacement boundary must carry their before/after values as part of the same action, never as extra visible history entries or a second undo stack. Normal image/export edits retain their current inclusion/exclusion from ordinary undo; this feature does not make them independently undoable.

When leaving a project incarnation through Undo/Redo, capture its then-current externally managed image/export values in that side of the replacement boundary. Re-entering the incarnation restores those values, while crossing the boundary still restores the other project's values. Preserve current redo rules exactly: image edits invoke the existing excluded-user-edit behavior and invalidate redo; export-format selection currently changes external state without invalidating redo. Neither may rewrite another incarnation's saved settings.

Existing rebases (including speed/FPS adjustments and metadata initialization) must operate only on history snapshots belonging to the applicable project incarnation. They must not alter another project's side of an Open boundary or mix its sources. Undoing Open and then invoking an ordinary edit clears the Open redo entry normally. This narrow isolation is necessary for replacement correctness; normal history and playback behavior within an incarnation stays unchanged.

### Ownership and cleanup

- Staging owns its selected File references, probe URLs, listeners, abort flags, and any staged registry records. Replace/reject/cancel releases the previous candidate's resources. Temporary probe URLs are revoked after the probe settles, including error, timeout, and cancellation.
- A local metadata probe has a 15-second timeout per candidate after its media element/image is assigned the URL; timeout is retryable. Fingerprinting has progress/busy indication and cancellation, not a time-based identity failure. Cancellation invalidates results even if the underlying digest cannot be interrupted.
- Accepted candidates remain leased through commit. Ownership transfers to the installed source registry/history before staging releases its ownership. Never revoke a URL while another owner still uses it.
- Current state, past/future replacement envelopes (including their image overlays), ordinary history snapshots, active preview/audio consumers, pending operations, and render submissions are reachability roots. URL reconciliation must include them all. A URL is revoked only when it has no reachable owner/lease; ensure one live URL per runtime source when needed, and recreate safely from the retained File when necessary.
- Source File records required by undo/redo must remain available even if their URLs were released. When an entry is evicted, redo is abandoned, or staging is discarded, release its otherwise-unreachable source records/File references as well as URLs. Shared sources are retained until their last owner disappears.
- A JSON download URL has its own owner, separate from media sources. Remove its temporary anchor immediately after dispatch. Revoke the URL in a later task after the click dispatch, with unmount/cancellation cleanup as a fallback; do not revoke before dispatch or retain it indefinitely.
- Each Open attempt and candidate selection has an operation generation; every async completion checks that generation plus source request/session tokens. Cancel, replacement, New Project, and unmount invalidate callbacks before releasing resources. A late read/hash/probe event cannot change current state, accept a superseded candidate, commit, or download.
- New Project remains the existing complete clear boundary: stop consumers, cancel staging/save, invalidate epochs, clear history and all source owners/leases/records, revoke owned URLs, reset image/export/edit state. Unmount releases feature-owned resources and stops probes without changing the existing rendering lifecycle. Successful Open never invokes this clear path.

Do not serialize source tokens, runtime URLs, history entries, playback state, job state/results, progress, errors, selection, drag state, pending imports, or cached readiness state.

## 6. Accessibility

Use native labeled buttons and file inputs. Both new controls have visible names matching their accessible names. Busy controls expose `aria-busy`; disabled controls have an associated visible explanation. Progress and match counts use a polite live region and update on meaningful state changes, not on each byte or media event.

The Open dialog has an accessible name “Open Project”, descriptive instructions, modal semantics, contained keyboard focus, and inert background interactions. Initial focus goes to the dialog heading during validation and to Choose media files on entering relinking. Tab/Shift+Tab traverse controls in visual order. Escape and Cancel perform identical cleanup, except during the brief atomic commit where cancellation is disabled. Native chooser cancellation simply returns to the dialog without an alert.

Use a semantic list or table with named row controls such as “Locate file for interview.mp4, source 2”. Do not rely on color or icons to communicate status. Associate row errors with their controls; use an assertive alert for a new blocking error without repeatedly announcing the whole list. Renamed-file confirmation and ambiguous-file choice are fully keyboard operable. Confirmation of a row never moves focus to another row unexpectedly.

On successful Open, focus the existing workspace heading or focusable workspace container and announce “Project opened. [N] sources linked. Undo is available.” On Cancel/error close, return focus to Open Project. An unavailable format or existing render error is described in text after opening. The flow must work at 200% zoom and a 320 CSS-pixel viewport without lost controls; a long source list scrolls inside the dialog while actions remain reachable. Honor existing reduced-motion and focus-visible styles; add no animation requirement.

## 7. Required verification cases

These are exact behavioral test obligations for later implementation, using existing Vitest/Testing Library and Playwright facilities. This task creates no tests or implementation. Use deterministic local fixture files and clocks; no backend changes, new dependencies, or external downloads are required. Assert state and ownership outcomes, not just screenshots or implementation call order.

### Unit tests

| ID | Case and required assertions |
| --- | --- |
| U01 | Round-trip a document containing reordered/split Video 1, inclusive trims, all three speeds, output windows, positioned Video 2, PIP, image schedule, music splits, audio-file and frozen video-edit audio, mute/volumes, auto FPS, and all four exports. All decisions survive exactly; only canonical ordering may differ. |
| U02 | Repeat a source in multiple occurrences/roles and include an audio recipe whose originating clip was deleted. Serialize one source per registry identity, retain detached provenance, retain unused bin media, exclude undo-only sources, and resolve every live reference. |
| U03 | Put File objects, URLs, tokens, thumbnails, backend IDs, and arbitrary metadata on internal objects. Output includes only allowlisted fields, no media bytes/base64/data URLs, and no runtime state. Compare different-size media with equal-length names/metadata strings and equally many digits in sizeBytes: JSON byte length stays equal because fingerprints have fixed length and no media content is serialized. |
| U04 | Parameterize wrong format; missing version; string, zero, negative, fractional, future versions; unrelated JSON and V2/V3 render manifests. Distinguish invalid from unsupported; never materialize. |
| U05 | Parameterize empty input, BOM-valid JSON, invalid UTF-8, truncated JSON, trailing garbage, duplicate keys, forbidden prototype keys at each nested level, unknown fields, missing required fields, wrong union types. Only BOM-valid canonical data succeeds. |
| U06 | Parameterize every enum boundary, fractional/negative/unsafe frame and sample values, overflowing sums, zero duration/dimensions/sample count, invalid FPS/speeds, bad SHA length/case, volume outside `[0,1]`, duplicate source/occurrence IDs, and dangling/wrong-category references. Each fails with a field path. |
| U07 | Test 5 MiB versus 5 MiB + 1 byte; 1,000/1,001 sources; 10,000/10,001 occurrences; nesting 16/17; and current app media/clip limits. Boundary-valid fixtures pass format bounds; over-bound fixtures fail without partial data. |
| U08 | Validate one-frame inclusive trims; normalized output windows at zero/full end and one frame beyond; Video 2 content bounds; audio offsets at EOF; legal adjacent lane segments versus one-frame overlap. Follow existing frame/sample rounding and EOF tolerance exactly. |
| U09 | Auto FPS with source metadata, explicit FPS, bin-only auto/null, and empty Video 1 with timed retained edits/last FPS. Reject inconsistent timingFps; preserve the fallback without creating a base timeline. |
| U10 | Completely empty project is rejected/unsaveable; bin-only is accepted; structurally valid out-of-base overlay/Video 2 remains accepted with existing render errors; malformed source-relative ranges are rejected. |
| U11 | Exact name/size/type/digest/metadata matches; same name/size/duration but different digest fails; different size fails before hash; renamed identical file requires confirmation; changed timestamp and empty MIME do not fail. |
| U12 | Duration differences of exactly 0.050 seconds and 0.051 seconds for 24 FPS and PIP/audio without clip metadata; also test saved 15 FPS with differences of `1/15` second and `1/15 + 0.001` second. Test exact versus changed dimensions, wrong category, and failed decode despite correct-looking extension. Assert acceptance/rejection and specific criterion using comparisons that avoid binary floating-point fixture drift. |
| U13 | Two matching candidates produce Ambiguous independent of selection order; per-row choice resolves it. One file can satisfy identical separate source records; one source shared by many occurrences needs one match; extraneous files stay outside the bin. |
| U14 | Corrupt saved timing, inconsistent outer/clip metadata, unavailable mandatory local metadata, valid saved FPS not locally measurable, and digest read failure. Reject corrupt/unverifiable input; preserve valid saved timing without a new probe service. |
| U15 | Fingerprint cache applies only to the same immutable File; different File instances with the same name/size/timestamp still get verified. Save snapshot stays stable while the installed edit changes. |
| U16 | ID remapping preserves every reference, including detached provenance, without collisions across two opens of the same document. Unknown/dangling live IDs never become runtime references. |

### Integration tests

| ID | Case and required assertions |
| --- | --- |
| I01 | Save from an edited project requests exactly one correctly named JSON download, writes the captured decisions, announces download requested, releases the download URL/lease, and leaves history, redo, playback, selection, image, and formats unchanged. Repeat during an existing render lock and with backend unavailable. |
| I02 | For every unfinished operation listed in section 4 and the empty project, controls have the specified disabled state and visible reason. Open respects active/completed locks; Save is allowed on a settled completed result. |
| I03 | Open valid JSON over project A. Until confirmation, assert A's edit, external image, formats, history, source statuses, and playback are unchanged. All required rows appear, including unused bin/detached-only media; render and workspace shortcuts cannot bypass the modal. |
| I04 | Parameterize document errors from U04–U07 and read failures. Assert clear alert, zero history entries added, identical current state/URLs, and zero media registration. Closing returns focus. |
| I05 | Supply partial matches, a same-name wrong file, a renamed match, an ambiguous pair, an unreadable file, and extra files. Assert row-specific statuses; Open stays disabled until every required row is accepted, renamed rows confirmed, and ambiguous rows chosen. Retry one row without losing other matches. |
| I06 | Commit project B over A with different image, FPS fallback, and formats. Exactly one “Open Project” action appears; Undo restores all of A; Redo restores all of B without another file picker. Both transitions are paused at frame 0. Earlier A edits remain undoable. |
| I07 | Open B, make an ordinary edit, undo that edit and Open; redo both. Then undo Open and make an edit to A. B's redo is discarded and otherwise-unreachable B sources released; A remains intact. Repeat with an image edit and verify redo is cleared. Separately change only A's export formats after Undo Open: redo remains available, Redo Open restores B's formats, and Undo Open restores A's newly chosen formats. |
| I08 | Change speed/FPS and initialize source metadata within B after Open. Undo across the boundary. A's old snapshots/timing/sources must be unchanged. Change B's external image/export values, cross and recross the boundary, and verify each incarnation restores its own values without making normal image/export actions independently undoable. |
| I09 | Force failure during final validation, URL allocation, registry adoption, or materialization. A and both history stacks remain identical; all new resources are released; retry can succeed once. Double confirmation creates only one entry. |
| I10 | Cancel at reading, hashing, probing, renamed confirmation, and Ready. Fire late completions after Cancel, candidate replacement, a second Open attempt, New Project, and unmount. No mutation, download, commit, or leaked lease/listener/URL is allowed. |
| I11 | Expire the 15-second probe timeout; report retryable row error and revoke its URL. Complete a digest after cancellation; discard its result. Retry with a new generation succeeds. |
| I12 | Track each created/revoked URL and retained File owner through successful Open, cancel, candidate replacement, undo/redo, abandoned redo, 31st history entry, shared-source leases, New Project, and unmount. No URL is revoked while owned; each released URL is revoked once and unreachable File records are removed. Both sides' image sources participate. |
| I13 | Before Save and after Open/relink, run existing materialization/timeline and both applicable manifest builders on equivalent fixtures. Compare complete decisions, output FPS, intervals, audio recipes/samples, image/PIP schedules, exports, upload File bytes, and manifest routing, normalizing only remapped IDs. No JSON project payload enters the render API. |
| I14 | Open a structurally valid render-blocked draft and a project selecting an unavailable export format. Preserve decisions/settings, show the existing readiness/compatibility reasons, make no submit request, and enable rendering only after normal repair/settings changes. |
| I15 | Mock all network boundaries: Save and Open/relink issue no requests. Only explicit subsequent Render invokes the existing request flow, with original relinked Files and normal leases. |
| I16 | Verify accessible dialog name, focus containment/restoration, row labels/descriptions, polite progress, assertive error, Escape/Cancel equivalence, keyboard confirmation/ambiguity selection, and suppressed workspace history shortcuts. |

### Browser tests

Use existing Chromium Playwright coverage with real supported local media fixtures. Intercept the normal render API for deterministic payload assertions; retain existing rendering regression coverage. Browser metadata and download behavior must be exercised for real, rather than mocked in every test.

| ID | Scenario and observable result |
| --- | --- |
| B01 | Build a representative project containing all supported tracks, a Video 1 split/output-window edit, speeds, mute/volume settings, image/PIP, detached audio, music segments, auto FPS, and multiple export selections. Download and inspect `.avstudio.json`: valid contract, no binary/URLs, correct selections/decisions. Open in a fresh page/context, select originals, confirm, and compare the normalized timeline/manifest and uploaded file bytes with the pre-save capture. |
| B02 | Open B over edited A in the same page. Verify A remains visible/installed during relink; all tracks/settings change once on confirmation; one Undo restores A and one Redo restores B without media selection. Existing toolbar and keyboard history controls agree. |
| B03 | Leave one image, music, or detached-only source missing (parameterized). List it clearly and block confirmation/render. Choose a different same-name/size/duration fixture and verify fingerprint rejection. Then choose the original and complete opening. |
| B04 | Relink a renamed byte-identical fixture and two duplicate candidates. Explicitly confirm the rename and choose the ambiguous row. Verify all required media is matched and extra files were not added to the bin. |
| B05 | Parameterize corrupt JSON, unsupported version, render manifest, oversized project, and invalid references. Current A's playback/edit/settings/history remain unchanged; a clear error appears; choosing a valid project afterwards succeeds. |
| B06 | Cancel the native project chooser, cancel relink, Escape from relink, reopen the same JSON, and replace a selected wrong candidate. No history action or stale candidate appears until one successful confirmation. Assert URL cleanup using browser instrumentation where native counts are not observable. |
| B07 | Operate Save, Open, row pickers, rename confirmation, ambiguity choice, Cancel, and commit entirely with keyboard. At 320 CSS pixels and 200% zoom, all actions/errors are reachable, focus remains visible/contained, and the workspace receives no modal shortcuts. |
| B08 | Block feature-attributable network requests and make backend health unavailable. Save and Open/relink still succeed locally. Restore normal health and request Render; verify the unchanged manifest/upload route and existing readiness checks, including unavailable selected formats. |
| B09 | After Open, exercise existing play/pause/resume, split boundaries, linked/detached audio ownership, and export flows with the existing regression cases. No new seeks, duplicated audio, changed split rounding, or altered export selection behavior is introduced. |
| B10 | New Project after Open clears all history/media/settings through the existing clear action; Undo cannot restore it. Reload without manually opening a downloaded project starts with existing app startup behavior, proving no automatic draft persistence was added. |

## 8. Explicit exclusions

- No backend endpoints, schema changes, database, accounts, authentication, cloud storage/sync, deployment, packages, lockfile, build, or configuration changes.
- No browser autosave/drafts, localStorage/IndexedDB persistence, recent-project list, recovery journal, or remembered media permissions.
- No embedded/copied media, ZIP bundles, proxies, extracted audio files, thumbnail/waveform persistence, path-based lookup, remote media fetching, or automatic directory scans.
- No project merge/import-into-current, source replacement with different content, ignore-missing option, partially renderable project mode, migration, or support for backend render-manifest files.
- No saved undo stack, playback position, selection, jobs/results, drag/trim drafts, unfinished imports, or UI panel layout.
- No new codecs/settings, render pipeline, playback logic, split/audio semantics, general history redesign, or workspace redesign. The narrow history envelope/ownership changes serve Open replacement only.
- No implementation code, implementation plan, dependency installation, commit, push, publication, or deployment as part of this specification task.

## 9. Acceptance criteria

1. A settled, nonempty current project can be saved as a small, metadata/decision-only versioned JSON download without backend access or edit mutation.
2. The document preserves all listed current edit decisions, complete source dependencies, FPS selection/fallback, image overlay, and current export formats. Repeated references do not duplicate media metadata unnecessarily; no binary representation is included.
3. A fresh browser session requires explicit local media selection. All saved sources are listed; name/size/type/metadata/fingerprint checks, rename confirmation, and ambiguity resolution follow section 3 without silent replacement.
4. Until every required source is correctly linked and the user confirms, the installed project and history are unchanged and rendering is blocked. Cancel or any document failure preserves the installed project.
5. A successful Open is one atomic undoable replacement that includes image/export state, preserves earlier history, supports redo without relinking, and isolates sources/settings across project incarnations. New Project remains the only complete clear.
6. Resource ownership covers staging, downloads, installed sources, both sides of history, preview/audio, and rendering. Cancellation, errors, stale callbacks, eviction, and unmount cannot leak resources or revoke media still in use.
7. Once opened, current timeline/manifest builders and existing render submission consume the original relinked Files unchanged. Existing render errors and capability gates remain effective.
8. The controls and relink flow satisfy the accessibility requirements and every unit/integration/browser case above. Existing playback, split, audio, history, and export regressions continue to pass during eventual implementation.

## 10. Specification self-review

Reviewed for ambiguity, contradictions, placeholders, and accidental backend scope. Decisions are explicit for digest requirements, metadata tolerance, renamed/duplicate files, unused bin media, render-blocked drafts, empty projects, saved FPS fallback, unsupported formats, atomic commit failures, external image/export history, cross-project rebases, and source lifetime. No unresolved design placeholders remain. Backend metadata provenance describes existing saved timing only; this design adds no backend probe or API. This document is the sole requested artifact and does not authorize implementation.
