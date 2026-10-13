# AVStudio advanced timeline editing

Date: 2026-10-13  
Status: design specification for user review; implementation and planning are not authorized.

## 1. Intent, scope, and inspected baseline

Extend the local editing workspace with full-screen alternate takes on Video 2 and an editable background-music sequence. Video 1 remains the contiguous base sequence and determines final duration. Preserve the separate small PIP, image/logo, real FFmpeg job pipeline, existing editing tools, and H.264/AAC MP4 delivery.

This task creates only this specification. It does not change application code, tests, packages, configuration, existing documentation, or Git history. Stop after user review; an implementation plan requires separate approval.

Read-only inspection found a clean working tree at `849fd29` (`Add AVStudio undo and redo history`), following split/ripple-delete, trim/version-replacement, workspace, and multitrack-composition commits. No application tests or renders were run for this design; historical verification is evidence of prior work, not a fresh passing claim.

| Inspected location | Current architecture and implications |
| --- | --- |
| `frontend/src/App.tsx`, `EditingWorkspace.tsx`, `ProjectTimeline.tsx`, `Inspector.tsx` | App integrates history/resources and delivery; workspace owns selection and chooser state. Video 1 has reorder, trim, split, ripple delete, and a donor-consuming version replacement. The lane currently labeled Video 2 actually holds image/PIP slots. It must be renamed Overlay/PIP and a distinct replacement lane added. |
| `lib/clips.ts`, `timeline.ts`, `overlays.ts` | Video source trims and overlay schedules are inclusive; integer output frames use half-up rounding. Auto FPS resolves to the nearest supported FPS from the first Video 1 occurrence. Timing is unavailable if any base clip is unresolved. |
| `lib/editHistory.ts`, `historyProjection.ts`, `projectSources.ts`, `hooks/useEditHistory.ts` | Immutable metadata snapshots contain Video 1, PIP, four mix settings, and requested FPS. History retains 30 completed actions. Files/URLs and tokenized metadata callbacks live in a source registry; gestures have preview/commit/cancel boundaries. Source import, Video 1 speed, and PIP schedule changes currently use rebasing rather than individual history actions. Music source membership and image state are outside snapshots. |
| `BackgroundAudioTrack.tsx`, `lib/api.ts` | One music File/URL, duration, volume and mute; no editable segments. Multipart submission currently repeats a video file per Video 1 occurrence and uploads one optional music/image/PIP file. |
| `ProgramMonitor.tsx`, `hooks/useProjectPlayback.ts` | Browser preview is silent and approximate. Base source time follows source trim and speed. PIP has schedule and actual-EOF checks, reconciled after backward seeking or mapping changes. Structural changes pause and clamp transport. |
| `backend/app/main.py`, `jobs.py`, `timeline.py` | FastAPI parses edits and validates multipart/media before queueing. One in-process worker, generated confined job storage, existing errors/status/retention. No database. Source frame counts are authoritative; unsaved trims become full decoded ranges and stale saved ends are clamped when frames remain. |
| `backend/app/media.py`, `composition.py` | Normalize trimmed/speed-adjusted clips to 1280×720, constant FPS, H.264/yuv420p and 48 kHz stereo AAC; concatenate, then PIP, then image. PIP uses `eof_action=pass:repeatlast=0:shortest=0`. Music currently uses infinite input looping and final-duration truncation; original/music mixing has no automatic normalization. |
| `README.md`, `docs/verification.md`, `docs/execution-ledger.md`, existing specs/plans | Historical sequential-render, multitrack, editing-workspace, and edit-history documents describe prior contracts. The verification record predates the latest history work. Current code takes precedence where historical descriptions differ. |
| `frontend/src/**/*.test.*`, `frontend/e2e/avstudio.spec.ts`, `tests/backend`, `tests/integration/test_real_merge.py` | Existing unit/component, API/subprocess, real FFmpeg, and installed-Edge desktop/mobile coverage are the regression foundation. |

This specification supersedes the old lane naming and single-file music behavior for the new editor. Legacy requests retain their existing contract as defined below.

## 2. Architecture decision

| Approach | Trade-off | Decision |
| --- | --- | --- |
| Extend occurrence snapshots and compile a resolved video/audio timeline before FFmpeg | Adds explicit replacement and music metadata while reusing source ownership, history transactions, normalization, jobs, and overlays | Selected |
| Treat Video 2 as another FFmpeg overlay with audio muting expressions | Easy visual reuse, but confuses PIP/replacement semantics and separates picture priority from original-audio priority | Rejected |
| Replace the editor/render engine with a general multilayer compositor | Supports arbitrary tracks but introduces unrelated track/mixing/transition complexity | Rejected |

