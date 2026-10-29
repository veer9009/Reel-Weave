# AVStudio audio/export parity — 2026-10-28

**Current status: focused synchronization fixes are retained; final preview parity is not fully verified. See the current follow-up section below.** Historical status before this follow-up: no new production fix was retained. The accepted UI and all existing work remain preserved. No timing or signal thresholds were relaxed.

## Workspace and scope

Resumed the dirty working tree on `backup/avstudio-oct16`, HEAD `59b5333`. Inspected this report, the October 21 audio execution ledger, approved audio design/plan, October 28 UI verification and existing source/test changes before attempting further fixes. No checkout, reset or cleanup of existing changes was performed.

The latest resume retained changes only to `frontend/e2e/audio-edit-parity.spec.ts` and this report, plus ignored diagnostic artifacts under `var/`. The source files remain dirty from earlier work; the latest output-gate experiment was removed with a targeted patch, preserving earlier changes. There are no new CSS, layout, backend, schema, editing, playback or render changes from this resume.

No packages were installed. No configuration, commit, push or deployment was made. The reserved preview-status space and accepted UI were not changed.

The pre-existing pnpm files were neither created nor edited in this audio pass. Earlier evidence places their creation in the installed pnpm workspace on October 22; the exact creating command is not established. Final SHA-256 hashes still match:

- `frontend/pnpm-lock.yaml`: `BB593D9B305D6B4C08B54F73053F391F03ABBE04CB0279A70ACBAC045A8AB03B`
- `frontend/pnpm-workspace.yaml`: `D6D0C24446D91EF762D37C6BA801BB516E65D7055AA9F8027FCD457409A97CE1`

## Results inspected before the latest experiment

The complete browser matrix finished **24 passed / 5 failed** (`var/avstudio-audio-complete.log`). Preview failures were:

- 60 FPS music split: coverage distance 0.942185 s, limit 0.05 s; exports were not reached.
- Independent split and music split: preview power ratio 0.530677, minimum 0.7.
- Detached split: coverage distance 0.397835 s, limit 0.05 s.
- Music end-trim: coverage distance 0.799936 s, limit 0.05 s.

All **84 MP4/MOV/WAV/MP3 exports from the 21 edit journeys** passed. These cover independent, detached and music lanes with split, move, start/end trim, ripple delete, lift delete and replacement. Another 12 exports passed for 24/30/50 FPS split cases. This was 96 checked exports; the failing 60 FPS preview did not establish an export failure.

The latest resume changed the FPS test so preview failures are retained while all four exports are still checked. It also saves native picture-clock history and `parity-results.json`. Assertions and thresholds are unchanged.

The focused **pre-experiment retained-code** rerun (`var/avstudio-audio-resume-splits.log`, artifacts `resume-splits/`) then recorded:

| Case | Preview | MP4 | MOV | WAV | MP3 |
| --- | --- | --- | --- | --- | --- |
| 60 FPS music split | PASS | PASS | PASS | PASS | PASS |
| Independent split | FAIL: power ratio 0.530677 < 0.7 | PASS | PASS | PASS | PASS |

The variability of the missing-start failure is not evidence of a stable fix. The retained production implementation is the same as in this rerun.

## Diagnosis and rejected experiment

Independent split PCM near project 1.9 s contains an early transition from 660 Hz to 990 Hz. Retimestamping the raw capture against saved picture-clock history did not remove it. One retained observation had picture at approximately 1.894 s, native audio at 2.011 s and device render-ahead near 32 ms. Device render-ahead alone does not explain the mismatch. Complete root cause and a safe correction remain open.

The missing-start evidence showed picture at 0.65–1.35 s while audio context/voice clocks had only just begun. Inspection found that wall-time extrapolation of a stale device-output timestamp can satisfy the readiness gate without confirmed device progress. A regression with a valid stale timestamp and advancing performance clock failed before an experimental correction (`avstudio-audio-stale-output-red.log`). Requiring confirmed output-context progress passed that regression and all 66 focused hook tests (`avstudio-audio-stale-output-green.log`).

**That experiment was not retained.** End-to-end verification (`avstudio-audio-resume-final-browser.log`, artifacts `resume-final/`) finished **4 passed / 4 failed**:

- All three running audio-split continuity cases and 60 FPS split preview passed; both split cases' eight exports passed.
- Independent split still failed, this time with incorrect tone energy (0.00122545 versus minimum 0.006).
- Native 1× / 0.75× / 0.5× sync failed at 114.843 / 213.564 / 192.501 ms against 50 ms.

The stricter gate lets native sound advance while picture is still starting; improving an isolated readiness assertion did not establish synchronized playback. Saved the experimental source/test copies under `var/avstudio-audio-parity-2026-10-28/stale-output-experiment-*`, then restored only those experimental lines. No fixed timing offset, delay or repeated continuous seeks were added.

The native 1× control also failed with the prior gate, so the experiment is not an isolated explanation for all failures. Existing independent native clocks, picture startup and readiness holds need further investigation together. Earlier isolated chirp controls showed that native slow-speed pitch-preserving sound can also differ from FFmpeg's normalized output; this is diagnostic evidence, not a tolerance waiver.

## Latest checks on the retained production code

| Check | Result | Evidence |
| --- | --- | --- |
| Native 0.75× audible sync | **PASS**, max 36.700 ms | `avstudio-audio-retained-slow.log`, `retained-slow/` |
| Native 0.5× audible sync | **FAIL**, max 145.829 ms > 50 ms | Same log/artifacts |
| Repeated native 1× audible sync | **FAIL twice**, max 104.056 / 146.448 ms | `avstudio-audio-retained-control.log`, `retained-control/` |
| Same-source picture split, 1× | **FAIL twice**: decoder identity changed; second attempt timed out waiting for additional presented frames | Same control log, lines 24–99 |
| Uninterrupted picture control, 1× | **1 pass / 1 fail**; failed status was `preparing` instead of `playing` | Same control log |
| Combined repeated control run | **1 passed / 5 failed** | Same control log |
| Focused audio/picture/transport hooks | **66 passed**, exit 0 | `avstudio-audio-retained-hooks.log` |
| Production build | **PASS**, exit 0, TypeScript + Vite, 1,795 modules | `avstudio-audio-retained-build.log` |
| Lint | **PASS**, exit 0 | `avstudio-audio-retained-lint.log` |
| Formatting of restored hooks and changed FPS test | **PASS** | `avstudio-audio-retained-format.log` |
| Whitespace check | **PASS**, exit 0 | `avstudio-audio-resume-diff-check.log` |

The broad frontend run during the rejected experiment finished **534 passed / 2 failed (15-second timeouts)**, 536 tests in 58 files (`avstudio-audio-resume-frontend.log`). Both timed-out App tests passed in isolation with their original timeout (`avstudio-audio-resume-app-retest.log`). This is not a single clean full-suite pass. No complete frontend-suite rerun was performed after removing the experiment; the focused hook suite was rerun.

Earlier retained-code running audio-split verification passed all three lanes twice (**6/6**, `avstudio-audio-continuity-browser.log`). The complete 29-test browser matrix was not repeated after the experiment was removed. Detached/music split and music end-trim failures from that matrix remain open, not implicitly resolved.

## Real MP4, MOV, WAV and MP3 output

The focused FFmpeg run reported **56 passed / 54 deselected**, covering **224 output checks**: split, move, start/end trim, delete and replacement on independent/detached/music lanes at 25/50/60 FPS, plus frozen detached split recipes at 0.75× and 0.5×. WAV is checked against exact independent stereo PCM (within one sample value); lossy outputs retain the existing power/correlation requirements. MP4/MOV also check picture/frame counts. No export assertion failed in the completed summary.

**The verification process nevertheless exited abnormally with Windows status `0xC0000005` after its passing summary.** This is not a clean command pass; its cause remains unverified. Log: `var/avstudio-audio-render-focused.log`. The larger 110-test run was interrupted to focus verification and is not a completed result.

An isolated slow-export recheck used Python fault diagnostics and recorded the child-process status directly:

Process status: `0x0` (return code `0`). See `var/avstudio-audio-slow-export-recheck.log` and `var/avstudio-audio-slow-export-process.json`. **2 passed / 108 deselected**, all eight slow-speed MP4/MOV/WAV/MP3 outputs checked with a clean exit.

Both preview sync and rendered output have been checked separately. Passing output checks do not turn a preview failure into a pass. No MP4/MOV/WAV/MP3 format was unavailable in the focused runs.

## Preserved earlier audio work

