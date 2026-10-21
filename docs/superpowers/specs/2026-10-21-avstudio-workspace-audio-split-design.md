# AVStudio premium workspace and Split Audio

Date: 2026-10-21 (Asia/Calcutta). Status: proposed design for review; no implementation authorized by this document.

## Brief and inspected baseline

Deliver a compact, professional post-production workspace and independent, frame-exact audio splits without changing picture, audio ownership, playback stability, ripple insertion, Save/Open, or MP4/MOV/WAV/MP3 delivery. Work stays on `backup/avstudio-oct16`, inspected clean at `fdefe56`. This task changes only this specification; no implementation, packages, configuration, backend, commits, pushes, or deployment.

The selected reference is the dashboard image attached to the user's visual-spec revision request: mountain/lake Program Monitor, thumbnail Media panel on the left, Properties panel on the right and a dense timeline below. It has been visually inspected and is the visual acceptance reference. Adapt its composition and interaction treatment while retaining the existing AVStudio logo/wordmark, real functionality and the explicit left-side Timeline Tools requirement. The inspected `docs/screenshots/professional-workspace-ui/after-desktop-populated.png` remains historical workspace evidence, not the selected reference or proof of current runtime behavior. Reference inspection does not establish alignment of an implementation that has not been built.

Relevant code findings:

| Boundary | Existing behavior and implication |
| --- | --- |
| `components/EditingWorkspace.tsx`, `ProjectTimeline.tsx` | One generic Split button already dispatches picture, independent audio, and music splits. Disabled help still describes Video 1; independent split does not return a right-piece selection ID. Add a dedicated audio action and shared eligibility contract. |
| `lib/audioTimeline.ts` | `IndependentAudioSegment` already stores timeline frames, 48 kHz source offsets, frozen video recipes, and detach provenance. Pure split/move/trim/replace/lift/ripple-delete operations exist. Extend these, rather than introduce another timeline. |
| `lib/positionedEdits.ts`, `advancedTimeline.ts` | Music already has per-occurrence IDs, positions, durations, source IDs and sample offsets; splitting preserves offsets. Validation nevertheless requires every segment to use `musicSourceId`. |
| `hooks/useEditHistory.ts` | Existing transactions and source leases support audio edits. Current music import/replacement resets the entire lane to one segment. |
| `lib/projectFile*.ts`, `projectSources.ts`, `projectContext.ts` | Project schema version 1 enforces one music source; source capture, relinking and history retention must follow every piece's references. |
| `hooks/useProjectAudio.ts`, `ProgramMonitor.tsx` | Preview resolves original ownership plus a separate additive music bus from the live transport clock. Preserve voice pools, generation/readiness guards, media instances and source leases. |
| `lib/advancedManifest.ts`, backend `manifests.py`, `audio_composition.py` | V3 supports independent recipes and split music windows, but all music windows must reference one uploaded source. Arbitrary per-piece music replacement is not a UI-only change. |

All frontend paths in this document are relative to `frontend/src/`. Historical specifications inform context; their broader execution permissions do not carry into this task. Tests were inspected, not executed; no current passing-suite claim is made.

## Architecture decision and trade-offs

**Extend the existing occurrence model; choose the export path by proven fidelity.** Keep existing independent-audio recipes and frame/sample math. Allow each music occurrence to reference its own file in editor state. A frontend music export adapter is only a candidate: compiling audible windows into one temporary WAV could fit the existing V3 contract, but browser decoding, timing, channel conversion and resource limits must not reduce required editing or rendering support.

**Export-fidelity rule:** a frontend adapter may be used only when the existing backend contract can faithfully render every required split, moved, trimmed, deleted and replaced audio segment in **MP4, MOV, WAV and MP3** outputs. Preserve source identity/content, source offsets, timeline placement, duration, silence, ownership, gain and picture. Preview support alone is insufficient. Do not silently omit edits, change their meaning, replace a whole lane, or restrict final rendering to what the browser can decode. Lossy encoding may change samples, but must not change edit semantics or introduce timing errors beyond declared codec tolerances.