Use one committed edit snapshot, one pure timeline projection, and a backend-owned resolved render plan. The frontend projects approximate metadata; the backend recompiles against probed media. Neither keeps an independently editable flattened sequence. Replacement clips remain editable placements even when obscuring Video 1.

Logical flow:

```text
Source registry + committed snapshot
    -> Video 1 timing + Video 2 placements + music placements
    -> preview source resolver / timeline / inspector
    -> versioned manifest + current reachable uploads
    -> backend probe + validate + resolve priority intervals
    -> normalized picture/original-audio sequence
    -> PIP -> image/logo -> edited music mix -> MP4
```

Frontend boundaries extend `editHistory`, `projectSources`, `historyProjection`, and timeline helpers. Track-specific pure edit operations produce candidate snapshots; the controller validates and commits them. Timeline and inspector report intentions rather than mutate arrays. Backend parsing builds immutable plan descriptors in the existing jobs boundary; timeline planning owns frame math/priority intervals; media execution owns subprocesses; overlay composition keeps its current independent contract. These are responsibility boundaries, not an implementation task list.

## 3. Timing, tracks, and priority

Let F be resolved FPS (24, 25, 30, 50, or 60). Existing source trims remain zero-based inclusive `[s,e]`. A normalized video source edit contains:

`L = max(1, floor(((e-s+1) / sourceFPS / speed) * F + 0.5))`

Keep Video 1's existing split/source-frame calculations, including their current rounding, unchanged. Internally the new interval planner uses half-open project intervals `[a,b)`; an inspector displaying an inclusive last frame shows `b-1`. Existing overlay wire fields remain inclusive. Every conversion must be explicit.

Video 1's ordered lengths sum to N; final duration is N/F. Video 2 does not extend N. At each frame f in `[0,N)`, select the unique covering Video 2 placement if present, otherwise the Video 1 occurrence covering f. Apply overlays after this choice. The selected full-screen source also supplies original audio. Video 1 continues advancing under replacement and resumes at its corresponding project time, never at its earlier covered source position.

Five visible lanes, top to bottom: Overlay/PIP (one PIP and one image/logo slot), Video 2 — Replacement, Video 1 — Main sequence, Original audio (derived from the selected main/replacement intervals), Background music (editable segments). Original audio has global volume/mute and no independently draggable occurrences. Layer labels, inspector names, and upload targets must distinguish replacement from PIP.

### Examples and workflows

At F=25 and N=150, place a 60-frame replacement at frame 40:

| Project interval | Picture and original audio |
| --- | --- |
| `[0,40)` (inclusive 0–39) | Video 1 |
| `[40,100)` (inclusive 40–99) | Video 2 take A |
| `[100,150)` (inclusive 100–149) | Video 1 resumes |

This is the unambiguous interpretation of “Video 1 frames 0–40; Video 2 frames 40–100”: frame 40 belongs to Video 2. A second replacement at `[110,130)` is valid; `[90,120)` collides with take A and is rejected. Adjacent replacements `[40,100)` and `[100,120)` are valid. A replacement can cross any number of Video 1 boundaries.

User workflow: add base media; choose **Add replacement video** or drop one video on Video 2; choose timeline start and, if needed, source range in the candidate dialog; save a ready non-overlapping placement; trim/split/move/delete it; inspect the full-screen preview; render the resulting sequence. Default placement is at the playhead with full source range, but an overlong candidate remains a draft requiring explicit trim; never shorten a dropped replacement silently.

The existing **Replace version after playhead** action remains a Video 1 operation: it consumes a ready Video 1 donor, changes the target's remaining source range, and preserves its existing behavior/history. Rename its chooser text to identify the donor operation if needed. Adding a Video 2 replacement never consumes or removes a base occurrence.

For music, add one song at frame 0 or a chosen start. At F=25, a song placement `[25,225)` starts at one second. Split at frame 75, then split the right half at 100. Delete `[75,100)` using Ripple Delete. The remaining placements become `[25,75)` and `[75,200)`; the second reads the source audio originally starting at frame 100 of project time. Only music moves. Undo restores the middle section and exact later placement; Redo repeats the edit.

PIP at `[10,50)` with only 10 output frames of source content is visible at 10–19 and absent from frame 20 onward, regardless of which replacement/base supplies the underlying picture. No PIP audio enters the mix.

## 4. Metadata model and manifest

Snapshots contain metadata and stable occurrence/source IDs, never Files, binary copies, URLs, media elements, jobs, transport, or selection.

