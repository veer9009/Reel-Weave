# AVStudio verification record

Editing-workspace milestone, verified locally on Windows on 2026-10-06 with
existing tools. Implementation followed the nine approved tasks in native order.
No packages were installed; no package/lock/configuration files, system settings,
commits, pushes, deployments or backend application files were changed.

## Implemented behavior

- `/` opens one AVStudio editing workspace with local icon/wordmark/favicon assets.
- A complete-project projection drives four real lanes, one integer ruler and
  playhead, passive selection and silent approximate browser preview.
- Pending/unreadable clips invalidate timing for the whole sequence; later clips
  never compress around them. Overlay upload requires ready Video 1 timing.
- Existing upload validation, button reorder, inclusive trim, 1x/0.75x/0.5x speed,
  Auto/explicit FPS, image/PIP schedules, audio controls and MP4 rendering remain.
- PIP disappears at source EOF in browser preview and final MP4; it never holds
  its final frame. Backward seeking and source-time mapping changes reconcile
  actual-EOF state. Image/base/audio continue.
- Rendering uses existing manifests, multipart fields, jobs, polling, result
  preview/download and retention cleanup. Completed projects remain locked.
- `resetPlayback()` only stops playback and returns to frame 0 of a ready project.
  It preserves media, job/result, selection, settings, URLs, requests and revision.
  **New project** clears the whole browser project without deleting the backend job.
- Inspector disclosure preserves mounted metadata observers and drafts. Selection
  reveals the corresponding section; tiny clips can be selected with Inspect clip.
- Desktop uses three panels, tablet uses media/monitor plus full-width inspector,
  and mobile stacks in DOM order. Tall desktops scroll media/inspector internally;
  short windows scroll the page. Only the timeline scrolls horizontally at 320px.

## Commands and results

Commands use existing `.venv` and `frontend/node_modules`. Frontend commands run
from `frontend`; Python commands run from the repository root.

| Check                             | Command                                                                                       | Result                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Backend unit suite                | `.venv/Scripts/python.exe -m pytest tests/backend`                                            | 72 passed; two existing dependency deprecation warnings    |
| Real FFmpeg/FFprobe integration   | Child-process `RUN_FFMPEG_TESTS=1`; `.venv/Scripts/python.exe -m pytest tests/integration -q` | 7 executed and passed; none skipped                        |
| Python lint                       | `.venv/Scripts/python.exe -m ruff check backend tests`                                        | Passed                                                     |
| Python format                     | `.venv/Scripts/python.exe -m ruff format --check backend tests`                               | Passed; 16 files                                           |
| Frontend unit/component suites    | `npm.cmd test`                                                                                | 81 passed across 13 files; exit 0                          |
| Frontend lint                     | `npm.cmd run lint`                                                                            | Passed                                                     |
| Frontend format                   | `npm.cmd run format:check`                                                                    | Passed                                                     |
| TypeScript/Vite production build  | `npm.cmd run build`                                                                           | Passed                                                     |
| Installed Edge browser tests      | `npm.cmd run test:e2e`                                                                        | 5 passed in 1.7 minutes; main real flow 53 seconds; exit 0 |
| Branding/component scans and diff | `rg`, `git diff --check`, changed/untracked file inspection                                   | Passed; allowed absence-test literals only                 |

The integration opt-in was set only for the child process. Windows stripped quotes
from the plan's inline Python argument, so an ignored runner executed the same
subprocess/environment logic. A reproducible stdin equivalent is:

```powershell
@'
import os, subprocess, sys
child_env = dict(os.environ, RUN_FFMPEG_TESTS="1")
sys.exit(subprocess.call([sys.executable, "-m", "pytest", "tests/integration", "-q"], env=child_env))
'@ | .\.venv\Scripts\python.exe -
```

Initial frontend baseline had one 5-second test timeout. Later concurrent checks
overloaded the host; final unit/browser suites were run separately. App integration
tests use a suite-local 15-second timeout without changing configuration or assertions.
One intermediate browser render returned 422; its response trace was replaced by
the next Playwright run before diagnosis. Failure assertions now print the response.
The E2E untrimmed base lasts two seconds, guaranteeing the scheduled frame 49 exists
independently of browser-estimated metadata for the other, saved-trim clip.