Alternatives:

- Retain one music source and only replace a piece's source window: smallest change, but does not satisfy replacing one piece with a different file. Do not label that as completed replacement support.
- Extend the backend music catalog/render graph minimally: use this design path when a required edit cannot be represented faithfully through the existing contract. The necessary change is documented below; backend implementation remains outside this specification-only task.

The existing single-source music contract cannot directly represent two music pieces referencing different files: `manifests.py` rejects differing segment source IDs and `render_audio_master` opens only `plan.music.source_id`. Therefore different-file replacement requires either a proven faithful adapter or the minimal backend extension below. If fidelity is unproven or fails for required supported media/edits, select and document the backend path before planning; do not shrink the milestone to preserve a frontend-only implementation. Neither path is implemented by this document.

## Data model and editing contracts

Keep `EditSnapshot.independentAudio` and `music` as the only editable audio collections. Linked original audio remains a derived ownership view, not an editable segment: show **Detach Audio** first. Detaching freezes the existing recipe and marks its picture occurrence detached; Split Audio never implicitly detaches or splits picture.

- Independent piece: existing `{id, timelineStartFrame, durationFrames, sourceStartSample, source: AudioRecipe, detachedFrom?}`. Preserve recipe trim, speed, normalization FPS and provenance on both halves. Provenance is informational, never a live link that deletes or trims picture.
- Music piece: existing `{id, sourceId, timelineStartFrame, durationFrames, sourceStartSample}`. Make `sourceId` authoritative per piece; remove the runtime single-source invariant and enumerate all music references in validation, resource retention, history and export preparation.
- Timeline coordinates are safe integer project frames and half-open intervals `[start, start + duration)`. Source offsets are safe integer samples in the existing normalized 48 kHz domain. Supported FPS remains 24/25/30/50/60, so samples per frame `K = 48000 / fps` is integral.
- One shared pure audio-split planner returns either a structured issue or `{nextSnapshot, leftId, rightId}`; both UI eligibility and commit-time validation use the same rules. Dispatch to the existing lane-specific edit helpers. Allocate fresh unique IDs only after eligibility succeeds, validate the candidate, and commit once.

For original segment `(S, D, O)` and split frame `F`, require `S < F < S + D`. Set `L = F - S`. Left is `(S, L, O)`; right is `(F, D - L, O + L*K)`. Source identity/recipe is unchanged. Example at 30 FPS: `(100, 60, 4800)` split at 125 becomes `(100, 25, 4800)` and `(125, 35, 44800)`. No source-time rounding, overlap, missing frame or duplicated sample interval.

After success select/focus the right piece, retain the playhead at `F`, retain transport intent through existing anchor mapping, and record one `Split Audio` history entry. Undo restores the original occurrence; redo restores the same two IDs and offsets. Follow existing selection reconciliation for Undo/Redo without adding selection to serialized project data.

Each half supports:

- Move: change only its timeline start, preserving source offset; reject same-lane overlap or negative placement.
- Trim: start trim advances timeline start and source offset together; end trim changes duration. Minimum one project frame; validate source EOF using existing final-partial-frame allowance.
- Ripple Delete: remove the selected piece and shift only later pieces in that same lane left by its duration. Preserve earlier gaps; do not move picture, the other audio lane, or overlays. Lift remains an explicit gap-preserving action.
- Replace: affect only that occurrence, preserving ID, timeline start and duration. Begin the chosen replacement file at sample zero, validate that it covers the duration under existing EOF rules, and clear detached provenance when applicable. Too-short/unready media rejects atomically. Existing whole-song replacement remains a separate, clearly labelled action.

No audio operation mutates Video 1 or Video 2 occurrences, windows, order, speed, or original-audio flags. Deleting detached audio leaves its former picture detached; it does not reveal that picture's original sound again.

## Workspace and contextual controls