| Snapshot field | Contract |
| --- | --- |
| `video1[]` | Existing ordered `{id, sourceId, trim, trimSaved, speed}` occurrences; preserve existing import/rebase semantics |
| `video2[]` | `{id, sourceId, trim, trimSaved, speed, timelineStartFrame, contentInFrame, contentOutFrame, contentFullSource}`; content window is half-open in the normalized trimmed/speed-adjusted source edit at F; the boolean distinguishes an initialized full window from explicit output-window edits |
| `musicSourceId` | Nullable reference to the single current song; membership is now historical |
| `music[]` | `{id, sourceId, timelineStartFrame, sourceStartSample, durationFrames}`; every sourceId equals musicSourceId; sample offsets refer to decoded audio normalized to 48 kHz stereo |
| `pip`, `audio`, `fpsSelection` | Existing PIP descriptor, mix settings, and requested FPS; image/logo remains externally owned with existing behavior |

A replacement's length is `contentOutFrame-contentInFrame`; its end is start+length. Require `0 <= contentInFrame < contentOutFrame <= L`. Full-source addition initializes `[0,L)` and contentFullSource=true. A normalized content window lets split and edge trim preserve exact output-frame boundaries at mixed FPS and slow speeds, without rounding each split half independently. Edge edits and splits set contentFullSource=false even if a resulting endpoint coincides with EOF. Source-trim Save resets the normalized window to `[0,newL)` and contentFullSource=true at its existing timeline start and validates the new placement. Speed changes on Video 2 convert explicit normalized endpoints by half-up rounding endpoint*oldSpeed/newSpeed; a full window instead becomes `[0,newL)`. Reject empty or invalid results. Both source trim and Video 2 speed changes are undoable.

For music, define K=48000/F, an integer for every supported F. Placement output length is durationFrames*K samples. Full-song addition has sourceStartSample=0 and durationFrames=ceil(decodedSampleCount/K); the last partial project frame is zero-padded. Store source sample offsets independently of source codec sample rate; resample before interpreting them. Require nonnegative integer offset, positive integer duration, and sourceStartSample strictly before decoded EOF. Selected length may exceed remaining source samples by fewer than K samples only, accounting for the final partial frame; longer exhaustion is invalid. Music edge edits and splits follow this grid and retain the actual source offset; they do not manufacture repeated content.

### Version 2 wire contract

Add `schema_version: 2` to the JSON manifest on the existing POST `/api/merge`. Use this shape (all project/content windows below are half-open; source start_frame/end_frame in both video arrays and legacy overlay schedules remain inclusive):

```json
{
  "schema_version": 2,
  "output_fps": 25,
  "video_sources": [{"source_id": "base-source"}, {"source_id": "take-source"}],
  "order": ["base-occurrence"],
  "clips": [
    {"client_id": "base-occurrence", "source_id": "base-source", "start_frame": 0, "end_frame": 149, "speed": 1, "trim_saved": true}
  ],
  "video2": [
    {"client_id": "take-occurrence", "source_id": "take-source", "start_frame": 0, "end_frame": 59, "speed": 1, "trim_saved": true, "timeline_start_frame": 40, "content_in_frame": 0, "content_out_frame": 60, "content_full_source": false}
  ],
  "music": {
    "source_id": "song-source",
    "segments": [
      {"client_id": "song-part", "source_id": "song-source", "timeline_start_frame": 25, "source_start_sample": 0, "duration_frames": 200}
    ]
  },
  "overlays": {"image": null, "video": null},
  "audio": {"original_volume": 1, "original_muted": false, "music_volume": 0.3, "music_muted": false}
}
```

The example assumes a 150-frame base, a 60-frame take, and a song containing 384000 decoded samples. Music can continue past N; export intersects it with `[0,N)`.

Repeated `files` parts correspond exactly to `video_sources` order, one upload per unique referenced main/replacement source. `clips` describes Video 1 occurrences; `order` contains every Video 1 client ID exactly once. Video 2 array order is immaterial; normalize it by timeline start, with stable ID as a deterministic secondary key. IDs are nonempty strings, source catalog IDs are unique, and occurrence IDs are unique across main, replacement, and music arrays. Source IDs and occurrence IDs are separate namespaces. Reject missing, extra/unreferenced catalog entries and references to the wrong media type. The same source may supply multiple occurrences on either video lane.

Keep singular `background_audio`, `overlay_video`, and `overlay_image` multipart fields. `music: null` requires no background_audio; a nonnull music object requires exactly one background_audio and at least one segment. Deleting the last segment sets musicSourceId to null and music to empty together, releasing current placement ownership while history retains the source. Add/replace song atomically resets its segments to one full-song placement at the selected start; replacement requires an explicit labeled Replace song action. Only one song source is active in this milestone. No upload occurs until render.