Existing changes retained from before the latest experiment include final readiness-token release ordering, bounded spare-voice preloading at exact boundaries, native picture clock binding, freezing holds at mounted picture position, output readiness staging, and inspector-disclosure test setup corrections. Continuous native seeks were previously rejected because they caused decoder thrashing. No such correction was reintroduced.

Those earlier dirty audio-related files remain in the working tree:

- `frontend/src/hooks/useProjectAudio.ts` and `.test.tsx`
- `frontend/src/hooks/useProjectPlayback.ts` and `.test.tsx`
- `frontend/src/hooks/usePreviewMedia.ts` and `.test.tsx`
- `frontend/src/components/ProgramMonitor.tsx` (nonvisual clock binding)
- `frontend/e2e/audioParityFixtures.ts`
- `frontend/e2e/playback-continuity.spec.ts`
- `frontend/src/App.test.tsx`

Other pre-existing UI/source/test/report changes and untracked files remain preserved. Latest-resume retained changed-file list: **`frontend/e2e/audio-edit-parity.spec.ts` and `docs/avstudio-audio-parity-verification-2026-10-28.md`**. Ignored diagnostic scripts, raw PCM, picture-clock history, traces, screenshots and output media remain under `var/avstudio-audio-parity-2026-10-28/`.

The full audio/export regression is **not passing**. The 40 ms positioning bound, 50 ms sync/coverage limit, 0.7–1.3 power ratio, channel/correlation checks and silence thresholds remain unchanged.


## Current follow-up: preview synchronization fixes

This follow-up started at HEAD `1e57802` (`WIP: preserve workspace redesign and audio investigation`). The earlier work above was already committed by the user. Initial status contained only the two untracked pnpm files; both were preserved. The historical results above describe earlier implementations, not the final code from this follow-up.

### Reproduction and diagnosis before fixes

The first four-case browser run reproduced independent split plus native 1x/0.75x/0.5x failures (`var/avstudio-preview-sync-baseline.log`, artifacts `var/avstudio-preview-sync-fix/baseline/`). Native audible error maxima were approximately 91.15/138.99/162.09 ms against the existing 50 ms limit. The native cursor led picture by approximately 87-91 ms; slow native pitch preservation added content displacement beyond cursor displacement. Exports reached by the independent split case passed in all four formats.

A stale device timestamp could also open readiness before confirmed output progress. Repeatedly changing audio delay caused pitch distortion in a rejected diagnostic implementation; that implementation was removed. Continuous decoder seeking was not reintroduced.

A later browser diagnostic exposed a separate integration fault: a 60 FPS source was imported as 30 FPS when video-frame callbacks skipped frames under load. That caused the canonical slow recipe to fail validation with "Normalized source window is unavailable. Re-trim the clip." The final frame-rate fix accounts for frame-counter deltas when computing source FPS. A direct actual-function regression failed before the fix and passed after it (`var/avstudio-preview-sync-fps-red.log`, `var/avstudio-preview-sync-fps-green.log`). The browser's total-video-frame counter includes displayed and dropped frames; see [Media Playback Quality](https://w3c.github.io/media-playback-quality/).

### Retained changes

- Preview voices measure startup lead against picture and device render-ahead once the clock has advanced through a frame/device pipeline interval, then hold a constant DelayNode compensation. No fixed assumed offset or repeated continuous seek is used. Paused/released voices disconnect their delayed output so buffered tails cannot enter a later owner.
- Readiness waits for confirmed device progress. Preparation failure pauses only an active playback intent, preventing a repeated React pause/update loop.
- Slow video-edit audio recipes use the existing canonical export audio graph and play the prepared WAV at native rate 1. Prepared recipes are cached, leased, aborted/revoked on removal or stop, and reused across contained split windows. Late asynchronous replies are guarded against a newer session.
- The minimal backend integration is `POST /api/preview-audio`: it reuses existing upload/manifest validation and `render_audio_master`, returns only WAV, bounds concurrent preparation, and cleans temporary files after streaming. The regular merge route delegates to the same upload handler. Export/render math, source schema, editing/history operations, and UI styling are unchanged.
- Frame-rate estimation now divides sampled media-time deltas by frame-counter deltas, avoiding display-cadence estimates when callbacks skip frames.
- Browser diagnostics follow the actual mixer graph rather than assuming a direct source-to-bus connection. Native-sync fixture generation was moved to a shared beforeAll hook after a trace showed about 90 seconds spent generating fixtures inside a 120-second test. Test timeouts and all signal/timing bounds are unchanged.