Use the current logo/wordmark, installed icons and fonts. Follow the reference's near-black navy canvas, slightly lighter panels, fine blue-grey separators and restrained electric cyan/blue active states. Target 4–6 px panel corners, a 4 px spacing rhythm, 12–14 px working text and compact headings. Confine any subtle cyan emphasis to selection/focus; no broad decorative glow, gradients, oversized cards, fake waveform/thumbnail data, metrics or marketing copy.

At spacious desktop widths, follow the reference's approximately 27% Media Bin / 46% Program Monitor / 27% Inspector split of the upper three-panel area, with narrow gutters and one compact application bar containing current Save/Open and delivery actions. These are visual targets, not rigid minima: reduce side panels toward 240 px/300 px at smaller desktop widths to protect the monitor and real controls. Timeline spans the full width below and gets roughly one third to two fifths of usable workspace height where existing lane geometry permits. The monitor is the dominant image surface; timeline is the dominant editing surface. Preserve existing lane order, time-to-pixel mapping, trim hit targets and horizontal scroll alignment.

Use one persistent left tool rail outside track content at every width. Compact icon-and-label controls: Undo, Redo, Split Video, **Split Audio**, Detach Audio, Ripple Delete. Retain existing picture split behavior behind its explicit label. Rail controls have hover/focus tooltips, complete accessible names and existing 44 px minimum tool targets. On narrow screens keep the rail left of the horizontal track scroller; stack upper panels using the same mounted components. No page-level horizontal overflow, duplicate monitors, or tool wrapping into tracks.

**Split Audio is always visible.** Enable only for one selected, editable independent/detached audio or music segment, with an interior integer playhead, ready sources, available capacity, valid timeline, and no edit lock/active gesture/modal conflict. Never route this action to a selected picture clip. Show an associated visible unavailable reason, including boundary, missing selection, linked-only audio, busy state or capacity. Disabled native buttons also need an adjacent keyboard-reachable description; essential reasons cannot depend on hover.

Selecting audio exposes filename/type, timeline start/duration, source offset, Move/Trim/Replace, Lift/Ripple Delete, and the existing lane-level Mute/Volume controls in Inspector. State explicitly that volume affects the Original/Replacement or Music bus, not only the selected piece. Linked audio offers visible Detach Audio. Retain Resume Audio at the monitor when required. No workflow depends on Ctrl+L; retain the existing optional Ctrl+Alt+L only where already supported.

**Layout stability:** keep monitor, canvas, transport, picture status, audio status/recovery and timeline tool-help slots mounted with reserved dimensions. Cover ready/preparing/playing/paused/resume-required/decode-failure states and wrapping error text. Within each fixed responsive layout, status text scrolls inside its reserved region if necessary; buttons and full errors remain reachable. Do not overlay errors on editing controls. Status changes must not resize the upper grid, canvas or downstream timeline. Reflow caused by deliberate viewport changes is separate. Keep media keys/refs unchanged.

### Visual acceptance against the selected reference

The reference supplies layout, density, hierarchy and interaction styling, not a new feature inventory or replacement brand. Assess the following in side-by-side captures using actual project media; do not copy its sample mountain image, filenames, waveform artwork, avatar or logo into the app.

