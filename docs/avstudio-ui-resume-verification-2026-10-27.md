# AVStudio UI resume verification — 2026-10-27

## Scope and recovered state

Resumed the existing checkout at `59b5333` (`backup/avstudio-oct16`). Initial status contained 24 modified tracked files and three untracked files: `frontend/e2e/ui-polish.spec.ts`, `frontend/pnpm-lock.yaml`, and `frontend/pnpm-workspace.yaml`. All were preserved. No commits, pushes, deployment, package installation, dependency updates, configuration changes, or backend source edits were performed.

Read the existing workspace/audio-split verification ledger, approved design, implementation plan, current UI/playback diffs and browser checks before editing. The existing changes already implement the dark cinematic palette, spacious 27/46/27 desktop panels, compact Media Bin and Inspector, five distinct timeline lanes, persistent left tool rail, 16:9 monitor, and bounded preview/status regions. Existing audio readiness, native hold, live handoff and keyboard ripple edits remain untouched in this session.

Historical evidence is not a new pass: the ledger records 526 frontend tests passing before a later characterization, but a full browser audit of 95 tests had 76 passes and 19 failures. Native sound alignment remained outside the unchanged 50 ms bound at all three speeds. Latest broad frontend/build/browser gates were pending after subsequent live-handoff changes. Backend and real-export historical passes also predate those changes. This session prioritizes UI verification and does not claim audio-parity acceptance or full milestone completion.

## pnpm files

Both untracked pnpm files have filesystem creation/last-write timestamps on October 22, before this resume. The lockfile uses pnpm lockfile schema 9 and records resolved dependency versions. Installed dependencies contain `node_modules/.pnpm`; `.modules.yaml` points to the user's pnpm store. This supports prior pnpm dependency setup as their origin, but no retained log identifies the exact command or intent. Do not claim an intentional package-manager migration.

The workspace file contains only:

```yaml
allowBuilds:
  esbuild: set this to true or false
```

This is an unfinished esbuild build-permission setting, not application functionality or an established monorepo workspace definition. Its exact creation command is unverified. Neither file was edited, removed or used to install packages. Existing npm scripts and installed binaries were used for checks.

SHA-256 at inspection:

- `pnpm-lock.yaml`: `BB593D9B305D6B4C08B54F73053F391F03ABBE04CB0279A70ACBAC045A8AB03B`
- `pnpm-workspace.yaml`: `D6D0C24446D91EF762D37C6BA801BB516E65D7055AA9F8027FCD457409A97CE1`

## UI continuation

The ready-state approximate-preview notice was visually clipped by `sr-only`. Added real-browser geometry assertions to the existing readability check; RED reproduced a width of 1 px against the required width greater than 100 px. Evidence: `var/avstudio-ui-resume-2026-10-27/notice-red/`.

Changed only the notice's presentation in `ProgramMonitor.tsx`: show the existing approximate-preview text when ready; retain its accessible text while preparation/recovery occupies the same fixed feedback slot. No panel dimensions, media keys/refs, clocks, source mapping, controls, callbacks, features, logo or configuration changed. The reserved preview-status and feedback space remain intact.

Ruling: continue the existing approved written design, without inventing a new reference or redesign. The two approved ChatGPT Library images, `AV Studio Mountain Lake Editing Suite.png` and `AV Studio Video Editing Workspace.png`, still have no verified local paths. Exact side-by-side reference acceptance remains pending. Screenshots use real generated test-media files (including a solid-colour test video); they are verification fixtures, not replacement reference artwork.

## Fresh verification

All commands run from `frontend` unless stated otherwise. Installed tools only; existing deadlines and assertions retained.

| Check | Result |
| --- | --- |
| Initial `node ./node_modules/@playwright/test/cli.js test e2e/ui-polish.spec.ts` | 5 passed, exit 0, before notice correction. |
| Baseline professional-workspace + reserved-preview-status + workspace-audio-layout | All 16 assertions passed, but command exit was `-1073741819` after summary; not a clean command pass. |
| Notice geometry RED | 1 failed, exit 1; clipped 1 px notice reproduced before correction. |
| Final ui-polish + workspace-audio-layout + reserved-preview-status | All 11 assertions passed (4.6 minutes), including notice GREEN and all three playback speeds; command exited `-1073741819` after summary, so not a clean command pass. |
| Native `cmd.exe` rerun of `ui-polish.spec.ts` | 5 passed, exit 0 after the correction. Log: `var/avstudio-ui-resume-2026-10-27/cmd-ui.log`; screenshots in sibling `cmd-ui/`. |
| `node ./node_modules/vitest/vitest.mjs run src/components/ProgramMonitor.test.tsx src/components/ProgramStatus.test.tsx src/components/MediaBin.test.tsx --pool=threads --maxWorkers=1` | 19 tests, 3 files passed, exit 0. |
| `npm.cmd run build` | Passed, exit 0; TypeScript and Vite, 1794 modules. |
| Scoped ESLint: `src/components/ProgramMonitor.tsx e2e/ui-polish.spec.ts` | Passed, exit 0. |
| Scoped Prettier check on those two files | Passed, exit 0. |
| `git diff --check` from repository root | Passed, exit 0; only existing LF/CRLF notices. |

The first sandboxed browser launch failed because esbuild could not read ancestor directories. The identical command ran with broader process access; no configuration workaround or package changes. A separate baseline browser wrapper returned the native Windows access-violation exit above after all tests passed; retained as an execution failure rather than hidden.

Final browser evidence is under `var/avstudio-ui-resume-2026-10-27/final/`. It includes empty/populated desktop screenshots at 1536x1024, 1440x900 and 1920x1080, populated 1366x768, scaled 200%-equivalent reflow, preparation/resume screenshots and recorded geometry at 1x/0.75x/0.5x, and long-feedback layouts at 1536/1440/320 widths. Equivalent device scaling is not a claim of manual browser-chrome zoom testing.

## Outstanding acceptance

- Human review of the screenshots and exact comparison with the unavailable approved images.
- Existing native sound timing, preview/export parity and failed broader browser journeys require their own verification/fixes. No tolerance or timing assertion was relaxed.
- Full frontend, full browser, backend and every-format export suites were not rerun in this UI-focused resume. The prior whole-tree formatting failure (including archived files and pnpm lockfile) is not resolved by scoped formatting.
- Review was a local self-review; the existing sequential/no-subagent handoff was preserved.
