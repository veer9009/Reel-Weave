# AVStudio resume readiness coordination

Status: working-tree candidate, not manually accepted. The user confirmed that both the picture and timeline playhead jump on pause/resume. Earlier clock-only candidates were rejected; their passing tests do not constitute acceptance.

## Root cause and plan

The Play handler started the transport before audio registered readiness. React runs the ProgramMonitor child's layout effect before the parent's audio synchronization. Video therefore started, was paused by the audio readiness gate, and started again when audio became ready. Synchronous pause anchoring prevented the earlier rewind seek but did not prevent this premature start.

The retained pre-change trace records start/pause/start on resume with rendered frame changes 67 to 69 before splitting and 202 to 204 afterward. It contains no backward DOM position transition. This is real DOM/native lifecycle evidence, not independently sampled pixels or a native-time/wall-clock freeze residual. Evidence: `var/pause-resume-display-rejected-2026-10-19/pause-resume-display-trace-55baf-sume-before-and-after-split/display-diagnostics.json`.

Test-first plan:

1. Exercise EditingWorkspace, useProjectPlayback, usePreviewMedia, ProgramMonitor, and useProjectAudio together; fake only browser decoder/Web Audio boundaries.
2. Delay initial audio acceptance for each user start. Require video to remain stopped until readiness, then start exactly once from the held position. Cover 1x, 0.75x, 0.5x and muted/no-target playback.
3. Register the existing audio gate synchronously in the Play handler, before any child preview effect can start video. Adopt the new live generation so ordinary synchronization does not discard the precommit gate.
4. Compare the same browser trace before/after; run focused tests, full frontend tests, lint, formatting, build, and diff checks. Require fresh manual acceptance of split/pause/resume at all three speeds.

## Minimal delta

- EditingWorkspace.tsx: set Play intent, synchronously prepare the existing audio gate, then resume audio. Pause and picture-only toggle behavior retain their existing path.
- useProjectAudio.ts: expose readiness preparation, using the existing ensureGate implementation and the live transport generation. Ownership, source targets, voice logic, thresholds, and gain behavior are unchanged.

Earlier three-file clock/boundary work remains in the working tree. This continuation does not change trim/split planning, FPS/export behavior, undo/redo policy, packages, configuration, backend, or system settings.

## TDD and review

New integration test: `frontend/src/components/PlaybackReadiness.test.tsx`. Clean red run: four cases failed because video started once before readiness (expected zero). The prior mock-only split journey did not include the real audio readiness participant.

An intermediate test fixture left a later audio play promise unresolved across pause; it was corrected to defer only the first acceptance of each requested user start. Muted/no-target resume can be ready synchronously and must start once, rather than wait artificially.

Focused run before the review guard: six files, 60 tests passed, exit 0. Read-only review identified a missing-projection edge: optional audio controls without an advanced projection could acquire a gate that synchronization would never release. The added table case failed with video permanently paused, then passed after guarding preparation with the existing snapshot/sources/projection prerequisites. All five new integration cases passed, exit 0.

The first gated browser attempt, retained under `var/pause-resume-display-gated-2026-10-19`, failed its initial native-progress journey-control poll before reaching pause/resume. Its records include a long JavaScript observation gap and a later audio failure message. This is not an accepted before/after journey and does not prove a physical-screen freeze. No thresholds or existing assertions were changed.

The serial retry reported its diagnostic journey passed (57.4 seconds), retaining `var/pause-resume-display-gated-serial-2026-10-19/pause-resume-display-trace-55baf-sume-before-and-after-split/display-diagnostics.json`. Its 261 observations contain no backward DOM publication and no preview VIDEO currentTime write. Actual resume-input boundaries show:

| Resume | Held frame at input | Preparing frame | First video start | Frame at first start |
| --- | --- | --- | --- | --- |
| Before split | 307 | 307 | 24128.5 ms, after readiness | 307 |
| After split | 372 | 372 | 27728.9 ms, after readiness | 372 |

Unlike the pre-change trace, neither resume contains a premature first video start followed by readiness suspension. The source time at first start equals the native paused time (12.305083 s and 14.904000 s). This journey runs at 1x; it proves the recorded call ordering and DOM holds, not physical-screen smoothness. Native progress polling controls the journey only. Process shutdown and final verification results will be recorded below when available.

## Acceptance

No manual success claim. Reload and verify picture, time display, and playhead through Play, Split at Playhead, Pause, and Play at 1x, 0.75x, and 0.5x after verification completes. Check pause/resume before any split as well.

All pre-existing diagnostics and browser artifacts are retained. No commit, push, or deployment.