The final read-only review found four regressions. Failing tests reproduced file
navigation on drops outside the upload area, a stale PIP EOF latch after start/FPS
changes, a 14px CSS minimum width on short intervals, and mobile error clipping
with a long filename. The fixes preserve upload-target handling, reconcile EOF
mapping, use inset decoration without width-imposing borders/padding, and wrap
error messages/actions. Unit and browser regression outcomes are recorded above.

Two minor review findings remain deferred: Video 2 lists PIP before image/logo,
and the disabled-render explanation is generic for busy/completed projects even
though their actual job state and New project action are shown.

## Real-media and workflow evidence

Python fixtures exercise MOV/WebM/MKV/MP4, mixed FPS/aspect ratios/codecs/audio,
ordering, inclusive one-frame trim, slow motion, original/music mix, short music
looping and long music truncation, range preview/download and deletion. FFprobe
checks frame counts, duration, FPS, H.264/AAC and 1280×720 output.

The new 25-FPS EOF case uses a 10-frame PIP starting at frame 10 and scheduled
through 49. Pixels show PIP at 19 and underlying base at 20, 21 and 49, matching a
no-overlay baseline. Image markers and audio remain. A schedule ending before source
EOF is inclusive and then absent. The graph retains `eof_action=pass:repeatlast=0:shortest=0`
without `tpad`, clone, repetition or PIP looping; backend application code is unchanged.

Edge uploads actual generated clips/image/PIP/music, validates and repairs a bad
schedule, trims/changes speed/reorders, checks preview PIP 19/20/backward seeking,
renders once, plays/downloads MP4, probes the downloaded codecs/resolution/FPS,
and verifies New project clears browser state while the backend result still exists.
It explicitly deletes that terminal test job afterwards. Lanes remain present
during upload/processing/completion; mutation controls lock appropriately.

| Screenshot                                               | State                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| [desktop-empty.png](screenshots/desktop-empty.png)       | Default workspace with empty real lanes                              |
| [desktop-arranged.png](screenshots/desktop-arranged.png) | Real clips, overlays and audio in the desktop workspace              |
| [desktop-result.png](screenshots/desktop-result.png)     | Completed MP4 beside the retained workspace                          |
| [mobile-arranged.png](screenshots/mobile-arranged.png)   | Stacked media/monitor/inspector and horizontally scrollable timeline |
| [mobile-result.png](screenshots/mobile-result.png)       | Completed MP4 playback/download/New project on mobile                |

## Accessibility and visual review

Browser assertions cover 1440×900, 1024×768, 899×768, 390×844, 320×640 and
1280×600; column placement, page overflow, 44px primary hit targets, reduced motion,
native range Arrow/Home/End, file-chooser keyboard access, trim focus containment/
Escape/return, inspector disclosure, selected states and linked errors. Collapsed
overlay errors retain visible review actions. Frame output has `aria-live="off"`;
job-stage announcements use the existing polite status region.

Screenshots were inspected for layout, both overlay slots and tiny/long-name access.
Local logo assets were reviewed at 16/24/32/64px and full wordmark size. Browser
contrast checks verify trim text ≥4.5:1 and overlay field boundaries ≥3:1; focused
controls retain cyan outlines. This is targeted verification, not a complete WCAG audit.
The browser also checks a 200%-zoom-equivalent 720×450 CSS viewport at device scale 2.

## Limits and remaining manual acceptance

- Actual screen-reader listening and native browser-toolbar 200% zoom were not
  performed; accessible DOM/keyboard checks and zoom-equivalent layout are partial evidence.
- Tested on Windows with installed Edge and mobile viewport emulation. Actual
  mobile hardware, Firefox, Safari, Linux and macOS were not exercised.
- Browser source FPS/timing and CSS overlay placement remain estimated/approximate;
  the rendered MP4 is authoritative. Browser preview does not audition the audio mix.