### Verification from this follow-up

| Check | Result and limits |
| --- | --- |
| Real canonical preview WAVs, 0.75x and 0.5x | PASS: exact length and independent canonical stereo PCM within one sample value; temporary uploads cleaned |
| Slow split exports, 0.75x and 0.5x | PASS: eight actual MP4/MOV/WAV/MP3 outputs, existing PCM/power/correlation/picture checks |
| Combined direct integration process | PASS: 4 passed / 108 deselected, return code 0 / Windows status 0x0; `var/avstudio-preview-sync-final-exports.log`, `var/avstudio-preview-sync-final-exports-process.json` |
| Focused audio hook tests | PASS: separate final run 36 passed, exit 0; `var/avstudio-preview-sync-final-audio-unit.log`. Earlier combined run had 36 passes plus a worker-start error in the next file |
| Recipe request/cancellation/error tests, separate run | PASS: 3 passed, exit 0; `var/avstudio-preview-sync-final-recipe-unit.log` |
| Clip/frame-rate tests | PASS: retry 16 passed, exit 0; `var/avstudio-preview-sync-final-clips-retry.log`. Direct production-function red/green also passed. Initial Vitest attempt had a worker startup timeout |
| Backend endpoint unit tests | Three passing assertions were reported; that command did not yield a confirmed clean completion. The later real integration process above did exit cleanly |
| Latest seven-case browser matrix before final FPS correction | 1 passed / 6 failed; details below; `var/avstudio-preview-sync-final-browser.log` |
| Isolated 0.5x after FPS correction | Unavailable: timed out before Backend ready/import, no acoustic samples; `var/avstudio-preview-sync-fps-corrected-slow.log` |

The seven-case matrix passed running independent-audio split continuity. Detached continuity missed its eligible live window and reached natural project end; music continuity failed in page setup. Independent split PCM capture timed out before exports. Native 1x and 0.5x timed out waiting for backend readiness before import. Native 0.75x reached preparation but hit the source-FPS validation failure diagnosed above. These failures are retained, not counted as passes or dismissed as proven environmental faults.

An earlier candidate passed independent split preview plus its four exports and measured native 1x max error 10.09 ms (`var/avstudio-preview-sync-fix/aligned/`). This predates the final audio-only route, tail handling, and FPS correction and is not a final-code parity claim.

Final shared-setup browser retry: **1 failed / 2 did not run**. FFmpeg fixture generation failed in beforeAll with empty stderr before playback or acoustic capture. No three-speed synchronization result was obtained. Evidence: `var/avstudio-preview-sync-final-shared-setup.log`, artifacts `var/avstudio-preview-sync-fix/final-shared-setup/`.

Final lint: **PASS, exit 0**, `var/avstudio-preview-sync-final-lint-fixed.log`. The first lint run caught an empty fixture-parameter pattern introduced in the shared setup; it was fixed and both focused and full lint reran successfully.

Final production build: **PASS, exit 0**, TypeScript plus Vite, 1,796 modules; `var/avstudio-preview-sync-final-build.log`. Whitespace check also passed. Both pnpm hashes were rechecked and match the historical values above.

Full preview parity at all three speeds is **not established**. No complete broad audio/export regression was run in this follow-up. No export format was unavailable in the completed direct integration checks. The 40 ms positioning bound, 50 ms sync/coverage limit, power/correlation and silence thresholds are unchanged.

### Files changed in this follow-up

- `backend/app/main.py`
- `frontend/src/hooks/useProjectAudio.ts`
- `frontend/src/hooks/useProjectAudio.test.tsx`
- `frontend/src/lib/previewAudioRecipe.ts` (new)
- `frontend/src/lib/previewAudioRecipe.test.ts` (new)
- `frontend/src/lib/clips.ts`
- `frontend/src/lib/clips.test.ts`
- `frontend/e2e/playback-continuity.spec.ts`
- `tests/backend/test_preview_audio.py` (new)
- `tests/integration/test_preview_audio_endpoint.py` (new)
- This verification report

The accepted UI, logo, reserved preview-status space and existing work are preserved. No packages, configuration files, commits, pushes or deployments were made. Some commands encountered automatic approval-review timeouts (no safety finding); permitted retries were used. Test-worker and page-startup failures are reported above. Diagnostic logs, PCM, traces and screenshots remain under `var/avstudio-preview-sync-fix/`.