Reject unknown schema versions. Absence of schema_version or version 1 uses the existing parser and existing one-file-per-occurrence contract, including short-music looping, original audio, and overlays. Version 2 has no implicit music loop. An empty Video 2 and null music still render one/multiple base clips. Keep endpoint/job/status/download/error envelopes unchanged. No project persistence or save/load migration is introduced.

## 5. Interaction and edit rules

### Placement, trim, split, and ripple

Video 1 remains contiguous with current reorder/move buttons and drag/drop. Video 2 and music are independently positioned, sorted non-overlapping lanes; moving changes start time, not array ordering semantics. Pointer movement snaps to integer project frames. Drag-over previews a ghost only; one valid changed drop commits once. Selection is track plus stable occurrence ID. Clicking selects and seeks to its start when within video duration; selecting a music tail past N leaves the preview playhead at N-1 and shows its real start in the inspector.

Left-edge replacement trim by delta changes timeline start and contentIn by delta, keeping timeline end fixed. Right-edge trim changes contentOut and timeline end, keeping start fixed. Extensions are allowed only within the normalized source window, the project, and adjacent clip boundaries. Music left trim by delta changes timeline start, sourceStartSample by delta*K, and durationFrames by -delta; right trim changes duration only. Maintain at least one output frame, no negative source/timeline offsets, no overlaps, and the EOF rule above. Invalid gestures can show an invalid ghost; release rolls back rather than silently shifting neighbors. Numeric inspector Save uses identical validation.

For replacement/music split at project frame p, require start<p<end. Replacement left window is `[contentIn,contentIn+p-start)` and right window begins there; right placement starts at p. Music left duration is p-start, right source offset increases by `(p-start)*K`, and right duration is the remainder. Preserve source, speed, and source trim. Create two distinct occurrence IDs once; Redo reuses them. A one-frame item cannot split. Existing Video 1 split eligibility and calculations remain unchanged.

Default Delete/Backspace and the visible **Ripple Delete** action remove the selected occurrence. For Video 2/music, subtract the removed duration from every later occurrence's start on that same lane; leave preceding items and preexisting gaps unchanged. This closes the removed span, not every unrelated gap. Video 2 deletion reveals Video 1; it never shortens the video. Music deletion never shifts either video lane or overlays. No non-ripple delete mode is added. Video 1 deletion continues to close the base sequence and reduces N.

Video 1 reorder, trim, speed, split, version replacement, and deletion do not automatically move Video 2, music, or overlay schedules: placements use absolute project positions. If N shrinks, an out-of-range replacement or overlay remains visible as invalid and blocks render until corrected or removed. Do not silently cut/delete it. Music tails remain valid and truncate only during export. Empty Video 1 disables playback/render and timed placement creation, but leaves existing resources and deletable placements available; Undo can restore the base.

An FPS change converts Video 2 timeline start and explicit normalized window endpoints by half-up rounding oldFrame*newF/oldF; a contentFullSource window instead becomes `[0,newL)`. Music start and duration convert the same way; sourceStartSample stays unchanged. Recompute permissible normalized/source lengths from metadata; expand only the final partial music frame as specified. Video 1 retains its source trims and existing per-occurrence rounding; existing PIP/image frame numbers keep their current absolute-frame behavior. If quantization creates an empty replacement/music window, EOF violation, or lane overlap, reject the FPS change atomically with an explanation. A non-overlapping replacement becoming out of project bounds may remain invalid like an overlay. Show the resolved new FPS and timing impact; history restores all converted fields together.

Auto FPS changes caused by a different first base clip use this same conversion path. If that would cause overlap/empty windows, reject the initiating base edit/import before changing sources or history. For a nonhistorical import, apply the conversion independently to each rebased snapshot using its prior/new resolved F; preflight every retained snapshot and reject the import atomically if any conversion violates structural invariants. When resolution is unavailable (such as an empty base), retain the last resolved FPS as nonhistorical session context for positioned fields; use the first new resolved FPS to convert them when the base becomes ready. Never assume an arbitrary default FPS for existing placements. A Video 1 speed change that changes only N retains the current nonhistorical rebase behavior. Reordering with unchanged F retains absolute placement frames.

The timeline ruler covers max(N, music ends, invalid replacement ends, overlay ends), without altering export duration. Mark N with an export-end line and shade tails. Transport remains constrained to `[0,N-1]`; numeric music trim/start controls can edit tails beyond N. No sample waveforms or invented metadata; actual segment rectangles and source names are sufficient.

