# Experimental frontend test cleanup

Scope: tests only. Keep all production behavior and the confirmed permanent preview-status row unchanged. No backend, packages, configuration, system settings, commits, pushes, or deployment.

Plan: reproduce the seven failures; compare their contracts with the retained production code and existing regressions; remove only obsolete prototype diagnostics; retain the passing playback control; run focused and full frontend tests, lint, formatting checks, build, and diff checks.

## Failure inventory and disposition

The focused pre-cleanup run reproduced seven failures and one pass in 25.82s (exit 1).

| File / test | Parameters | Disposition and reason |
| --- | --- | --- |
| PlaybackReadiness.test.tsx — video starts once after audio readiness | speed 1, muted=false, advanced=true | Removed obsolete prototype case. Required zero native video play calls immediately after toggle, before React/audio effects completed. The production pre-start gate it expected was withdrawn. |
| Same test | speed 0.75, muted=false, advanced=true | Removed for the same obsolete pre-start contract. |
| Same test | speed 0.5, muted=false, advanced=true | Removed for the same obsolete pre-start contract. |
| Same test | speed 1, muted=true, advanced=true | Removed for the same obsolete pre-start contract; even muted playback was required to wait. |
| SplitPlayback.test.tsx — playing split preserves the displayed position and next picture | speed 1 | Removed obsolete clock-prototype instrumentation. Required frame 26 after a synthetic 12ms edit at 25 FPS, against the retained integer-frame edit mapping returning 25. Also imposed the withdrawn presentation-origin, paused-picture, and extrapolation contracts. This synthetic clock harness does not prove a visible freeze. |
| Same test | speed 0.75 | Removed for the same obsolete clock-prototype contract. |
| Same test | speed 0.5 | Removed for the same obsolete clock-prototype contract. |

SplitPlayback.test.tsx contained only those three prototype diagnostics and was removed. No expected frame value was changed to match the implementation. No skips, todos, expected failures, or suite exclusions were added.

The previously passing PlaybackReadiness muted=true, advanced=false control remains as `muted base preview pauses and resumes from the current timeline position`. Its real EditingWorkspace/transport/picture/audio hooks remain in use. Removed the now-unused deferred-audio promise setup and conditional advanced branches. Retained its native play/pause, play-count, Preparing-cleared, and frame-20 pause/resume assertions. Browser media/Web Audio boundaries remain simulated because jsdom provides no decoder or audio graph.

## Coverage retained

- ProgramStatus.test.tsx retains the real status lifecycle regression.
- reserved-preview-status.spec.ts retains actual browser geometry checks at 1x, 0.75x, and 0.5x.
- ProgramMonitor.test.tsx retains `same_source_split_retains_element_and_does_not_pause_or_seek`.
- useProjectPlayback.test.tsx retains shared picture/audio readiness, stale-token cancellation, picture-clock observation, structural edits, and pause behavior.
- useProjectAudio.test.tsx retains native preparation, audio ownership at splits, graph readiness, and stale-session handling.
- usePreviewMedia.test.tsx retains picture readiness, pause/resume positioning, and source handoff behavior.

The retained control would fail if Play did not start native video, Pause did not stop it, resume restarted from zero, or Preparing remained visible. Removed cases do not establish whether every temporal split-clock scenario is correct; this cleanup makes no new playback-fix claim.

## Verification

- Before cleanup: `npm.cmd test -- src/components/PlaybackReadiness.test.tsx src/components/SplitPlayback.test.tsx --maxWorkers=1` — 7 failed, 1 passed; exit 1.
- After cleanup: focused PlaybackReadiness, ProgramStatus, ProgramMonitor, useProjectPlayback, useProjectAudio, and usePreviewMedia suites — 6 files / 55 tests passed; exit 0.
- `npm.cmd run lint` — passed, exit 0.
- `npm.cmd run build` — passed, exit 0 (TypeScript and Vite; same CSS/JS artifact hashes as before cleanup).
- `npx.cmd --no-install prettier --check src/components/PlaybackReadiness.test.tsx` — passed, exit 0.
- `npm.cmd run format:check` — failed, exit 1, on the same four untouched baseline files: src/hooks/usePreviewMedia.test.tsx, src/hooks/usePreviewMedia.ts, src/hooks/useProjectAudio.test.tsx, and src/hooks/useProjectAudio.ts. This test-only task does not reformat production hooks or unrelated tests.
- `git diff --check` — passed, exit 0.
- Before/after hashes of ProgramMonitor.tsx, EditingWorkspace.css, useProjectPlayback.ts, usePreviewMedia.ts, and useProjectAudio.ts match exactly. Production hooks and EditingWorkspace.tsx also still match committed 4d2c849.

`npm.cmd test -- --maxWorkers=1` completed successfully: **44 files / 353 tests passed**, **0 failed, 0 skipped**, exit 0; duration 795.24s. The prior total was 360 tests: exactly seven obsolete cases were removed and the passing muted/base control was retained. No configuration exclusions were added.

Final status: full frontend tests, focused tests, lint, changed-test formatting, build, and diff checks pass. Repository-wide formatting remains red only for the four untouched baseline files listed above. No production behavior or reserved-status layout code changed in this cleanup. No commit, push, or deployment was performed.