- Short deterministic media fixtures do not benchmark long videos, large files or
  sustained concurrent load. Existing Starlette/httpx/AnyIO warnings remain.
- No deployment, cloud, database, authentication or infrastructure verification was performed.

Historical specifications/plans retain original naming. Current setup and unchanged
legacy `REELWEAVE_*` configuration contracts are documented in the root README.

## Changed-file inventory

- Documentation: `README.md`, `docs/verification.md`.
- Captures: `docs/screenshots/desktop-empty.png`, `desktop-arranged.png`,
  `desktop-result.png`, `mobile-arranged.png`, `mobile-result.png`.
- Branding: `frontend/index.html`, `frontend/public/branding/avstudio-icon.svg`,
  `avstudio-wordmark.svg`.
- App integration: `frontend/src/App.tsx`, `App.test.tsx`, `styles.css`.
- New workspace components under `frontend/src/components`:
  `EditingWorkspace.tsx`, `EditingWorkspace.css`, `EditingWorkspace.test.tsx`,
  `Inspector.tsx`, `Inspector.test.tsx`, `ProgramMonitor.tsx`,
  `ProgramMonitor.test.tsx`, `ProjectTimeline.tsx`, `ProjectTimeline.css`,
  `ProjectTimeline.test.tsx`.
- Preserved-control integration under `frontend/src/components`:
  `BackgroundAudioTrack.tsx`, `ClipList.tsx`, `ClipList.test.tsx`, `JobResult.tsx`,
  `MergeSummary.tsx`, `OverlayTrack.tsx`, `TrimEditor.tsx`, `TrimEditor.test.tsx`,
  `UploadCard.tsx`.
- Playback: `frontend/src/hooks/useProjectPlayback.ts`,
  `useProjectPlayback.test.tsx`.
- Shared projection/API tests: `frontend/src/lib/timeline.ts`, `timeline.test.ts`,
  `api.ts`, `api.test.ts`; `frontend/src/test/fixtures.ts`, `setup.ts`.
- Browser coverage: new `frontend/e2e/avstudio.spec.ts`; removed
  `frontend/e2e/reelweave.spec.ts`.
- Removed obsolete demo: `frontend/src/components/TimelineDemo.tsx`,
  `TimelineDemo.css`, `TimelineDemo.test.tsx`.
- Backend regression coverage only: `tests/backend/test_composition.py`,
  `tests/integration/test_real_merge.py`.

The approved specification and implementation plan were already untracked at the
start and remain untouched. Git status therefore also lists those documents.

## Advanced timeline editing milestone — 2026-10-13

Continued the existing working tree and the approved twelve-task plan natively,
without subagents, installs, package/lock/configuration changes, system changes,
commits, pushes or deployment. The approved plan/specification remain untouched.

### Behavior and regression decisions

- Video 1 supplies sequence duration. Multiple non-overlapping Video 2 takes
  replace full-screen picture and original audio for their own half-open ranges;
  Video 1 resumes at its corresponding time. Separate image/PIP composition and
  PIP disappearance at source EOF remain in preview and real FFmpeg rendering.
- Music has explicit movable, trimmable, splittable segments. Middle deletion
  closes only the music lane; Undo/Redo restores exact ranges and source identity.
  Short music stops at EOF with silence; long music is bounded by Video 1 at export.
- The UI sends a Version 2 catalog with each referenced video source uploaded
  once. The older `history_delivery` and split assertions now check that catalog,
  retaining their occurrence order, inclusive trim, speed, gains/mute, PIP/overlay,
  FPS and resource-release assertions. Legacy manifest behavior remains accepted.
- FFprobe validates authoritative source ranges before queueing. Original PCM
  and picture use the same priority intervals, music uses 48 kHz sample ranges,
  and the final output remains CFR H.264/yuv420p 1280×720 with stereo AAC MP4.
  Failed execution cannot publish an incomplete result; rejected real uploads
  leave no uploaded, intermediate or output job directory.
