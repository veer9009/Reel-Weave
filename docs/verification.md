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
