# ReelWeave verification record

Milestone 3 verification refreshed locally on Windows on 2026-10-04. Work continued in the existing
project; no repository was recreated, and no system configuration, global
dependencies, commits, pushes or deployments were performed.

## Completed application

- React/TypeScript/Vite interface with local multi-file selection, drag/drop,
  validation, metadata, accessible order controls and removal.
- Inclusive frame trim editor with timeline handles, exact frame/timestamp
  readouts, one-frame stepping, and per-clip 1x/0.75x/0.5x speed.
- Separate background-audio track with upload validation, duration display,
  volume/mute controls, short-track looping, long-track trimming, and mixing.
- One image/logo and one video/PIP overlay on Video 2, with inclusive project-frame
  ranges, five positions, three sizes, browser preview, and real FFmpeg composition.
- Short PIP sources become transparent at EOF; the final frame is never frozen.
- FastAPI health, ordered upload, job status, video, download and deletion routes.
- Bounded single-worker queue with queued/processing/completed/failed states.
- Generated paths, job-specific storage, configurable limits and retention cleanup.
- FFprobe validation and FFmpeg normalization for differing codecs, aspect ratios,
  frame rates and missing audio, with a final H.264/AAC MP4 at constant 30 fps.
- Status retry, understandable errors, preview/download/reset, environment examples,
  local setup documentation and the requested future DevOps roadmap.

## Commands and results

Commands were run from the project root unless marked frontend. Development
dependencies were installed only into `.venv` and `frontend/node_modules`.

| Check | Command | Result |
|---|---|---|
| FFmpeg / FFprobe | `ffmpeg -version`, `ffprobe -version` | Available; FFmpeg 8.1.2 |
| Python dependency consistency | `.venv/Scripts/python.exe -m pip check` | No broken requirements |
| Backend unit suite | `.venv/Scripts/python.exe -m pytest tests/backend -q` | Must pass |
| Real FFmpeg integration | Set `RUN_FFMPEG_TESTS=1`, then `.venv/Scripts/python.exe -m pytest tests/integration/test_real_merge.py -v` | Must pass when FFmpeg/FFprobe are available; otherwise this opt-in suite may skip |
| Python lint | `.venv/Scripts/python.exe -m ruff check backend tests` | Passed |
| Python format | `.venv/Scripts/python.exe -m ruff format --check backend tests` | Passed |
| Frontend tests | `npm.cmd test` (frontend) | Must pass; jsdom media-method notices are expected |
| Frontend lint | `npm.cmd run lint` (frontend) | Passed |
| Frontend format | `npm.cmd run format:check` (frontend) | Passed |
| TypeScript compile | `node_modules/.bin/tsc.cmd -b` (frontend) | Passed |
| Production bundle | `npm.cmd run build` (frontend) | Must pass and emit assets to `frontend/dist` |
| Browser integration | `npm.cmd run test:e2e` (frontend) | 1 passed in 52.8 seconds using installed Edge |

Additional setup/fix commands included `python -m venv .venv`, project-local pip
installation from `backend/requirements-dev.txt`, `npm.cmd install` in frontend,
installation of the local Playwright development dependency, Ruff import fixes,
`ruff format`, and `npm.cmd run format`. No browser was installed; the browser test
uses the existing Edge installation. Sandbox restrictions required elevated tool
execution for npm network access and Vite/browser checks, without changing settings.

## What the real tests verify

The Python integration tests create short MOV, WebM, MKV and MP4 fixtures with
different codecs, frame rates, dimensions and audio presence. It merges through
the API, inspects the downloaded output with FFprobe, decodes frames to verify
clip order and portrait padding, and checks decoded audio for a preserved tone
and inserted silence. It also verifies byte-range video responses, download
headers, deletion and pre-queue rejection for corrupt video.

They also verify an inclusive one-frame trim, multi-frame 0.5x and 0.75x clips,
original audio processing, a short background track looped to the final video
length, and a long background track trimmed at the final-video end.

The Milestone 3 overlay case additionally generates a short PIP with a distinct
audio tone and a transparent PNG marker. It verifies exact project-frame output,
scheduled boundaries, transparent pixels, image-over-PIP stacking, base-video
restoration when the PIP reaches EOF before its scheduled end, MP4 codecs, and
that PIP audio is not mixed into Audio 1 or Audio 2.

The Edge test runs the local frontend and backend, verifies frame ranges for real
30 fps and 24 fps clips, steps and saves a frame trim, changes speed, uploads
background audio, configures both Video 2 overlay types, rejects an invalid
inclusive overlay range, inspects multipart overlay fields, changes volume/mute
settings, reorders clips, checks mobile overflow and clip-control geometry,
merges, plays, downloads and resets. Screenshots are in
`docs/screenshots/`.

Integration failures were fixed rather than skipped: unsupported FFprobe
`-nostdin`, missing MP4 permission in the generated concat allowlist, variable
frame timing after stream copying, and excessive duration from padded AAC audio.
Frontend review also led to persistent missing-tool guidance and URL-lifecycle
regression coverage.

## Limits of verification

- Tested on Windows with Edge desktop and mobile viewport emulation; actual mobile
  devices, Firefox, Safari, Linux and macOS were not exercised.
- The real media fixtures are short. Large-file throughput, long-video performance
  and sustained concurrent-load behavior were not benchmarked.
- The installed Starlette test client emits deprecation warnings for its `httpx`
  integration and an AnyIO alias. Tests still pass; warnings were not suppressed.
- A focused independent frontend review and re-review completed. The final broad
  helper review hit an account usage limit; final backend inspection and verification
  were completed in the primary session instead.
- No deployment, cloud, CI/CD or infrastructure validation was performed; those
  remain future roadmap work.

See the root README for exact setup, startup, environment and test commands.