| Aspect | Acceptance criteria |
| --- | --- |
| Composition and hierarchy | A shallow application bar, three aligned upper panels and an uninterrupted lower timeline read as one editing workspace. Program has the largest single visual surface, with the picture filling most of its panel and compact transport immediately beneath. Media and Inspector remain clearly secondary. Use the upper-panel proportions above at spacious desktop sizes, rather than a narrow bin beside a disproportionately wide empty monitor. No hero section, floating dashboard cards or marketing headings. |
| Density and spacing | Match the reference's compact working density: approximately 52–60 px application bar, 36–44 px panel headers, 8–12 px outer gutters/panel padding and closely aligned fields. Keep panel titles around 13–15 px; reserve larger type for the existing brand and legible time readout. Preserve 44 px timeline-tool hit targets and existing trim handles; compact visuals must not shrink required interaction geometry. Avoid excess empty padding, repeated helper paragraphs or oversized upload cards; keep essential limits, reasons and recovery copy visible. |
| Colour and emphasis | Use approximate visual targets, not sampled claims: canvas `#050c14`, panel `#09131e`, field `#0c1926`, separator `#203446`, primary text `#e7edf6`, secondary text `#a7b7ce`, cyan `#00bfff` and active blue `#087fff`. Validate contrast in context. Cyan/blue marks current time, playhead, selection and primary actions; most surfaces remain neutral. Video uses muted blue, audio muted teal/green; retain existing lane identity accents where needed. The reference's bright sunset belongs to media content, not interface decoration. |
| Panel treatment | Shallow 4–6 px corners, thin continuous borders, subdued header separators, flat dark inset fields and minimal shadow. Align upper panel edges and their reserved status/transport regions. Use short disclosure rows and label/value grids in Inspector, taking the reference's Properties panel as styling direction while retaining existing disclosure behavior and controls. Do not add unsupported Properties/Video/Audio/Color tabs or transform effects. |
| Media presentation | Use a concise Media Bin heading, compact existing import/reuse actions, readable filename/type/duration/status and real available thumbnails. Adopt the reference's tidy asset grouping and restrained selected-item outline. Preserve the current source list and per-source actions; a thumbnail grid, search/filter system and view-mode switch are not required. Audio can use its real type icon and metadata; waveform art must not imply waveform support. |
| Monitor and transport | Dark framed picture, compact Program/sequence heading, cyan current time and muted duration/frame information, aligned native controls and a narrow progress treatment where supported by the existing seek UI. Preserve aspect ratio/letterboxing and overlay geometry. Only existing transport/seek actions appear; reference Fit/Full menus, capture, fullscreen and extra playback buttons do not create new functionality. Status and Resume Audio remain readable in their reserved slots. |
| Timeline and tools | Follow the reference's fine ruler, thin cyan playhead/handle, clear fixed track labels, compact clip captions, distinct blue picture and teal audio blocks, and precise selection border. Do not exaggerate glow or widen short clips to fit labels. Preserve real lane order, occurrences, gaps and ownership indicators. Unlike the reference's floating horizontal toolbar, required Timeline Tools stay in a persistent left rail outside tracks at every width; carry over its compact labelled/icon treatment and active-state clarity. No toolbar may obscure the ruler or cross a track. |
| Interaction style | Restrained hover fill/border, immediate visible pressed/selected states, separate keyboard focus ring, hover/focus tooltips and legible disabled states with contextual reasons. Inspector follows actual selection. Visible Split Audio, Detach Audio and lane audio controls remain discoverable. Keep existing click, drag, trim, keyboard and non-drag alternatives; no new tool modes, hover-only essential controls, decorative toggles or animation. |

Reference features outside current functionality are not visual acceptance requirements: the outer navigation icon strip, menu bar commands, global/media search, Record, avatar/notifications, effects library, audio meters, solo/lock controls, bottom zoom controls and extra Inspector effects. Retain existing real equivalents where present, but add no inert controls or invented data to imitate them. Current Save/Open, render formats, results, validation and error recovery must remain accessible even though the reference does not show their full flows.

For future visual acceptance, capture the populated editor at the supplied image's 1536x1024 composition plus 1440x900 and 1920x1080. Compare region proportions, monitor prominence, visible working density, panel borders/spacing, typography, colour hierarchy and selected/hover/focus/disabled states. Record deliberate differences: AVStudio's original branding, left tool rail, actual lane set and supported controls. These differences are required adaptations; assess all other departures explicitly rather than declaring a screenshot match.