### Candidate ingestion and invalid drops

Video 2 accepts one supported video per file drop; PIP accepts its existing one-video candidate; music accepts one MP3/WAV/AAC/M4A. Multiple files on these targets, wrong types, empty/oversized files, unknown internal drag tokens, cross-track occurrence drops, negative starts, and overlap are rejected with a target-specific message. Prevent browser navigation for file drops anywhere in the workspace. Base upload continues to support its existing multi-file selection. Do not interpret a replacement drop as PIP or move a base occurrence between tracks implicitly.

Stage candidate File, source token, target start and source-range draft outside snapshots. Keep the old committed song/PIP or replacement lane unchanged during probing. Commit addition/replacement only when ready, still editable, and valid against the current snapshot. If the project changes during probing, revalidate rather than overwrite its newer edits. Failed/superseded/cancelled candidates create no history entry. Undo/Redo, New project, target removal, or entering delivery lock cancels pending placement intent; session/source/request tokens prevent late re-addition. Browser decode failures explain that timing is unavailable; there is no fabricated duration fallback for these new editable placements.

## 6. History and resource compatibility

Extend snapshot copying, equality, projection, restoration, and source reachability to Video 2 and musicSourceId/music segments. Generalize video-source capability so a source registered for main or replacement can safely be reused by either; PIP/image/music retain their media capabilities. Source metadata is still external and shared. For music metadata retain estimated browser duration/sample count and authoritative backend sample count only when obtained; a callback never changes occurrence topology or writes an explicit edit.

Add completed-action history labels for replacement add/source replace/move/source trim/edge trim/speed/split/ripple delete and music add/song replace/move/trim/split/ripple delete/remove. Existing mix, FPS, PIP, and Video 1 actions remain. New replacement speed actions are historical; existing Video 1 speed remains rebased as before. Do not broaden unrelated image/PIP-schedule history behavior.

Each accepted operation stores one immutable before/after snapshot. Drag/trim/volume keyboard or pointer sessions begin once, preview freely, and commit once at release/key-up/blur as appropriate. Escape, pointer cancel, unexpected capture loss, vanished target, and editing lock roll back. No-op or invalid candidates neither add entries nor clear Redo. Successful user edits clear Redo. Keep the existing 30-entry bound, immutable IDs, no binary duplication, and restore validation before stack movement.

Preserve the distinction between structural invariants and render readiness. Restoration requires valid references/types/unique IDs, permissible source windows, no lane overlaps, and supported settings; it may restore an out-of-project replacement or overlay schedule, which remains visibly invalid and blocks render. A missing source, incompatible metadata, or capacity failure leaves both project and stacks unchanged and reports a recoverable error. Source readiness rebases unset defaults only and neither records history nor clears Redo. Video 1 imports remain nonhistorical baseline changes; conversion/rebase must preserve older entries rather than retroactively invent an edit.

Collect source owners from present, past/future before/after snapshots, gesture preview, pending candidates, and external image/legacy owners. Keep original File references for the session. A removed/replaced song reachable through history must restore without reupload, reprobe, or a revoked URL string. Recreate runtime URLs from retained Files if necessary. Shared sources survive deletion of one split half. Eviction and Redo clearing release unreachable URLs; New project/unmount clears stacks, candidates, sources, URLs, tokens, and transactions. Snapshot budgets bound metadata, not source bytes; preserve existing session-retention scope without adding a cache system.

Selection, chooser drafts, focus, playhead, playback, network errors, render jobs/results, and downloads stay outside history. Structural changes pause and clamp playback; pure volume/mute history does not reset transport. Clear invalid selection; after split select the right half; after removal focus its lane action or next available item. History restoration does not restore old selection or playhead. Render is disabled during drafts/gestures and submits only committed current sources/edits. Existing upload/processing/completed lock and New project behavior remain.

## 7. Backend validation and resource bounds

Parse integers strictly (reject booleans, fractions, negatives where forbidden), finite volumes in `[0,1]`, real booleans, allowed speeds, FPS, overlay positions/sizes, source identities, exact multipart matches, and array/object types. Schema version 2 rejects unknown editing fields rather than ignoring misspelled placement data. Existing legacy validation is preserved.

Use existing configured max_clips as both total Video 1+Video 2 occurrence limit and unique main/replacement upload limit. At least one Video 1 occurrence is required. Split checks capacity before committing. PIP/image remain their existing separate single slots and limits. Music supports at most `10 * max_clips` segments to bound graph/manifest growth; advertise this derived limit through the existing health limits response, with no new configuration setting. Keep existing video/music/image size limits, request-body size protection, queue, timeout, and storage rules. Update version-2 multipart count accounting within those existing bounds; do not bypass parser/body limits to accommodate new fields.