## Browser verification resumption: fixture diagnosis

Preserved the complete dirty tree from the previous follow-up. This resumption changes only the test fixture helper, native-sync test setup, and this report; no application or accepted UI changes were made.

The earlier shared-setup trace locates its failure at the unused PNG command in `generateAdvancedMedia`, before browser playback. The old error handler discarded the process error, status and signal and displayed only empty stderr, so its exact exit cause cannot be recovered from that log alone.

An instrumented standalone run of the original complete fixture generator succeeded: all seven FFmpeg commands exited 0, including the PNG and 60 FPS chirp video (`var/avstudio-preview-sync-fixture-diagnosis.log`). The unchanged three-speed browser retry then passed fixture preparation but its 1x case timed out in `page.goto('/')`, before media import. That run was interrupted during the next case to investigate setup; it is not a completed three-speed result (`var/avstudio-preview-sync-resume-three-speed.log`).

Direct frontend HTML/module and backend-health preflight requests returned HTTP 200 in approximately 16-125 ms (`var/avstudio-preview-sync-server-preflight.log`). A minimal Edge navigation without the test's playback diagnostics eventually reached Backend ready, but took approximately 143 seconds including launch and page creation (`var/avstudio-preview-sync-navigation-control.log`, exit 0). Its browser was closed. Process inspection found no accumulated orphan test browsers; the observed Edge process belonged to that control. These observations establish variable browser/startup delays, not a measured synchronization failure.

The fixture helper now reports command arguments, process status, signal, spawn error and stderr. A subsequent actual chirp generation reproduced **`spawnSync ffmpeg ETIMEDOUT`, status null, signal SIGTERM**, with empty stderr (`var/avstudio-preview-sync-required-fixtures.log`, exit 1). Thus an empty-stderr fixture failure can be a real 60-second process timeout rather than an invalid-media error. It does not prove the unrecoverable original PNG exit cause, nor establish why process startup/execution is intermittently slow on this host.

The native-sync setup now generates only the existing deterministic stereo WAV and the same 60 FPS chirp video, removing six unused FFmpeg encodes. The WAV generator was extracted without changing its samples; byte comparison against the earlier generated WAV passed before the subsequent chirp timeout. Other advanced-media tests retain their original fixtures. FFmpeg's 60-second timeout, Playwright's 120-second test timeout, 15-second expectation timeout, 40 ms positioning bound, 50 ms sync/coverage limit and all signal assertions remain unchanged.

### Collected results (2026-10-29)

- Focused lint of both changed test files: PASS, exit 0 (`var/avstudio-preview-sync-resume-lint.log`). Prettier reported both files unchanged; the completed whitespace check passed.
- Reduced five-case Edge run: recorded a browser launch timeout of 180000 ms before the running independent-split test body. The run was interrupted afterward; there is no completed five-case summary. Log: `var/avstudio-preview-sync-resume-focused.log`; artifacts: `var/avstudio-preview-sync-fix/resume-focused/`.
- Minimal installed-Chrome fallback control: also failed with a 180000 ms browser launch timeout before navigation (`var/avstudio-preview-sync-chrome-control.log`). No Chrome audio-parity matrix was started. This per-process browser selection did not edit repository or persistent configuration.
- Preview 1x / 0.75x / 0.5x: UNAVAILABLE as final acoustic measurements in this resumption. The earlier 1x attempt timed out in navigation; subsequent setup/launch failures prevented accepted audio observations.
- Independent split PCM parity and running split continuity: UNAVAILABLE in this resumption. The recorded running-split failure was in browser launch, not an audio assertion. Exports in the PCM journey were not reached.

The setup change removes unnecessary encodes and exposes process failures; it does not establish reliable fixture or browser startup on this host. The underlying reason for intermittent process delays remains unverified. No timeouts or audio thresholds were raised. Full preview parity remains unverified; earlier export/build/frontend results above remain historical, not fresh passes from this resumption.

Changed in this resumption: `frontend/e2e/mediaFixtures.ts`, `frontend/e2e/playback-continuity.spec.ts`, and this report. All prior application/UI changes and pnpm files are preserved. No packages, configuration files, commits, pushes or deployments were made. One automatic approval-review timeout was retried successfully; the actual fixture retry then exposed the FFmpeg timeout above. A later report-update tool call stalled without completing and was terminated; this result section was written separately.