- A real one-frame 60-to-24 FPS regression initially produced an empty video.
  `fps` EOF pass rounding, bounded by the approved output-frame count, fixes it.
  The test checks base/replacement/base frames 39/40/41 and exact PCM length.
- A browser regression exposed Auto FPS validating unchanged music frame counts
  before conversion. The failing controller test now passes with conversion before
  source-window validation, including Undo/Redo. One-frame timeline buttons now
  preserve physical width without a padding minimum. The Overlay/PIP inspector
  badge no longer labels overlays as Video 2.
- Browser tests use real uploads, jobs, FFmpeg and downloads. Fixture readiness,
  card geometry selectors and inspector scroll were corrected in the harness.
  Edge omits multipart bodies from its request inspection; a forwarding fetch
  observer records the exact FormData manifest without mocking the render API.
  Render completion is awaited by status with a bounded assertion timeout.

### Evidence boundaries and manual acceptance

Automated browser checks cover desktop/tablet/mobile layouts, keyboard controls,
dialog Escape, invalid cross-track drops/overlap, replacement source trim, drag,
split, delete and Undo; music middle ripple/Undo/Redo; gain changes; PIP EOF and
backward seeking; invalid replacement repair after a base trim; exact one-frame
geometry; real rendering/download, New project, failed-job retry and accessibility
names/focus. Downloaded output checks exact frame/FPS/codec/dimension metadata,
picture boundaries and audio tone priority/absence. The real-media suite also
covers gaps, EOF silence, long tails, silent replacements, slow mixed-FPS split
equivalence, malformed sources/ranges and legacy rendering.

Generated desktop/mobile captures were inspected for this milestone. They show
the five lanes and current controls; no unrelated capture was added. Browser
preview remains silent and approximate; downloaded FFmpeg output is authoritative.
Manual listening, an actual screen reader, native 200% browser zoom, other
operating systems and other browsers were not exercised and remain manual
acceptance work. Automated viewport/DOM/audio analysis is not claimed as those
manual checks.

The default parallel Windows frontend runner once printed 219 passing tests but
then exited with access violation `-1073741819`. Repeating the complete suite
with the command-line option `--maxWorkers=1` yielded exit 0. No configuration
or runtime package was changed. Sandboxed Vite/esbuild could not traverse an
ancestor directory; approved executions outside the sandbox were used for tests,
build and the installed Edge browser. Existing FastAPI/Starlette/httpx/AnyIO
deprecation warnings and Playwright NO_COLOR/FORCE_COLOR warnings were retained.


### Final commands and results

Existing tools: Windows PowerShell, Node v24.20.0, Python 3.10.11,
FFmpeg/FFprobe 8.1.2, installed Microsoft Edge. No tools were installed.

| Command | Actual result |
| --- | --- |
| `npm.cmd test -- --maxWorkers=1` | 32 files, 221 tests passed; exit 0; 258.00 s |
| `.\.venv\Scripts\python.exe -m pytest tests/backend -q` | 99 passed; exit 0; 4.98 s; 2 existing deprecation warnings |
| `.\.venv\Scripts\python.exe var/advanced-timeline/run_real.py tests/integration` | 17 passed, no skips; exit 0; 168.65 s; 2 existing deprecation warnings |
| `.\.venv\Scripts\python.exe -m ruff check backend tests` | All checks passed; exit 0 |
| `.\.venv\Scripts\python.exe -m ruff format --check backend tests` | 28 files already formatted; exit 0 |
| `npm.cmd run lint` | No errors or warnings; exit 0 |
| `npm.cmd run format:check` | All matched files formatted; exit 0 |
| `npm.cmd run build` | TypeScript and Vite passed; exit 0; 1,774 modules; Vite 18.16 s |
| `npm.cmd run test:e2e` | 7 passed; exit 0; all existing and new browser tests executed |
| `git diff --check` | No whitespace errors; exit 0 |

Python commands run from the repository root; npm commands run from `frontend`.
The ignored stdlib runner passes `RUN_FFMPEG_TESTS=1` only to the pytest child
process, without changing environment configuration or system settings. The build
initially exited 1 on optional metadata typing in the new regression test fixture;
the fixture type assertion was corrected and the build rerun successfully. All
lint/format checks were run again after that test-only correction. Git's existing
LF-to-CRLF notices are warnings, not whitespace errors or configuration changes.