Also capture empty/importing states; picture, independent-audio and music selection; valid/interior and invalid/boundary Split Audio; each preview/audio status; render lock/error/results; long filenames and wrapping validation. Reuse identical real media, frame, selection and viewport for before/after comparisons. Check the existing narrow/short/200%-zoom matrix for reachable controls and zero page overflow, and measure monitor/canvas/timeline geometry through status transitions. Static reference alignment and playback/export parity are separate acceptance gates; both must pass. No implementation screenshots or visual pass are claimed by this specification revision.

## Preview, export and persistence

Continue using `resolveAudioOwnership`: independent audio wins over linked audio; otherwise the exposed picture owns original audio; detached picture does not supply linked audio. Music is additive on its own bus. Muting an owner never reveals another owner. Audio outside the Video 1 duration remains saved/editable but does not extend the export.

Preview uses original per-piece sources and existing `useProjectAudio` live-clock mapping, including speed-adjusted frozen video recipes. At an untouched split boundary the source mapping remains continuous; changing occurrence ID alone must not restart/reload the decoder, seek, duplicate sound or pause picture. Movement/replacement/trim uses existing generation and readiness handling. Preserve truthful approximate-preview notices and real decode/resume errors.

Independent splits and single-source music retain existing render paths. Subject to the export-fidelity rule, the candidate frontend preparation adapter for multi-source music would run before V3 request construction:

1. Capture the committed snapshot and source leases under the existing render lock. Decode music files with browser APIs to 48 kHz stereo PCM; use fixed channel conversion, no gain or normalization. Validate decoded lengths against the project's normalized source metadata; permit only the existing sub-frame EOF padding allowance.
2. Copy each window intersecting the export duration into a packed PCM WAV in chronological order. Pack only active windows, excluding timeline gaps. Repoint outgoing music segments to a collision-free generated source ID and cumulative packed sample offsets; retain timeline placements and IDs. Original editor offsets/files remain unchanged. Backend still places silence and applies Music mute/volume once.
3. Add that WAV to V3 `audio_sources`/uploads, retaining original files only if another rendered recipe needs them. Force V3 for multi-source music even when MP4 is the only chosen format. Manifest construction must bypass the legacy single-source builder for this case; no temporary mutation of editor state.
4. Preflight generated WAV byte size, catalog count, segment count and manifest size against existing limits before allocation/upload. Use PCM16 stereo WAV (44-byte header plus four bytes per sample frame); bound decoding/copy memory, process windows sequentially, and release buffers/leases on completion, failure or project disposal. Preparation is visible and uses existing locked/busy behavior; no new backend job state.
5. Browser decode failure, unsupported encoding, length mismatch or allocation/limit failure aborts preparation with a clear reason, preserving the project and history. No silent omission, cross-bus routing or whole-lane replacement. Existing single-source exports must not acquire this browser-decoding requirement. If this prevents a required edit/export supported by the backend media pipeline, the adapter fails the architecture gate; an error message alone does not satisfy the milestone.

This bridge adds browser decoding and may quantize that path to PCM16. Demonstrate parity with the backend's normalized audio domain, including compressed-source delay, channels and EOF, rather than accepting listening impressions alone. Do not claim sample identity with backend-decoded lossy files without evidence. Resource constraints may not silently reduce existing supported edit/export capacity. These are feasibility gates, not accepted exceptions to export fidelity.

### Minimal backend contract/render change if required

Use a new render manifest schema version 4, retaining the existing V3 picture, independent-audio, upload catalog, mix and export fields. Change only music representation to `music: null | {segments: [{client_id, source_id, timeline_start_frame, source_start_sample, duration_frames}]}`. Each segment references the existing uploaded `audio_sources` catalog; no shared top-level music source ID is required. Keep V1–V3 requests readable with their current validation and behavior; normalize legacy music to the per-segment internal form. Portable project version 2 and render manifest version 4 are separate schemas.

Necessary backend responsibilities, limited to multi-source music:

- `manifests.py` / `jobs.py`: parse V4 and validate each segment's audio catalog reference, identity, integer range, non-overlap and existing capacity limits. Preserve strict legacy validation. Retain each source through job cleanup.
- `render_plan.py`: validate each music window against its own decoded source sample count, retaining current 48 kHz/frame and EOF rules. Replace the internal single music sample-count assumption with per-source counts; do not change picture or original-audio ownership resolution.
- `advanced_media.py` / `audio_composition.py`: open each distinct referenced music source once, reuse inputs already opened for original audio where applicable, and map each segment to its source input. Split streams per source, trim exact source sample windows, delay to timeline placement and mix into the existing music bus. Preserve silence, total picture duration and one application of Music mute/volume.
- Feed that same audio master to existing MP4, MOV, WAV and MP3 encoders. No format-specific edit interpretation, new codec, endpoint, package or configuration is needed. Frontend manifest construction submits original per-piece source references instead of a compiled WAV.

Add focused parser/render-plan/graph tests and actual multi-source export coverage if this path is later authorized. This is the minimal identified change for music replacement; any other discovered representational gap must likewise be documented before planning. This revision authorizes documentation only, not backend or frontend implementation.

Write portable project schema version 2 for per-piece music references, removing `edit.musicSourceId` from that version. Continue reading version 1 by migrating its music segments to their existing common source; reject unsupported future versions as before. Old app versions cannot open version 2 and must not be claimed compatible. Preserve exact frames, offsets, recipes, provenance, FPS, audio settings, overlays and export choices. Gather every referenced music source for Save/Open/relink and history leases. Derived export WAVs are temporary, never saved or added to the bin/history. Preserve atomic Open, missing-media recovery and existing media-storage policy.

## Errors and acceptance tests

All edit failures return a structured issue with lane/segment/source where available. Invalid splits preserve snapshot, history/redo, selection, playhead, source leases and picture. Show precise reasons: select editable audio; detach linked audio first; move inside rather than onto start/end; one-frame segments cannot split; source missing/unready; edit locked; active gesture; capacity reached; invalid FPS/range/overflow. Recheck at invocation so stale enabled state cannot commit an invalid edit.

Future verification uses installed tools and no package/configuration changes. Backend test additions are necessary only if the documented backend path is later authorized; no tests are changed in this task:

| Layer | Required evidence |
| --- | --- |
| Pure model | All supported FPS; exact formulas above; repeated cuts; trimmed and sped frozen recipes; nonzero offsets; first/last interior frame; one-frame/start/end/outside/noninteger splits; stale IDs, source EOF, limits and ID uniqueness. Verify unchanged picture and no mutation/history effect on every rejection. |
| Editing/history/UI | Dedicated Split Audio label/eligibility/reasons; linked-first detach; right-piece selection/focus; move/trim/replace each half; Delete/Backspace and explicit Lift; lane-only ripple; gesture commit/cancel; atomic async replacement; Undo/Redo and retained source leases. |
| Persistence/adapter | V1 migration and V2 Save/Open/relink; all per-piece references; repeated sources and released sources; multi-source packing offsets, gaps, EOF padding, source catalogs, forced V3, size/memory/decode failures and cleanup; no generated assets in saved state. |
| Real browser | Existing play/pause/resume and split continuity at 1x/0.75x/0.5x, across both audio lanes, seeks and edits. Retain current thresholds/assertions/deadlines. Reject stale native completions without weakening genuine autoplay/decode handling. |
| Layout/accessibility | Apply the selected-reference visual acceptance criteria at 1536x1024, 1440x900 and 1920x1080; inspect 1280x720, 768x1024, 320x800 and 200% zoom. Measure monitor/canvas/timeline rectangles through every preview/audio status at fixed viewports; only subpixel rounding tolerance. Verify left rail, all lanes, tooltips, contrast, keyboard focus, long filenames/errors and no page overflow. |
| Actual exports | Existing unchanged backend/FFmpeg integration tests plus frontend export journeys using distinct tone windows and identifiable picture frames. Verify every format, sample/window placement, music/original gain ownership, unchanged picture/duration and moved/trimmed/replaced/deleted halves after Save/Open. Use PCM/WAV for exact sample checks and codec-appropriate tolerances for AAC/MP3. Listen at untouched split boundaries. |

