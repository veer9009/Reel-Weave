# Play/pause layout movement: committed-baseline comparison

The user continued to report both picture and playhead jumping. All tracked production source under frontend/src has now been manually restored to 4d2c849. `git diff --exit-code 4d2c849 -- frontend/src` exits 0. No reset/checkout, diagnostic deletion, or new clock correction was used. The former three-file experimental diff is retained at `var/avstudio-experimental-playback-before-baseline.diff`.

## Confirmed visible geometry change

The Preparing Preview paragraph is inserted in normal document flow between the Program heading and video canvas. At viewport 1280 by 900, it adds 19.5 pixels of height. Both the video canvas and timeline move down by 19.5 pixels and back up when the paragraph disappears.

The pre-rollback ordinary play/pause journey recorded canvas Y 45.59375 to 65.09375 to 45.59375, and timeline Y 492.34375 to 511.84375 to 492.34375. During the resume readiness transition native time held at 0.842514 seconds while both elements moved. Thus this layout jump exists independently of a media-time seek or clock rebase. This does not establish absence of any separate temporal playback skip.

Pre-rollback evidence: `var/play-pause-experimental-2026-10-19/play-pause-baseline-ordinary-play-pause-resume-at-speed-1/play-pause-layout.json`.

## Independent test-only comparison

New diagnostic: frontend/e2e/play-pause-baseline.spec.ts. No Split action. Each journey uses one clip, Play, Pause, and Play at 1x, 0.75x, or 0.5x.

The initial AudioContext.resume is held only in the test until screenshots of both stable readiness states are acquired. The test then calls the original native resume and completes ordinary native playback, pause, and resume. It records real getBoundingClientRect geometry in document coordinates, so automatic scrolling is not mistaken for document reflow. It retains before-play.png, preparing.png, resumed.png and JSON observations. No callback gap or native-time/wall-clock residual is treated as pixel-freeze evidence.

Two variants use identical geometry assertions:

- Committed baseline UI: the geometry assertion is expected to fail if the readiness paragraph shifts the canvas/timeline, after the native play/pause/resume journey has completed.
- Proposed placement, injected only into the test page: position the readiness message in the Program Monitor header, outside normal document flow. This should leave canvas/timeline geometry unchanged.

The test-page selector covers direct status paragraphs; the actual proposal is narrower and adds a class only to Preparing Preview. These are equivalent on successful Preparing journeys but the test does not execute the exact source patch. Geometry is asserted for initial held preparation; the ordinary resume readiness transitions are retained in JSON but this is not a claim of temporal/pixel smoothness.

Final comparison: six journeys completed native play/pause/resume. All three committed-layout cases failed the geometry assertion by exactly +19.5 pixels; all three test-page proposed-layout cases passed with zero movement. The command returned exit 1 because the baseline geometry failures are intentional reproductions, not a green suite claim.

| Speed | Committed canvas/timeline movement | Test-page proposed canvas/timeline movement |
| --- | --- | --- |
| 1x | 19.5 px / 19.5 px | 0 px / 0 px |
| 0.75x | 19.5 px / 19.5 px | 0 px / 0 px |
| 0.5x | 19.5 px / 19.5 px | 0 px / 0 px |

All evidence is retained under `var/play-pause-layout-comparison-2026-10-19/`. Representative 1x screenshots:

- [Committed Preparing layout](../var/play-pause-layout-comparison-2026-10-19/play-pause-baseline-ordina-00101-ed-1-baseline-status-layout/preparing.png)
- [Proposed test-page Preparing layout](../var/play-pause-layout-comparison-2026-10-19/play-pause-baseline-ordina-d4d7a-ed-1-proposed-status-layout/preparing.png)

Each case also retains before-play.png, resumed.png and play-pause-layout.json. Baseline failures additionally retain a Playwright trace.

## Reviewable proposal, not applied

`docs/avstudio-readiness-layout-proposal.patch` adds a class to the existing Preparing paragraph, makes the monitor its positioning container, and positions the label in the header. Role/status content and playback/audio logic remain unchanged. `git apply --check docs/avstudio-readiness-layout-proposal.patch` exits 0. This check does not apply the patch.

Read-only review found no confirmed blocker for the default layout; it identified that enlarged text/narrow-layout header overlap has not been tested. All production UI remains at the committed baseline. The earlier explicit prohibition on UI changes requires approval before applying this specific proposal.

No split work, backend/package/configuration/system-setting changes, commit, push, or deployment. Existing diagnostic/test files and earlier evidence are preserved.