Probe every referenced source once during validation, checking usable video dimensions/FPS/decoded frame count or usable first audio stream and normalized decoded sample count. Normalize saved/unsaved video source trims with the existing authoritative clamp policy before computing L and N. Serialize the mandatory `content_full_source: true` only when the candidate uses the full normalized source-edit window and has no explicit edge/split edit; the parser resolves that window to authoritative `[0,L)`, independently of whether the source trim itself is saved. In all other cases serialize false and preserve explicit content endpoints. Invalid explicit windows are rejected, not clamped. Placement ranges are rechecked after authoritative lengths; media corrections cannot silently move or overlap replacements.

For music, decoded EOF can shorten a browser-estimated last partial frame within the less-than-K padding allowance. Larger source-window exhaustion is a 422 error requiring re-trim; never loop or fill arbitrarily long missing music. Music beyond N is valid even if completely outside export; validate its source selection but exclude its inaudible portion from execution. Main/replacement gaps in original audio are filled with silence, not another take's audio.

Reject replacement overlaps after sorting (`previousEnd > nextStart`), negative positions, zero lengths, replacement end>N, and invalid source windows before queueing. Never trust browser total duration or a submitted flattened priority plan. Build the authoritative partition from 0, N, base boundaries, and replacement boundaries. Each consecutive interval has exactly one selected source and a normalized source offset. Merge adjacent intervals only when source occurrence and source offsets are continuous. Image/PIP ranges use current inclusive checks against N.

Use existing 422 structured validation responses with occurrence/track-specific safe messages; 413 for size, 415 for unsupported source, 503 for missing tools/full queue. Preserve cleanup on failed upload/validation. Source IDs never become paths. Generated storage names, subprocess argument lists, protocol/format restrictions, timeouts, and diagnostic-only logs remain. Execution errors mark jobs failed and never publish a partial result.

## 8. Exact FFmpeg composition contract

The backend resolves frames and audio together; it must never concatenate Video 2 onto the end or shrink it into a PIP box. These are normative composition requirements, not commands to run during specification writing.

1. Normalize each referenced video source edit using current inclusive source `trim` converted to FFmpeg's exclusive end, timestamp reset, speed `setpts`, aspect-ratio correction, fit/pad to 1280×720, F FPS, yuv420p and square pixels. Normalize its first original audio stream using matching source-time bounds, reset timestamps, `atempo` speed, 48 kHz stereo, and silence padding to L*K samples. An absent audio stream creates silence. Do not apply global volume at this stage. Retain normalized audio as PCM in generated intermediate storage until final encode so cuts do not repeatedly introduce AAC priming.
2. Establish exactly L normalized video frames. Existing base CFR resampling may repeat source frames for slow motion/FPS conversion; that remains valid. Do not use source-loop/EOF clone filters to extend a Video 2 window beyond its probed normalized content. Decode/probe normalized intermediates and fail if a requested window is unavailable rather than fall back to hidden Video 1.
3. For each resolved `[a,b)` interval select frames `[u,u+b-a)` from the chosen normalized video occurrence. For base, u is a minus that base's start; for replacement, u is contentIn plus a minus replacement start. `trim=start_frame=u:end_frame=u+b-a,setpts=PTS-STARTPTS` creates its video slice. Slice PCM using `atrim=start_sample=u*K:end_sample=(u+b-a)*K,asetpts=PTS-STARTPTS`. Join these slices in project order using zero-based paired video/audio concat inputs. The picture count is N and original PCM length is N*K. No output-frame split recomputation from source trims is allowed for replacements.
4. Composite existing PIP, then image/logo above that full-screen sequence. PIP keeps its schedule, size, position and source start behavior, with `eof_action=pass:repeatlast=0:shortest=0`; no looping, cloning, `tpad`, or frozen EOF frame. The image remains a scheduled still. Ignore PIP audio. Overlay processing must not shorten picture or change resolved original audio.
5. Decode the current music file's first stream to continuous zero-based 48 kHz stereo PCM once. For each music segment, extract `[sourceStartSample, sourceStartSample+durationFrames*K)` with sample-based `atrim` and timestamp reset; pad only its permitted final partial frame. Place it at timelineStartFrame*K samples using sample-suffixed `adelay` on both channels. Intersect placement with `[0,N*K)` for export; segments starting at/after N are excluded. Deleted source ranges must never be played, including when the edited song is shorter than N.
6. Produce a full-length silent PCM bed of N*K samples and combine placed music segments with `amix:duration=first:dropout_transition=0:normalize=0`. Trim exactly to N*K. This yields silence before, between, and after segments. No version-2 `-stream_loop`; no fallback to the unedited song. Even without any active music segments, the selected original-audio lane remains full length.
7. Apply global original gain (zero if muted) once to resolved original PCM, and global music gain (zero if muted) once to the music lane. Mix the two full-length lanes with the existing unnormalized additive policy, trim to N*K, and encode AAC once at 192k, 48 kHz stereo. Original gain controls both Video 1 and Video 2; a silent replacement remains silent even if hidden Video 1 has sound. Both muted yields a silent AAC track. Preserve existing possible clipping at high combined gains; no limiter, ducking, loudness processing, or fades is added.
8. Deliver exactly N constant-FPS picture frames as H.264 (`libx264`, current medium/CRF 23), 1280×720 SDR yuv420p with AAC in MP4, `+faststart`. Preserve explicit frame count and N/F duration caps. Do not rely on `-shortest` to determine duration from music/PIP. Container/audio encoder padding may differ from ideal decoded duration by codec granularity; decoded audible content ends at the specified PCM boundary. Preserve rendered playback/download and retention behavior.