### Explicit preview-versus-export parity gate

For every case below, apply the edit in the real editor, capture the browser audio bus output and export the **same committed snapshot in all four formats**. Compare preview and decoded exports against an independently constructed expected event/sample map, not just against each other or a shared resolver. Distinct tones and impulse markers identify each source and offset. Check original and music buses separately, then together with known volume/mute settings; verify picture frames and duration remain unchanged.

| Edit | Preview and every export must agree on |
| --- | --- |
| Split | Both contiguous windows, exact cut/source offset and total duration; no duplicated/missing content, silence, extra voice or decoder restart at an otherwise continuous boundary. |
| Move | Only the selected half moves; its content/offset is unchanged, vacated space follows existing ownership/silence rules, and its sibling, picture and other lane stay fixed. |
| Trim | Start trim advances source and timeline together; end trim changes only the endpoint. Both edges preserve the sibling, minimum length and EOF behavior. |
| Delete | Ripple Delete removes the selected half and shifts only later same-lane pieces by its duration. Test Lift separately for retained gaps; detached-original deletion never restores linked sound. |
| Replacement | Only the chosen half uses the new source at the defined offset, with unchanged start/duration and sibling. Include different-file music pieces, independent audio and detached audio; no whole-song reset or doubled original sound. |

Run the matrix for detached/original, independent-file and music segments at every supported project FPS, including nonzero source offsets, repeated splits, source EOF, frozen video recipes at 1x/0.75x/0.5x, and edits near the export boundary. Repeat representative combined edit sequences after Undo/Redo and Save/Open/relink. Test single-source and multi-source delivery, whichever adapter/backend path is selected.

Assert frame/sample mapping exactly in the model and PCM master/WAV fixtures. Compare captured preview timing using existing browser synchronization tolerances, without relaxing them. For decoded MP4/MOV/MP3, account for independently measured codec priming/padding and use declared codec-specific timing/signal tolerances; never mask a wrong source offset, missing segment or lane shift as encoder delay. Capture actual sound output as well as transport state. Any mismatch blocks adapter acceptance and milestone completion; document the required backend correction if the contract/render path cannot express the edit faithfully.

After focused acceptance, run frontend tests, lint, format check, production build, relevant existing backend/render integration suites and browser regression suite. Record baseline failures separately; do not weaken assertions, skip tests or represent historical evidence as a current pass. A green screenshot or unit suite alone does not establish playback/export correctness.

## Exact exclusions and review conditions

- No application/test implementation in this task; no implementation plan yet. This file is the complete deliverable.
- No package, font, remote asset, configuration, backend/API/FFmpeg graph, commit, push, branch/worktree or deployment changes in this task. The minimal backend design above is a conditional future implementation scope, not authorization to change code now.
- No new lanes, overlapping clips within an audio lane, multiselect/batch splitting, subframe/sample-position editing, crossfades, fades, envelopes, per-piece gain, automation, audio effects, loudness processing, recording or waveform generation.
- No picture split/delete/trim/ownership change caused by audio operations; no implicit detach, relink-to-picture, linked delete or global ripple.
- No new docking/resizing framework, workspace presets, fullscreen mode, asset library, cloud storage, autosave, collaboration or export formats. Existing format availability and Save/Open behavior remain required.
- No broad playback rewrite, timing-threshold relaxation, fake transport/status/progress, removed recovery actions or unrelated refactoring.

Before implementation planning, review the export-fidelity rule and choose the faithful adapter or minimal backend path, plus the project V2 compatibility policy. The attached reference now defines visual acceptance as specified above; implementation alignment remains to be demonstrated. Full completion requires passing that visual review, the explicit preview/export parity matrix, playback/layout stability and actual exports in every format. Unresolved gates remain unmet requirements; no planning or implementation begins in this revision task.