### Exact changed-file inventory and final Git status

The output below is the final `git status --short`, including all new and modified
files. The two approved spec/plan documents were already untracked at the start
of implementation and remain untouched. The five changed captures are generated
by the existing browser workflows. Ignored build/test artifacts and the local
execution ledger are not repository deliverables. No files were staged or deleted.
No commit, push, deployment, install, package/lock/configuration or system-setting
change was made.

```text
 M README.md
 M backend/app/jobs.py
 M backend/app/main.py
 M backend/app/media.py
 M docs/screenshots/desktop-arranged.png
 M docs/screenshots/desktop-empty.png
 M docs/screenshots/desktop-result.png
 M docs/screenshots/mobile-arranged.png
 M docs/screenshots/mobile-result.png
 M docs/verification.md
 M frontend/e2e/avstudio.spec.ts
 M frontend/src/App.history.test.tsx
 M frontend/src/App.test.tsx
 M frontend/src/App.tsx
 M frontend/src/components/BackgroundAudioTrack.tsx
 M frontend/src/components/ClipList.tsx
 M frontend/src/components/EditingWorkspace.tsx
 M frontend/src/components/Inspector.test.tsx
 M frontend/src/components/Inspector.tsx
 M frontend/src/components/OverlayTrack.test.tsx
 M frontend/src/components/OverlayTrack.tsx
 M frontend/src/components/ProgramMonitor.test.tsx
 M frontend/src/components/ProgramMonitor.tsx
 M frontend/src/components/ProjectTimeline.css
 M frontend/src/components/ProjectTimeline.test.tsx
 M frontend/src/components/ProjectTimeline.tsx
 M frontend/src/hooks/useEditHistory.test.tsx
 M frontend/src/hooks/useEditHistory.ts
 M frontend/src/lib/api.ts
 M frontend/src/lib/clips.ts
 M frontend/src/lib/editHistory.ts
 M frontend/src/lib/historyProjection.ts
 M frontend/src/lib/projectSources.ts
 M frontend/src/lib/timeline.ts
 M frontend/src/test/historyFixtures.ts
 M tests/backend/test_api.py
?? backend/app/advanced_media.py
?? backend/app/audio_composition.py
?? backend/app/manifests.py
?? backend/app/render_plan.py
?? docs/superpowers/plans/2026-10-13-avstudio-advanced-timeline-editing.md
?? docs/superpowers/specs/2026-10-13-avstudio-advanced-timeline-editing-design.md
?? frontend/e2e/advanced-timeline.spec.ts
?? frontend/e2e/mediaFixtures.ts
?? frontend/src/App.advanced.test.tsx
?? frontend/src/components/PositionedClipEditor.test.tsx
?? frontend/src/components/PositionedClipEditor.tsx
?? frontend/src/components/PositionedTrack.test.tsx
?? frontend/src/components/PositionedTrack.tsx
?? frontend/src/components/TimelinePlacementDialog.test.tsx
?? frontend/src/components/TimelinePlacementDialog.tsx
?? frontend/src/components/TimelineSourceProbe.test.tsx
?? frontend/src/components/TimelineSourceProbe.tsx
?? frontend/src/lib/advancedManifest.test.ts
?? frontend/src/lib/advancedManifest.ts
?? frontend/src/lib/advancedTimeline.test.ts
?? frontend/src/lib/advancedTimeline.ts
?? frontend/src/lib/positionedEdits.test.ts
?? frontend/src/lib/positionedEdits.ts
?? tests/backend/advanced_fixtures.py
?? tests/backend/test_advanced_api.py
?? tests/backend/test_advanced_manifest.py
?? tests/backend/test_advanced_media.py
?? tests/backend/test_audio_composition.py
?? tests/backend/test_render_plan.py
?? tests/integration/advanced_fixtures.py
?? tests/integration/test_advanced_timeline.py
```