## Resource-gated verification resumption (2026-10-29, approximately 20:15 IST)

Inspected checkpoint HEAD `89ce9e9` and the latest report before any browser or FFmpeg test. Initial working-tree status contained only the two untracked pnpm files. Their SHA-256 hashes match the values recorded above. All existing changes and artifacts were preserved.

The initial read-only CIM queries returned `Access denied` (`0x80041003`), so their empty/zero fields are not resource measurements. A successful read-only Windows API query through the existing Python environment measured:

| Resource | Measurement |
| --- | --- |
| Logical CPUs | 4 |
| CPU busy, one-second sample | 87.7% |
| Physical memory occupied | 96% |
| Available / total physical memory | 0.31 / 7.87 GiB |
| Available system commit | 7.10 GiB |
| Free workspace disk space | 87.57 GiB |

`Get-Process` listed 11 Chrome and 12 Edge WebView2 processes. No Node, Python, FFmpeg or FFprobe process was listed in that snapshot (before the short resource-query Python invocation). CIM access restrictions prevented command-line/parent inspection, so browser ownership was not established. No process was stopped.

**Resource blocker:** only 0.31 GiB physical RAM available at 96% memory occupancy, with CPU already 87.7% busy. Given the reported laptop slowdown and earlier launch/fixture timeouts, no browser or FFmpeg test was started. This is a preflight stop, not a test failure or a new acoustic result. No test was retried.

| Requested check | Fresh result |
| --- | --- |
| Normal-speed (1x) preview audible synchronization | NOT RUN: resource preflight blocked launch |
| 0.75x preview audible synchronization | NOT RUN: normal-speed prerequisite not established |
| 0.5x preview audible synchronization | NOT RUN: normal-speed prerequisite not established |
| Independent-audio split parity | NOT RUN: normal-speed prerequisite not established |
| Playback continuity | NOT RUN: normal-speed prerequisite not established |

Only this report was edited in this resumption. No application/UI, fixture, threshold or configuration changes were made. No packages were installed and no commit, push or deployment was performed. Historical passes above remain historical; full preview parity is still unverified. The next verification remains one normal-speed preview test with one worker, followed by separate checks only if that test passes and resources permit.

## Sequential verification continuation (2026-10-29, completed approximately 20:31 IST)

Continued at `89ce9e9`, preserving the existing report edits and both untracked pnpm files. Before tests, a one-second CPU sample measured 73.7% busy; physical RAM was 93% occupied with 0.49 GiB available out of 7.87 GiB, and disk space was 88.14 GiB free. Process inspection listed Chrome but no Node, Python, FFmpeg, FFprobe or Edge test process. Read-only commands completed promptly. After the 1x test, available RAM improved to 0.88 GiB (88% occupied), and no test processes remained in the checked process names.

Each selected test ran in a separate Playwright command with `--workers=1 --retries=0 --max-failures=1`. Commands completed before the next started; no parallel browser or FFmpeg jobs were launched. Existing fixture generation, test timeouts and assertions were unchanged. No selected test timed out or was retried.

| Check | Fresh result | Evidence / command completion |
| --- | --- | --- |
| 1x preview synchronization | PASS: 54 samples, maximum error 34.9865 ms against 50 ms | Test 25.5 s; Playwright summary 1 passed in 56.0 s; Playwright exit 0, enclosing PowerShell process abnormal status `0xC0000005` |
| 0.75x preview synchronization | PASS: 75 samples, maximum error 5.4781 ms against 50 ms | Test 24.7 s; 1 passed in 45.5 s; command exit 0 |
| 0.5x preview synchronization | PASS: 67 samples, maximum error 7.2526 ms against 50 ms | Test 27.9 s; 1 passed in 46.8 s; command exit 0 |
| Independent-audio split | PASS: preview plus MP4, MOV, WAV and MP3 | Test 47.4 s; 1 passed in approximately 1.1 minutes; command exit 0; all five entries in `parity-results.json` are `passed` |

The initial sandboxed 1x command failed before the test body because Vite/esbuild could not read an ancestor directory or resolve `vite.config.ts` (`Access is denied`). The same single-test command was then allowed outside the sandbox and produced the 1x results above. The initial independent-split command selected no tests because of an incorrectly anchored title selector; correcting that selector selected exactly one test. Neither setup command produced an acoustic result. These setup attempts are not counted as test passes.

