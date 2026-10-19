# Permanent preview status space

User-approved scope: two production files only, ProgramMonitor.tsx and EditingWorkspace.css. Reserve permanent vertical space; do not change playback, split, audio, controls, backend, packages, configuration, system settings, commits, pushes, or deployment. The earlier header-overlay proposal is superseded by the user's explicit permanent-space requirement.

Plan:

1. Add a focused real-component status-lifecycle test and a browser test against actual production layout, without injected styling. Verify the permanent-space contract fails before implementation.
2. Keep one status paragraph mounted and reserve a one-line minimum height. Preserve preparing/failure messages and role=status; clear text for ordinary playing/paused states.
3. Verify preparing, playing, paused, and resumed geometry and native progression at 1x, 0.75x, and 0.5x. No Split browser journey.
4. Run focused tests, full frontend tests, lint, repository and changed-file format checks, build, and diff check. Retain all existing experimental diagnostics/tests; do not alter their assertions to obtain passing results.
5. Require manual ordinary-Play smoothness confirmation before any further split work.

Pre-implementation production source matches committed 4d2c849. Existing diagnostic/test artifacts are preserved. Earlier clock/readiness prototype tests may retain requirements from withdrawn production candidates; any full-suite failures will be reported explicitly rather than addressed by changing playback logic under this layout-only scope.

## Implementation and evidence

The preparing paragraph previously mounted in normal document flow, adding 19.5px above the canvas and moving the downstream timeline. ProgramMonitor now always mounts one status paragraph; EditingWorkspace.css reserves its 1.5em minimum height with zero margin. Only these two production files differ from 4d2c849. Playback hooks and EditingWorkspace.tsx still match that commit.

The new ProgramStatus component regression failed before implementation because the initial status paragraph was absent. The new browser regression also failed before implementation because paused status height was zero, after completing native play/pause/resume. Baseline evidence is retained under var/reserved-status-before-2026-10-19.

After implementation, ProgramStatus.test.tsx and ProgramMonitor.test.tsx passed: 2 files, 13 tests. Browser runs use actual production CSS, not injected layout styling. A test-only hold on the first AudioContext.resume exposes preparation deterministically, then calls native resume. Geometry is measured independently of JavaScript callback timing; this establishes document layout stability, not a displayed-frame freeze or perceptual smoothness verdict. No native-time/wall-clock residual is used.

The initial six-case browser run had four passes: ordinary Play and status geometry at 0.75x and 0.5x. Both 1x cases failed with a sound-preview error: startup failed in ordinary Play, and a separate audio-error area expanded the timeline by 63.5px in the layout journey. Monitor/canvas coordinates and the reserved status height remained stable. Those failures and traces are retained unchanged under var/reserved-status-after-2026-10-19.

A single unchanged 1x recheck passed both cases (exit 0, 2 tests), under var/reserved-status-1x-recheck-2026-10-19. Successful geometry journeys at all three speeds show zero document-Y change for monitor, canvas, and timeline through before-play, preparation, playing, paused, and resumed. The status height is 19.5px throughout at the tested 1280x900 viewport. These runs do not establish absence of the intermittent audio failure. Preparing and resumed screenshots were visually inspected.

Commands from frontend:

```powershell
npm.cmd test -- src/components/ProgramStatus.test.tsx src/components/ProgramMonitor.test.tsx --maxWorkers=1
npm.cmd run test:e2e -- reserved-preview-status.spec.ts normal-playback-recovery.spec.ts --output=../var/reserved-status-after-2026-10-19
npm.cmd run test:e2e -- reserved-preview-status.spec.ts normal-playback-recovery.spec.ts -g "speed 1$" --output=../var/reserved-status-1x-recheck-2026-10-19
```

Lint passed (exit 0). Production build passed (exit 0, TypeScript plus Vite; 1783 modules). Changed-file Prettier check passed (exit 0). Whole-frontend format:check failed (exit 1) on four untouched baseline files: usePreviewMedia.test.tsx, usePreviewMedia.ts, useProjectAudio.test.tsx, and useProjectAudio.ts. No formatting changes were made there. git diff --check passed. The original four diagnostic file hashes remain unchanged.

Full frontend command `npm.cmd test -- --maxWorkers=1` completed with exit 1: 43 files passed, 2 failed; 353 tests passed, 7 failed (360 total; 700.24s). Four failures in preserved PlaybackReadiness.test.tsx expect no native start before the withdrawn experimental audio-readiness gate. Three failures in preserved SplitPlayback.test.tsx expect frame 26 instead of committed-baseline frame 25 after a split. Neither test file nor its assertions were changed. No playback fix was added to make these tests green.

Manual check requested: reload http://127.0.0.1:5173, use one ready Video 1 clip, and check ordinary Play, pause, and resume at 1x, 0.75x, and 0.5x, without splitting. The user replied: "great there is no jumping in pausing and playing and even not in split scene also". This is a positive manual report in response to the three-speed check, without individual speed results. The split observation was supplied by the user; no split-browser journey or further split work was performed. No commits, pushes, or deployment were made.