Filter semantics for sample cuts and delays are grounded in the official [FFmpeg atrim documentation](https://ffmpeg.org/ffmpeg-filters.html#atrim) and [adelay documentation](https://ffmpeg.org/ffmpeg-filters.html#adelay): trimming does not reset timestamps, and a sample-suffixed delay supports exact sample placement. The priority partition, normalized content windows, silent bed, and selected-audio policy above are AVStudio design decisions. Compatibility is to be verified against the existing installed FFmpeg during implementation; no package or tool installation is part of this milestone.

## 9. Preview, errors, and accessibility

ProgramMonitor uses the same priority intervals as the timeline. Replacement source time is source trim start/sourceFPS plus `(contentIn + frame-timelineStart)/F * speed`. Base source time follows its current mapping. Pause old media on source changes and seek the newly selected source; keep PIP independent and images above it. Retain the truthful silent/approximate preview notice; audio audition and frame-exact browser playback are outside scope. Replacement browser EOF/decode failure displays a source-specific preview error; it must not freeze the last take frame or imply a successful replacement. Final render remains authoritative and either supplies its validated range or fails.

Display invalid placements with text/icon as well as color, a linked inspector repair action, and a clear render-disabled explanation. Errors on a candidate preserve the prior project. A failed render permits existing retry/edit behavior; success retains the existing completed-project lock. Never change timeline metadata from job polling. Long filenames/errors must wrap and remain reachable on narrow screens.

All edits have keyboard alternatives: labeled Add/Replace buttons, numeric start/source-range fields, move-earlier/later-by-one-frame buttons for positioned clips, existing Video 1 reorder buttons, Trim editor, Split at playhead button, and Ripple Delete. Enter/Space activates focused buttons; native inputs retain Arrow/Home/End behavior. Numeric Save groups all fields into one action; Escape cancels dialogs/gestures and returns focus to the invoking control. Split/Delete shortcuts use the existing workspace eligibility guard: selected applicable item, editable project, no text/control editing, dialog, IME composition, conflicting modifier, or active gesture. A new letter shortcut is unnecessary.

Preserve Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z and visible Undo/Redo; do not intercept input/textarea/select/contenteditable/dialog editing, repeated keys, or composition. Do not add a global keyboard handler that steals native media or ruler controls. Delete/Backspace applies only to selected timeline occurrences, never the derived original-audio lane or an unselected song source. Disabled actions use native disabled states and visible reasons.

Each interval has a track-qualified accessible name including source, timeline range, and selection state. Provide list/inspector selection for one-frame items without enlarging their physical timeline width. Keep focus rings, sufficient text/control contrast, 44px primary action targets, reduced-motion handling, inspector disclosure, desktop/mobile DOM order, and horizontally scrollable timeline behavior. Announce accepted edits, invalid drops, and Undo/Redo through a polite status region; do not announce every pointer movement/playback frame. Screen-reader listening and native zoom checks remain explicit manual acceptance work.

## 10. Test strategy and acceptance

Implementation must extend existing suites with meaningful boundary and observable-media assertions. This document does not run them or claim their outcomes.

| Layer | Required evidence |
| --- | --- |
| Unit — frontend/backend timeline | Identical half-up math; supported FPS/K; source inclusive/output half-open conversion; priority at replacement start/end/adjacency; crossing base boundaries; multiple replacements; normalized-window splits at mixed FPS/slow speeds preserve exact frames; trim extension/collision; ripple shifts only later same-lane items; music source offsets and final partial frame; FPS conversion and rejection; absolute anchoring after base edits; Auto changes; empty base; legacy versus version-2 serialization |
| Unit — history/resources | Exact snapshot round trips for every new operation; stable split IDs; 30-entry eviction; no-op/invalid drops preserve Redo; cancelled gestures; missing-source restore is atomic; imported base rebasing; invalid-but-restorable schedules; source sharing across lanes/split halves; song add/replace/delete Undo retains Files; URL recreation and ownership; stale probe/session callbacks; no binary copies; delivery locks |
| Component/app integration | Separate replacement/PIP upload targets; candidate success/failure/supersession; invalid/drop-outside navigation prevention; collision ghost rollback; pointer/keyboard transaction boundaries; trim and split selection; music middle deletion and Undo/Redo; original-audio priority projection; silent preview switches and EOF; editing tails via inspector; submit after Undo/Redo reflects committed segments/uploads only; errors/retry/New project |
| Backend API/subprocess integration | Version-1 unchanged payloads; version-2 multipart catalog identity/dedup/exact matching; unknown version/fields; forged overlaps/source ranges; authoritative shorter video/song metadata; limits and split capacities; malformed types/booleans/NaN; no queue on 422; confined names and cleanup; planned slice/mix graph uses exact frame/sample offsets, ignores PIP audio, and contains no version-2 music loop |
| Real FFmpeg/FFprobe | Generate deterministic colored/frame-numbered base and replacement clips with distinct audio tones. Inspect decoded frames at 39/40/99/100 for the 25-FPS example, plus gaps, adjacent takes, base-crossing and final frame. Confirm no hidden-base audio inside replacement, silence for silent/short-audio replacement, and matching source resume. Verify mixed FPS/aspect/slow speed; replacement split equivalence; one-frame placement; exact N frames and output profile. Generate music with distinct timed tones and impulses; assert deleted section's tone is absent, later section shifts, source/timeline impulse positions match, gaps/short-song tail are silent, and long music ends at N. Decode PCM to inspect content while allowing AAC priming/lossy ringing near hard boundaries; inspect inside intervals and use lossless intermediate sample-count assertions for exactness. |
| Real render regressions | Keep one-clip/multi-clip MP4, all accepted video input formats, trim/clamp, slow motion, base split/ripple/version replacement/reorder, original/music gains and mutes, image transparency/z-order, and PIP source EOF/schedule end/backward preview seek. Legacy short music still loops. Check AAC/H.264/FPS/resolution, streaming ranges/download, failures and cleanup. Integration opt-in must execute actual FFmpeg tests during milestone acceptance, not silently skip them. |
| Browser E2E | Use existing installed Edge/Playwright setup without installing packages/browsers. On desktop and narrow mobile, add base, place/trim/move/split two replacements, reject collision, add PIP, split/delete music middle, Undo/Redo, render/download actual MP4, and inspect downloaded media through FFprobe. Verify timeline/preview start/end switch, EOF absence, locks, keyboard-only equivalents, focus/error accessibility, long names, zoom-equivalent layout, tiny clips, and New project. Preserve existing E2E flows and native screen-reader/zoom manual checks. |

Acceptance requires the new editor render to reflect the exact edited replacements and music segments; zero overlapping Video 2 clips; no frozen PIP; silent music gaps/tails; selected original audio only; all existing working render/edit behaviors retained; passing relevant existing/new unit, integration, real FFmpeg and browser checks with skipped/unsupported platform coverage explicitly reported. No subjective visual preview claim substitutes for decoded-output assertions.

## 11. Explicit exclusions and review outcome

Out of scope: MOV export (MOV remains an input), transitions/crossfades, database/authentication, deployment/infrastructure/configuration changes, collaboration, package/lockfile changes or installation, commits/pushes, arbitrary extra tracks, overlapping replacement/music clips, multiple active songs, music looping controls, original-audio detachment, audio preview engine, fades/ducking/limiting, waveform extraction, project persistence, and unrelated history/refactoring changes. Final export stays H.264/AAC MP4.

Self-review checked requirement coverage, endpoint/version compatibility, source versus project timing, boundary ownership, EOF/silent replacement policy, music ripple and gaps, cross-track anchoring, Auto/FPS conversion, source/resource/history lifecycle, pending callbacks, invalid restoration/drop behavior, limits, accessibility, and test observability. Design choices are explicit rather than deferred. No open placeholders or implementation task sequence is included. The main bounded changes are a versioned manifest, replacement priority planner, historical editable music placements, and extensions of existing projection/history/render boundaries. User approval of this written specification is required before an implementation plan or application changes.