The 1x wrapper printed `PLAYWRIGHT_EXIT_CODE=0` after the passing summary, but the execution tool returned signed process status `-1073741819` (`0xC0000005`). Its cause remains unverified; the 1x assertion pass is supported by saved samples, but this is not a clean end-to-end command completion. Subsequent tests used direct Playwright invocation and exited 0. No timeout retry, package installation or configuration change was used.

Artifacts are under `var/avstudio-audio-sequential-2026-10-29/`: `normal-speed-elevated/`, `slow-075/`, `slow-05/` and `independent-split-selected/`. Each speed saves `actual-audio-output.json`; the independent split saves `parity-results.json` and real exports. The 1x startup logs are `var/avstudio-audio-sequential-2026-10-29-normal-speed.log` and `var/avstudio-audio-sequential-2026-10-29-normal-speed-elevated.log`.

This continuation verifies only these four selected cases. Running split decoder continuity, other lanes/edit journeys and the broad regression were not run. The accepted UI, source, configuration, fixtures, timeouts and signal/timing thresholds remain unchanged. Only this report was edited; both pnpm file hashes still match the earlier recorded values. No manual process termination, installs, commits, pushes or deployment occurred.

## Manual playback regression investigation and repair (2026-10-29)

Started from `89ce9e9` with the preceding report edits and two untracked pnpm files already present; preserved them. Before browser work, measured CPU busy 59.0%, physical RAM occupied 92% with 0.62 GiB available, and free disk space 87.84 GiB. Inspected existing processes and ports: Vite on 5173 and Uvicorn on 8000 were already running; reused them without stopping them. No parallel browser or FFmpeg jobs were launched. All Playwright and Vitest commands used one worker; Playwright retries remained zero. The full unit suite was slow (523.10 seconds); a later resource snapshot showed 94% RAM occupied and 0.40 GiB available. Browser work waited until that suite finished.

### Reproduction before application changes

Added `frontend/e2e/manual-playback.spec.ts` to exercise the actual editor through import, speed selection, Play, Pause, resume, natural completion and Play again. It retains the ordinary imported clip's default 60 FPS project, adds no background music, and does not invoke the separate clip-preview selection action. Diagnostics instrument test-served responses only and save transport intent/status/position, readiness tokens, media cursors/events and actual audio analyser energy. No production diagnostic API or UI was added.

Baseline: **0 passed / 3 failed**. Initial playback and pause/resume advanced picture and non-silent sound at **1x, 0.75x and 0.5x**. Thus a clean first slow-speed start did not reproduce the reported failure. Replay failed at every speed. At 1x the project reset to zero, then the first readiness hold restored the mounted picture's old end position (359/360 frames); playback stopped again. Both slow cases also stopped just before the project end with "Sound preview cannot play base60.mp4" and audio reset to zero, so another Play could not recover. Evidence: `var/avstudio-manual-playback/baseline/`.

### Confirmed causes and retained fixes

- **Stale native clock at replay:** `toggle()` advances the explicit position revision when restarting, but the immediate user-action readiness hold runs before the new position reaches mounted media. Reading the old decoder clock restored the previous session position. `useProjectPlayback` now excludes that clock until the position revision reaches the layout commit, then resumes native-clock use. The focused regression failed first with 1.96 seconds received instead of zero, then passed.
- **Native audio EOF restarted before picture completion:** sound can finish before picture. Calling native `play()` at EOF restarts it at zero. The native `ended` flag is visible before its queued event; guarding only the event left a race. The intermediate browser run exposed `sound-ended` at time zero, followed by `waiting` and `AbortError: The play() request was interrupted by a call to pause()`. `useProjectAudio` now recognizes both native EOF and its event, retains the exhausted range as ready silence through pause/resume, and reopens it only for a reposition or changed mapping. An explicit near-end seek forces the native cursor away from EOF even inside the unchanged normal positioning tolerance. Focused regressions failed before correction for premature restart (zero instead of six seconds) and a 5.98-second seek remaining at six seconds, then passed.

The first event-only EOF correction was insufficient: an intermediate three-case run finished **1 passed / 2 failed**, with both slow cases stopping before the final project frame. Those results are not final passes. The subsequent native-flag correction and review boundary fixes are retained. A read-only code review identified the exhausted pause/resume and near-end seek boundaries; both are covered. No fixed offset, extra delay, continuous seek loop, timeout increase or threshold relaxation was added.

