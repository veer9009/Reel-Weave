# AVStudio browser gate and timeline editing design

Date: 2026-10-20. Native sequential execution in the current workspace, as authorized by the user's combined milestone. Preserve all uncommitted Save/Open and playback work. This document and the companion plan precede production changes.

## Intent and constraints
Clear the full browser gate first; then enable Video 1 ripple insertion at zero/between clips and chosen-playhead audio splitting. Preserve preview layout/play/pause/split, exclusive audio ownership, source trims/speeds, selection/playhead anchors, Undo/Redo, Save/Open and MP4/MOV/WAV/MP3 exports. No packages, config/system changes, worktrees, commits, pushes, deployment or unrelated deletion. Backend edits require proof they are needed for final rendered output.

## Architecture
Reuse EditSnapshot, ProjectSources, history transactions, normalized output windows, AudioRecipe and existing manifest flow. A second timeline model duplicates source offsets; a backend-led editor violates frontend edit scope. Extend existing pure functions and UI callbacks with one history action per accepted edit. User authorized writing design/plan and continuing natively; no additional approval handoff.

## Phase 1: browser gate
Treat earlier classifications as evidence, not waivers. Read retained exact errors/traces, reproduce the original contracts, add deterministic failing tests and fix one demonstrated cause at a time. Deferred/stale native play completions must not pause a valid successor; true autoplay/decode failures and explicit pause/clear remain authoritative. Preserve live ownership timing, source leases and native decoder continuity.

Retain every acceptance assertion and current 40 ms residual/50 ms audio thresholds; no increased deadlines, skips or weaker expectations. Repair only proven setup/measurement faults at data collection boundaries, with focused tests and before/after evidence. Investigate FPS fallback, repeat eligibility and total render-test time budgets separately. Require complete browser suite green before Phase 2. Stop with evidence if the gate genuinely conflicts with preservation requirements.

## Phase 2: Video 1 ripple insert
Video 1 is an ordered contiguous occurrence list. Remove the dragged occurrence once, insert at the chosen boundary in the remaining list, and retain every other occurrence. Zero inserts first; append inserts last. Resolve interior drops to the nearest clip boundary (ties before), using original timeline geometry and adjusting destination for the removed occurrence. Self-drop is a no-op. Preserve IDs, output windows, trims, speed and originalAudio flags; linked audio follows picture. Independent audio/music and positioned overlays keep absolute positions. Retain selected ID and existing transport anchor mapping. Bin-source overwrite placement remains distinct. Reject stale IDs, locked edits and real capacity/source violations without mutation.

## Phase 3: chosen-playhead audio split
Reuse editIndependentAudio(action: split) for detached/independent audio and splitPositioned(track: music) for music. For strictly interior integer frame F, left/right are contiguous; right.sourceStartSample = old.sourceStartSample + leftDurationFrames * 48000/fps. Frozen video-edit recipes retain source trims, speed and normalization FPS. Select right piece and keep playhead at F. Invalid boundary splits leave project/history/owners untouched with accessible explanation.

Each piece supports move, trim, replace, own-lane ripple Delete/Backspace, explicit Lift, Undo/Redo and persistence. Audio edits never cut/delete Video 1. Music stays on its own volume-controlled lane. Inspect the existing shared musicSourceId invariant before independent music replacement; document any minimal backward-compatible manifest/project extension and prove final-render necessity before backend edits. A missing existing capability is not itself a blocker; stop only on a demonstrated conflict with user constraints.

## Persistence and acceptance
Round-trip reordered/split occurrences and exact sample offsets through save/relink and existing render manifests. Keep old project versions readable and resource cleanup/history replacement safe. Focused pure, integration/history/UI, Save/Open/manifest and real browser tests precede production changes. Verify actual picture/tone exports with existing FFmpeg integration tests. Run full frontend tests, relevant backend/FFmpeg tests, full browser suite, lint, format check, build, diff check and status, recording exact counts and outstanding manual visual/listening checks. No failed tests are waived as flaky.
