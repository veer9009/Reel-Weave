# AVStudio split-preview visual verification plan and feasibility result

**Goal:** Compare same-source split playback with uninterrupted playback using displayed Program Monitor pixels from 200 ms before through 200 ms after each marker.

**Scope:** Test-only investigation at HEAD `4d2c849`. Preserve all existing uncommitted diagnostics, production behavior, assertions, thresholds, and audio logic. No production, backend, UI, package, configuration, commit, push, or deployment changes.

## Capture validity rule

A freeze finding requires independently timestamped samples of the displayed output that continue across the interval of repeated Program Monitor pixels, while the uninterrupted journey shows motion over the corresponding source interval. Delayed delivery of a sample must not become its acquisition timestamp. Missing capture samples must produce an inconclusive result, never repeated-frame evidence. Page JavaScript callbacks, video currentTime, and native-time versus wall-clock residuals cannot establish a visible freeze.

## Test-only plan

- [x] Inspect the current split/control journeys, fixture, browser configuration, and installed capture implementation without modifying them.
- [x] Gate implementation on a capture path that can distinguish displayed-frame repetition from missing/delayed observations.
- [ ] Only if that gate passes, add a separate visual-only spec using the existing six-second 60 FPS continuity fixture, project FPS 25, speed 1, and matched source markers. Keep existing tests and diagnostic instrumentation unchanged.
- [ ] Start independent capture before playback. Record the actual split event and corresponding uninterrupted marker on a correlated clock with bounded uncertainty; do not use Playwright click completion as the event time. Retain the original timestamped recording and Program Monitor crop for both journeys, covering marker minus 200 ms through marker plus 200 ms.
- [ ] Validate capture continuity and source alignment before comparing pixels. Reject missing coverage, ambiguous marker alignment, or capture gaps as inconclusive. Do not derive visible-freeze findings from the existing timing residual or introduce a new freeze threshold.

## Feasibility result: stop before implementation

The capture validity gate has not passed with the existing setup. No new browser journey was run and no fresh visual evidence was captured. The remaining steps are intentionally unimplemented under the user's explicit stop condition.

The existing `frontend/playwright.config.ts` selects Desktop Edge / msedge, retains traces on failure, and does not enable video capture or configure headed operation. The existing continuity spec records `requestVideoFrameCallback` observations and draws a 16 by 9 canvas inside that callback. It records a brightness sum, not an independently sampled history of displayed pixels. Delayed callbacks can leave observation gaps while playback continues.

Installed Playwright core is 1.63.0. In `frontend/node_modules/playwright-core/lib/coreBundle.js`:

- Around line 37040, the video recorder sets `fps = 25`; its FFmpeg output uses `-r ${fps}`. The recorder also emits the last buffer again at shutdown. The resulting constant-rate video alone does not prove each repeated output frame was a fresh display observation.
- Around line 37955, Chromium screencast events supply image data and a metadata timestamp, falling back to `Date.now()` when the timestamp is absent; acknowledgement follows screencast client handling.
- Around line 22146, screencast handling forwards received frames to clients. This path provides no independent record of display sampling during an interval with no received frames.

Raw CDP screencast data could improve on page callback timing by retaining capture timestamps separately from arrival times. That alone does not prove continuous display sampling or distinguish an unobserved interval from an unchanged displayed image. A successful control journey cannot validate missing observations in the split journey. Screenshots likewise cannot reconstruct pixels during an unsampled interval. This is a limitation of what can be concluded from these capture paths, not proof of a playback defect or proof that all browser-based visual testing is impossible.

A future attempt needs a validated capture path with timestamped acquisition, capture-gap reporting, and marker correlation independent of page callback delivery, for example an independently validated desktop/display recorder for a headed browser. That setup is not established here and was not added or substituted.

Official references: [Playwright video recording](https://playwright.dev/docs/videos), [Chrome DevTools Page protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/). The specific recorder behavior above was inspected in the installed local implementation.

## Preservation baseline

SHA-256 values before this new document was written:

| Existing diagnostic file | SHA-256 |
| --- | --- |
| `frontend/e2e/playback-continuity.spec.ts` | `24537A916D30DA24BBA01D6FD60C8B60D0F0EEFF62B86AFB96D6CD212302FB47` |
| `frontend/e2e/previewSeekDiagnostics.ts` | `F5557E2857C54B5334ACC424B3A785445359C08F9190D1073EA01342A2B2E454` |
| `docs/avstudio-continuation-2026-10-18.md` | `D05A6BAC23DD61838415A80D45B1B33AE01516AD5F8234165AA9C63135481E7C` |
| `docs/avstudio-unexpected-seek-investigation.md` | `FF924ECB0823F4387F7BCBEA205B6603E0955FF6349CA57F6FC01DC5FE1FB3DA` |