### Fresh final verification

| Speed | Ordinary playback | Pause/resume | Completion and replay | Existing acoustic sync |
| --- | --- | --- | --- | --- |
| 1x | PASS: picture/audio advance, nonzero sound energy | PASS: both pause within 40 ms and advance on resume | PASS: final project frame reached, replay advances picture/audio | PASS: 76 samples, max 10.1439 ms <= 50 ms |
| 0.75x | PASS | PASS | PASS | PASS: 38 samples, max 3.0431 ms <= 50 ms |
| 0.5x | PASS | PASS | PASS | PASS: 38 samples, max 3.4626 ms <= 50 ms |

Final manual editor run: **3 passed**, clean exit 0, approximately 2.1 minutes; individual test times 39.2/41.4/36.9 seconds. All three final traces contain no `sound-play-error`. Artifacts: `var/avstudio-manual-playback/final-eof-race-fix/`, with `manual-playback.json` per speed. Separate unchanged acoustic assertions: **3 passed**, clean exit 0, approximately 1.3 minutes; `var/avstudio-manual-playback/final-sync/`, with `actual-audio-output.json` per speed. No final selected browser test hit its test timeout. The baseline replay assertions exhausted the existing 15-second expectation timeout; they were investigated rather than repeatedly retried unchanged.

| Additional check | Fresh result |
| --- | --- |
| Full frontend suite, `vitest run --maxWorkers=1` | PASS: **543 tests / 59 files**, exit 0, 523.10 seconds |
| Focused audio/picture/transport hooks before final boundary extensions | PASS: **69 tests**, exit 0; the later full suite includes final boundary coverage |
| Full lint | PASS, exit 0 |
| Production build | PASS, exit 0: TypeScript and Vite, 1,796 modules |
| Independent split preview parity | **FAIL**: power ratio 0.3630049896 < 0.7; no threshold change or blind retry |
| Same independent split MP4 / MOV / WAV / MP3 | **PASS / PASS / PASS / PASS**, real output decoded and checked |

The independent-split command exited 1 because its preview assertion failed; four passing exports do not turn that command into a pass. Artifacts: `var/avstudio-manual-playback/final-independent-split/`, including `parity-results.json`, PCM evidence, picture-clock history, trace and four rendered files. Inspection found mixed tone energy near project 1.9 seconds: expected 660 Hz amplitude 0.12, observed approximately 0.0723 with 990 Hz amplitude approximately 0.04578. This resembles the earlier report's premature-transition failure pattern; this run does not establish its cause or prove it unaffected by these changes. No further parity retry or unrelated edit/export change was attempted. Full audio/edit parity remains unverified.

Retained application changes are limited to `frontend/src/hooks/useProjectPlayback.ts` and `frontend/src/hooks/useProjectAudio.ts`, with focused coverage in their existing unit files and the new manual-playback browser spec. This report retains all earlier results. Accepted UI/components/styles, audio editing/history operations, canonical render/export code, fixtures, configuration and timing/signal thresholds were not changed. Both untracked pnpm file hashes still match the recorded originals. No packages, commits, pushes, deployments or manual process termination occurred. One sandboxed unit command failed during esbuild config access; the permitted command outside the sandbox supplied the actual red/green evidence. No configuration workaround was made.

## Later slow-preview source-metadata follow-up (2026-10-29)

Reproduced a separate actual-clip failure: portrait video had 169 decoded frames while the longer AAC/container duration produced an estimated 172-frame import. Slow preview returned 422, “Frozen audio source trim is unavailable”; ordinary export already clamps untouched sources. Imports now inspect authoritative video bounds before initializing the default range. Actual-clip 1x/0.75x/0.5x preview and non-silent mixer advancement passed against an isolated updated backend; two real slow MP4 outputs passed. Final frontend suite: 550 passed; backend: 201 passed / 2 skipped; lint and build passed. After explicit user approval, only the backend on port 8000 was restarted; fresh health and OpenAPI checks confirmed the new endpoint is active. Already-imported estimates are not migrated automatically. Full evidence, harness failures, scope and remaining limitations are in [the slow-preview follow-up](avstudio-slow-preview-verification-2026-10-29.md). The independent-split preview failure above remains open.
