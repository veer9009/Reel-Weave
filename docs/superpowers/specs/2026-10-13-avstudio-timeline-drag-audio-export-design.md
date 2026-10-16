# AVStudio timeline drag, detached audio, and export design

Date: 2026-10-13

Status: Proposed; specification only, awaiting approval

Baseline: `4ccc471d93e39b5ff9112784c114fbfc16256960`

## 1. Scope and baseline evidence

This milestone adds precise media placement, Video 1 overwrite editing, independent original/replacement audio, reliable playback through timeline edits, MOV delivery, and final-mix WAV/MP3 delivery. It extends the existing editor and real FFmpeg pipeline. It does not implement a new editor engine.

The preceding [advanced timeline specification](2026-10-13-avstudio-advanced-timeline-editing-design.md) remains the foundation. This document explicitly supersedes its exclusions of MOV export, detached audio, and audible browser preview, and its rule that all structural edits pause transport. Its Video 2 priority, independent Overlay/PIP, frame/FPS conventions, music EOF behavior, resource history, and MP4 requirements remain applicable except where this document describes an explicit extension.

The working tree was clean and HEAD matched the baseline before inspection. The following existing implementation and tests informed this design:

- `frontend/src/lib/timeline.ts`, `advancedTimeline.ts`, `positionedEdits.ts`, and `advancedManifest.ts`: contiguous Video 1 occurrences, positioned Video 2/music windows, source mapping, and Version 2 manifest construction.
- `frontend/src/lib/editHistory.ts`, `projectSources.ts`, `historyProjection.ts`, and `hooks/useEditHistory.ts`: metadata snapshots, source tokens and object URLs, transactional restoration, FPS conversion, and bounded history.
- `frontend/src/components/ClipList.tsx`, `PositionedTrack.tsx`, `EditingWorkspace.tsx`, `ProgramMonitor.tsx`, `JobResult.tsx`, `hooks/useProjectPlayback.ts`, `hooks/useHistoryShortcuts.ts`, `lib/api.ts`, and `App.tsx`: imports, existing gestures, tool actions, silent source preview, transport, and job/download flow.
- Backend `app/manifests.py`, `render_plan.py`, `advanced_media.py`, `audio_composition.py`, `media.py`, `jobs.py`, `main.py`, `storage.py`, and `config.py`: manifest validation, authoritative probing, priority partitioning, PCM composition, bounded jobs, downloads, and confined storage.
- Frontend split, positioned-edit, history, playback, monitor, advanced App, and browser tests; backend manifest, render-plan, audio-composition, API, and real-FFmpeg advanced-timeline tests. Existing tests explicitly expect structural edits to pause and preserve the legacy inclusive-source split algorithm. Only the former expectation changes generally in this milestone.

The installed FFmpeg reports support for the MOV muxer and `libmp3lame` encoder. This was a read-only capability check, not an export or application test. This design review did not run the application or reproduce the playback defect. No application code, configuration, package files, or tests were modified to prepare this specification.

## 2. Timeline and media workflows

### Tracks and reusable media

Keep Timeline Tools outside the clip lanes. The sequence displays Overlay/PIP, Video 2, Video 1, Original/Replacement Audio, and Background Music as distinct lanes. Existing small positioned PIP stays independent of Video 2; its source audio is excluded from the project mix.

Introduce a reusable project media bin backed by the existing source registry. A bin entry represents a source, not a timeline occurrence. A video source can supply several Video 1 or Video 2 occurrences and detached audio without duplicate browser Files or duplicate uploads. Audio files can supply Original/Replacement Audio or Background Music. An explicit PIP placement uses the existing PIP operation and limits; this milestone does not add multiple PIP sources or an overlay redesign.

Distinguish asset media type from placement role in registry validation: a registered video is not permanently restricted to the lane of its first occurrence. Session and source identity checks still apply. Existing occurrence controls continue to address occurrences rather than bin entries.

Add an import-to-bin action for video and audio. Preserve the existing import-and-append Video 1 workflow and current music import workflow. Import-to-bin does not change the sequence until placement. Bin membership is metadata in history; importing and removing bin entries is undoable. Removing a bin entry does not delete timeline occurrences. Referenced media cannot be physically released while history or playback still owns it.

Each bin entry offers Place on Track, with track choice, numeric start frame/timecode, and optional source in/out points. This is the keyboard equivalent of dragging. Without a selected range, placement uses the complete source at normal speed. Video range controls use the existing inclusive source-frame conventions. Audio range controls resolve to decoded 48 kHz sample offsets. No timeline operation implicitly loops a source.

### Drop coordinates and transactions

The drop indicator identifies the target lane, start frame, duration, and resulting range. Compute the frame from the actual scrolling time-content rectangle and current pixels per frame, excluding lane headers and the tools rail. Apply horizontal scrolling exactly once. Round nonnegative positions half up to the nearest project frame. The displayed indicator and committed frame must agree. Reject positions before frame zero; do not silently clamp a drop outside a valid lane.

Internal drag data carries a session/source token and the placement draft, never a path or an object URL. A bin drag creates an occurrence; it does not remove the source or move another occurrence. Existing occurrence reorder and positioned move operations keep their current meaning. Cross-track dragging of an existing occurrence remains unsupported; direct the user to place the reusable bin source instead. External drops accept one file per lane operation. Batch import remains available in the media panel.

Metadata loading produces a cancellable placement candidate. Validate against the current project when loading completes, not only against the state at drag start. Commit once, including all affected fragments and selection, or commit nothing. Invalid drops, cancelled candidates, stale sessions, and no-op gestures do not create history entries or clear Redo. They do not leave orphan URLs or uploads.

### Video 1 overwrite

Video 1 remains the contiguous base sequence. Let its duration be `N` frames. A placed clip of `D` normalized output frames starting at `p` overwrites the half-open range `[p, p + D)`.

- Require `D >= 1` and `0 <= p <= N`. An empty sequence accepts only `p = 0`. Reject `p > N`; this milestone does not create blank Video 1 gaps.
- Preserve every existing output frame outside the overwritten range at the same project position. Split boundary occurrences as needed and remove fully covered occurrences.
- Do not ripple later clips. If the dropped range ends beyond `N`, extend the sequence to `p + D`. Otherwise `N` is unchanged. A drop at `N` appends.
- Keep unaffected occurrence IDs. Allocate new IDs for surviving fragments and the new occurrence; share source records. Commit the entire overwrite as one Undo action.
- Do not move Video 2, independent audio, music, PIP, or image schedules. Existing Video 2 still wins over the overwritten Video 1 picture during its range. Existing independent audio still wins according to section 4.
- Evaluate the existing total Video 1 plus Video 2 occurrence limit against the final result, including fragments. A rejected capacity check leaves the original sequence intact.

Example at 25 FPS: `A [0,60)`, `B [60,120)`, `C [120,180)`. Dropping `X` for 60 frames at frame 40 yields `A [0,40)`, `X [40,100)`, the last 20 frames of `B [100,120)`, and unchanged `C [120,180)`. B resumes at its old normalized output offset 40; its source offset must not be recalculated from a rounded new trim. Duration stays 180 frames.

Dropping a 90-frame X at frame 40 instead preserves A through frame 39 and C from frame 130 onward. Dropping a 70-frame X at frame 150 extends the sequence from 180 to 220; no existing later content is shifted.

### Exact windows and existing editing operations

Extend Video 1 occurrences with the normalized output-window representation already used by Video 2. A source edit consists of inclusive source trim and speed. Its normalized length at project FPS is `L`; a visible occurrence uses `[output_in_frame, output_out_frame)` within `[0,L)`. Its duration is the difference. Full-source occurrences can remain implicit in browser state but are explicit in Version 3 delivery.

Retain `L = max(1, floor(((source_end - source_start + 1) / source_fps / speed) * F + 0.5))`. Within a visible window, source time is `source_start/source_fps + (output_in_frame + local_project_frame)/F * speed`, subject to existing source EOF handling. Split, placement, preview, and backend resolution use this same mapping.

For an existing occurrence at `[a,b)` with window `[c,d)`, a surviving left part `[a,u)` uses `[c,c + u - a)`. A surviving right part `[v,b)` uses `[c + v - a,d)`. This preserves normalized frames through mixed source FPS and slow motion without repeated source-frame rounding.

Preserve the existing inclusive-source split algorithm for existing full-window Video 1 clips, including its established boundary rejection and source-frame allocation. Windowed Video 1 fragments split at the exact project-frame boundary by dividing their output window, as Video 2 does today. The editor must not expand a fragment back into overwritten material on a later split. Source trim commits reset the selected occurrence to the newly chosen source edit's full window, using the existing Video 1 duration/ripple consequences. Speed changes preserve a window's source-time coverage, convert its offsets half up, and preflight the resulting project and positioned-track validity.

Video 1 reorder, ripple delete, and version replacement remain available. A windowed occurrence's visible source-time interval, rather than its hidden original full window, defines matching for version replacement. The donor is still consumed by the existing version-replacement operation. If no valid donor range can represent the selected visible interval under existing source/FPS rules, reject the operation with a range error. Fragments inherit the target's linked/detached audio mode. Independent audio is not regenerated or moved by version replacement.

Supported FPS values and existing Auto selection remain unchanged. Reject an overwrite that changes Auto's resolved FPS by replacing the first base source: “This overwrite changes Auto FPS. Choose an explicit project FPS before placing this clip.” An initial empty-sequence placement may resolve Auto normally. This prevents a nominally non-ripple overwrite from silently rescaling every later position. Other established FPS-changing operations still use the existing conversion policy, extended to new windows and audio segments. Conversion that collapses a segment, creates an overlap, or makes an audio source range invalid fails atomically.

### Video 2 and overlays

Video 2 is a full-screen replacement, never a PIP default. A placement requires a nonempty Video 1 sequence and a complete range inside `[0,N)`. Multiple Video 2 clips are allowed; touching edges are valid, overlapping ranges are rejected without trimming, shifting, or swapping either clip. Existing Video 2 trim, split, move, selection, and ripple rules remain unchanged.

Video 2 selects both picture and automatically linked original audio during its range. Overlay/PIP is composited separately after picture selection. PIP disappears at the earlier of its scheduled end and source EOF, never freezes its last frame, and reappears correctly when seeking backward into valid source time. Preserve current image-overlay ordering, controls, and scheduling.

## 3. Independent audio workflows

### Detach Audio

Add Detach Audio to the selected Video 1/Video 2 occurrence's actions and context menu. Use `Ctrl+Alt+L`; do not intercept `Ctrl+L`. A clip's original-audio mode is `linked` or `detached`. New video occurrences default to linked. Detachment changes the selected occurrence's mode to detached and creates editable Original/Replacement Audio segments in one transaction.

Detach captures the selected occurrence's currently exposed automatically linked original audio, before gain/mute, excluding ranges covered by Video 2 or an existing independent audio segment. This preserves the current mix on detach and avoids accidentally adding hidden base audio over a replacement take. It can create multiple segments. Fully covered clips, clips already detached, or selections with no exposed linked intervals cannot detach; explain why and offer selection of the covering take. A video with no audio stream can detach an explicit silent recipe over its exposed intervals, so silence does not reveal another clip's original audio.

At 25 FPS, base A covers `[0,150)` and Video 2 B covers `[40,100)`. Detaching A creates A audio at `[0,40)` and `[100,150)`, with matching offsets in A's normalized PCM. B's linked original audio remains audible at `[40,100)`. Detaching B creates its audio in that middle range instead. These operations must produce the same pre-gain mix immediately before and after detachment.

Detached segments keep a frozen source-edit recipe: source identity, inclusive source trim, speed, and FPS used to normalize the recipe. Subsequent video trim, speed, move, overwrite, reorder, version replacement, or deletion does not alter that recipe or move its audio. This independence is visible through a detached badge and lane selection.

Deleting detached audio leaves its video present and its mode detached, producing silence wherever no other audio owns the range. There is no automatic relinking. Undo restores both segment and mode as appropriate. Video split and overwrite fragments inherit the parent's mode; removing an owner video does not delete its independent audio or make the recipe invalid.

### Replacement audio and music editing

The Original/Replacement Audio lane accepts multiple audio-file placements at chosen frames. It contains detached and replacement segments in one non-overlapping lane. A replacement may occupy a silent gap or explicitly replace a selected segment through a Replace Audio action that validates the new range before committing. A normal overlapping drop is rejected; it does not implicitly mix, trim, or overwrite existing independent audio.

Replace Audio retains the selected segment's timeline start and duration, uses the chosen audio source's selected in-point, and consumes exactly that duration. A longer source is intentionally cut to the selected duration; an insufficient source outside the permitted EOF padding is rejected. Preserve the segment ID/selection and replace its recipe/provenance in one history action. Deleting a segment and placing a differently sized replacement is the separate workflow when duration should change.

Move changes only a segment's timeline start. Trim adjusts its source window and duration. Left trim advances both start and source offset; right trim changes only duration. Split divides at the playhead and advances the right segment's source offset exactly. Segments require at least one frame. All operations are independently undoable.

Delete/Backspace on Original/Replacement Audio performs a lift: remove the selected audio and leave its gap and video untouched. The explicit Ripple Delete tool closes the removed duration on that lane only, moving later segments left and retaining pre-existing gaps. Its tooltip identifies the selected lane. Existing Video 1/Video 2 deletion behavior is preserved. Background Music retains its approved default same-track ripple delete, including Delete/Backspace. Thus deleting a detached dialogue segment does not unexpectedly slide later dialogue away from its video.

Background Music remains one active source with multiple non-overlapping editable segments, existing volume/mute, drag/trim/split, and middle deletion. The general audio catalog may contain other bin sources, but changing the active music source retains the existing source-replacement behavior. Neither music nor independent audio loops. They may extend beyond N and are cut at final duration; shorter sources are followed by silence. Audio-only exports still require a Video 1 sequence and use that sequence's duration.

Dropping the active music source adds a positioned segment. Dropping a different source onto occupied music does not silently replace the existing music source: reject it with an instruction to use the explicit existing Change Music action, which retains its established replacement behavior. An empty music lane can adopt the dropped source directly.

## 4. One audio contract for preview and every export

Resolve audio ownership in this order for each project interval:

1. An independent Original/Replacement Audio segment owns its entire interval, including any validated final EOF padding.
2. Otherwise, choose the same Video 2 or Video 1 occurrence selected for picture. Use its original audio only if its mode is linked.
3. Otherwise, use silence.

Mix Background Music additively with that result. Do not add automatically linked audio underneath an independent segment. There is no fallback to base audio when the selected Video 2 source has no audio, is detached, or its audio reaches EOF. PIP audio remains excluded.

Independent audio is the explicit user override of automatic Video 2 audio priority. A later Video 2 insertion still replaces picture but does not move or erase already independent audio. Likewise, Video 1 overwrite preserves independent audio at its absolute position. The drop preview warns when independent audio will remain over the new picture; it does not change the operation silently.

Existing Original Audio gain/mute controls apply once to the selected automatic audio and all independent detached/replacement audio. Existing Background Music gain/mute controls apply once to music. Preserve current gain ranges. No per-segment gain, automatic ducking, limiter, normalization, fade, or crossfade is introduced. Both muted buses yield a full-duration silent track in every export.

Use 48 kHz stereo PCM as the canonical intermediate. For supported project FPS F, `K = 48000/F` is integral and final sample count is `N*K`. Segment timeline start/duration are frames; source offsets are integer samples. A file recipe references decoded/resampled PCM. A video-edit recipe references PCM normalized using its frozen trim, speed, and normalization FPS, including the existing tempo-preserving slow-motion treatment and silence for missing source audio.

A segment with start `p`, duration `d`, and source offset `s` reads `[s,s + d*K)` and places it at `p*K`. An EOF shortfall strictly less than K is accepted as frame-quantization padding and becomes silence. A larger shortfall is an invalid range, never a loop or frozen sample. Actual source EOF within an automatically linked video edit is padded with silence through that edit's valid picture duration. Audio tails beyond N are clipped to N*K at composition.

Audio segments are independent of future video edits and FPS changes. FPS conversion rescales start/duration half up and leaves source sample offsets fixed. A frozen video-edit recipe keeps its normalization FPS; reinterpreting its PCM using the new project FPS would change the detached sound and is prohibited.

## 5. Playback continuity and audible preview

### Diagnosis and acceptance boundary

Static inspection found three concrete mechanisms that can cause the reported split interruption: `useProjectPlayback` stops transport when structural revision changes; the Video 1 split handler explicitly pauses; and `ProgramMonitor` keys its video element by occurrence and mapping fields, remounting it when split IDs/trims change. Effects also pause/restart source elements as those identities change. These are code findings, not a claim that the visible flash has already been reproduced or fixed.

Before changing playback, reproduce with a real decoded clip while playing and record project frame, play/pause events, element identity, current source time, readyState, and presented-frame callbacks around split. Repeat for mixed source FPS, slow motion, a Video 2 boundary, and music playing. Tests must distinguish a DOM remount, an unnecessary seek, a stopped clock, and genuine decoder buffering. A timeout, synthetic preview, hidden black layer, or frozen screenshot is not an acceptable repair.

### Transport transaction

A structural edit returns a transient transport mapping alongside its metadata result. Capture current project position and playing intent at transaction time, including elapsed time since the last clock tick. Do not store playing state, decoder state, or audio nodes in Undo history.

- Exact-window split: preserve the same project-frame position and playing intent.
- Legacy full-window split: retain the approved source-cut algorithm and map the captured source-time anchor into the resulting fragments. Preserve equivalent source time to within one project frame rather than restarting at zero when legacy rounding changes duration.
- Video 1 overwrite and positioned/audio edits: retain absolute project position when it still exists.
- Video 1 reorder: follow the surviving occurrence and its content offset to its new position.
- Video 1 ripple delete: subtract removed duration after the deletion; a playhead inside the removed interval moves to the splice point. At final EOF, pause rather than restart.
- FPS changes: preserve project seconds by half-up frame conversion; empty/invalid projects pause with a truthful state.
- Undo/Redo: map the current position into restored content, using occurrence/source lineage where available, otherwise clamp absolute position. Never restore an old playing session from history.

Draft gestures can preserve the existing intentional pause while dragging/trimming. Committed split, detach, and non-gesture edits must not pause merely because a structural revision changed. Explicit Seek, Pause, output locks, and end-of-project behavior retain their existing semantics.

### Media and clock lifetime

Use a stable media-element identity tied to the active source lease, not the occurrence UUID or trim JSON. A same-source continuous split must retain the decoding element, avoid resetting its src, and avoid a needless seek/play cycle. Keep a bounded pair of real video elements for an upcoming source handoff; preload and seek the next actual source, then switch only after real readiness/presented-frame events. Do not repeatedly assign currentTime on every React render.

The project clock uses a monotonic time source and a single frame mapping shared by picture and sound. When a necessary new source is not ready, suspend the clock and audio with a visible Preparing Preview state, then resume the captured intent on actual readiness. Cancel stale readiness callbacks with a transaction/session token. Never resume after a user Pause, new project, newer edit, or stale load. A decode failure stops transport and identifies the media; it must not silently play black picture or omit sound.

Make preview audible using native media playback and Web Audio routing available in the browser, without a package. Automatic/independent audio and music have separate gain buses but share the project clock and ownership rules. Reuse bounded active media voices, route each exactly once, and stop or disconnect voices on ownership change/EOF. User Play initializes/resumes the AudioContext; autoplay rejection shows a Resume Audio action and does not claim a fully audible preview. Native tempo-preserving playback (`preservesPitch` with the existing speed values) is required; ordinary BufferSource playbackRate pitch shifting is insufficient.

Picture and PIP elements remain muted; sound comes exclusively from the controlled audio voices. This prevents native video audio from doubling the routed original bus. Seeking pauses/resets voices according to the existing transport semantics and resumes only on a subsequent Play intent.

Detached video-edit audio auditions the same frozen source edit and offset, even after its owner video changes. Browser seek/resampling/tempo behavior is approximate; target interior audio/video alignment within 50 ms under normal supported playback. Real FFmpeg export remains authoritative. Unsupported browser decoding must show that the source cannot be fully auditioned while allowing an otherwise backend-valid render. Do not describe a partially silent preview as the complete final mix.

PIP retains its independent source-EOF latch, including backward seeking. A main-source handoff or split must not clear that EOF protection or hold the last PIP frame.

## 6. State, history, and resource lifetime

Extend the existing immutable project snapshot with bin membership, Video 1 windows, per-video original-audio mode, and independent audio segment metadata. An independent segment has a stable ID, timeline start, duration, source sample offset, immutable recipe, and optional detached-owner provenance. Provenance is descriptive, not a live foreign key: deleting an owner is valid.

Original/media Files, object URLs, media elements, AudioContext nodes, pending promises, transport mappings, and export jobs remain outside snapshots. Preserve the existing 30-entry history and atomic validation before restoration. Overwrite, detach with several exposed intervals, replacement, and ripple each create one entry. A gesture remains one entry; invalid/no-op edits create none. Selection restoration validates segment IDs; deleting an audio segment must not accidentally select/delete its video.

Reachability includes bin entries, all current/history video occurrences, independent video-edit recipes, audio-file recipes, music, PIP/image, pending candidates, active playback leases, and the immutable upload/render snapshot. A video used only by detached audio remains reachable and must be uploaded for that recipe. URL revocation occurs only when no owner needs it; registry cleanup follows the existing File-retention policy rather than revoking shared sources during a fragment operation.

New Project cancels local candidates, playback, audio voices, and polling before releasing session owners. It does not delete a running server job or completed download without the existing explicit job operation. Cancelling a stale source load cannot modify a new session. Failed/cancelled placements release candidate leases. History eviction and redo clearing reconcile resources after state commit, not during restoration.

## 7. Version 3 render contract and validation

Version 3 is required for new windowed Video 1, detached/replacement audio, or additional export requests. Existing Version 1/absent-version and Version 2 requests remain accepted unchanged, including their current legacy trim correction, upload contract, MP4-only response, and legacy Version 1 music behavior. Version 2 and Version 3 never automatically loop music. Browser projects from older snapshots default to linked original audio, full Video 1 windows, empty independent audio, and MP4 only.

Version 3 extends the Version 2 field names rather than renaming its source catalog, ordering, overlays, and gain controls. Its JSON contains:

- `schema_version: 3`, existing project FPS, video source catalog, clip ordering, Video 2, overlays, and audio controls.
- Each Video 1 clip: existing source/edit fields plus `timeline_start_frame`, `duration_frames`, `output_in_frame`, `output_out_frame`, and `original_audio`.
- Each Video 2 clip: existing positioned window fields plus `original_audio`.
- `audio_sources`: ordered unique `{source_id}` entries for external audio files, including the active music source.
- `independent_audio`: ordered segment descriptors, and existing music descriptors pointing into `audio_sources`.
- `exports`: a unique list containing `mp4`, optionally `mov`, `wav`, and `mp3`. Omission defaults to MP4. Unknown names and duplicate values are invalid.

An independent segment descriptor has this shape; numbers below are an example at 25 FPS:

```json
{
  "id": "audio-a-right",
  "timeline_start_frame": 100,
  "duration_frames": 50,
  "source_start_sample": 192000,
  "source": {
    "kind": "video-edit",
    "source_id": "source-a",
    "source_start_frame": 0,
    "source_end_frame": 149,
    "speed": 1,
    "normalization_fps": 25
  },
  "detached_from": { "track": "video1", "clip_id": "a" }
}
```

An audio-file recipe instead uses `{ "kind": "audio-file", "source_id": "song-1" }`. Its segment fields are identical. Silent video recipes do not need a fake uploaded silence file. Browser-only names, tokens, object URLs, and file paths are absent from manifests.

Multipart `files` follows the existing ordered unique video source catalog, including video sources referenced only by independent recipes. Version 3 adds ordered repeated `audio_files` matching `audio_sources` and rejects simultaneous legacy `background_audio`; Version 1/2 keep their existing single background upload. PIP/image fields remain unchanged. Upload each catalog source once, with generated storage names and existing path confinement. Existing dedicated PIP/image uploads retain their separate role contract; a video also used as PIP may therefore occupy that existing extra upload field.

Validation is authoritative before queueing:

- Strict schema/version/key/type checks; finite numbers; supported FPS/speed; positive frame durations; integer nonnegative sample offsets; unique occurrence/segment/source IDs and valid references; identifiers bounded to 128 UTF-8 bytes. Reject unknown keys rather than ignoring flags that could change composition.
- Probe actual video frame count/FPS and actual decoded/resampled audio length, not browser estimates. Source trims must be valid; apply existing source correction to legacy requests. In Version 3, any correction that changes a declared visible window, duration, or contiguous position is a 422 range error requiring explicit user repair, never an unnoticed shift of the promised overwrite.
- Video 1 order is contiguous from zero and each declared start/duration matches its normalized window. Compute N from validated clips. Video 2 windows must be inside `[0,N)` and non-overlapping. Independent audio and music each must be non-overlapping on their own lane. Adjacent endpoints are legal.
- Audio recipes must resolve, use supported normalization FPS/speed, and satisfy sample EOF/padding rules. Detached provenance may reference a deleted occurrence; its source recipe still must resolve. A `detached` video without independent segments is valid silence.
- Preserve existing total video-occurrence and unique-video-upload limits. Bound unique external audio files by existing `max_clips`; bound combined independent/music segments by `10 * max_clips`. The sum of all external audio upload bytes, including music, must stay within the existing audio-file byte budget. Preserve individual video/overlay limits, overall request budget, queue limits, subprocess timeout, and retention.
- Keep the existing 64 KiB manifest part budget and enforce it in browser preflight and backend. Complexity limits do not guarantee a verbose manifest fits; report “Timeline description exceeds the render limit” before upload when possible. Adapt the multipart file-count calculation to the bounded video/audio catalogs and existing overlays without raising configuration values or weakening byte checks.
- Check requested muxer/encoder capabilities at startup/readiness and request validation using the installed FFmpeg. An unavailable extra format has a clear unsupported-format response; never install an encoder or silently substitute a codec.

The backend returns stable error codes plus safe lane/segment/source IDs for repair. Preserve useful existing errors and status codes. Missing uploads, wrong catalog order, unsupported media, invalid overlaps, invalid ranges, and over-budget requests clean partial uploads and never enter the job queue. The browser keeps the editable project, highlights the responsible item, and does not silently remove or reposition it.

If Video 1 trim, ripple deletion, or speed changes leave positioned Video 2 outside N, retain the established repair/block-render behavior rather than deleting Video 2. Audio tails remain permitted. During an invalid positioned state, operations requiring a valid shared composition, including Detach Audio, are blocked until repaired.

## 8. Exact FFmpeg composition and downloads

### Shared composition

Use one validated resolved project for every artifact. Extend the existing pure render plan to include Video 1 windows, linked/detached flags, frozen recipes, independent ownership intervals, and requested exports. Partition picture at Video 1/Video 2 boundaries and audio at those boundaries plus independent-segment boundaries. Choose the appropriate picture and audio independently according to section 4.

Reuse normalization by source/edit/FPS keys. Normalize picture using existing scale/pad, supported FPS, source trim, speed, H.264/yuv420p behavior, then select the explicit output frame windows. Normalize automatic original PCM with the same edit mapping; normalize frozen detached PCM using its captured FPS instead. Do not derive a detached recipe from the owner's latest edit. Slice PCM with integer sample `atrim` bounds, reset timestamps, place on a full-length silent bed, and mix music using the existing sample-delay and `amix normalize=0` principles. No `aloop`, infinite input loop, last-frame hold, or `-shortest` may determine project duration.

Composite current PIP then image overlays onto the selected picture using existing dimensions and time schedules. PIP source EOF must terminate its contribution without freezing. Final picture contains exactly N frames at project FPS; final audio master contains exactly N*K stereo samples at 48 kHz.

Produce one final PCM16 WAV master after gains/mixing, with normal signed-16-bit quantization and saturation, no new normalization or limiter. Derive every encoded audio artifact from this same master. This makes lossy codec differences the only export sound differences; it does not promise bit-identical AAC/MP3 and PCM. Avoid intermediate lossy audio encodes or repeated gains.

### Formats

| Download | Composition/encoding | Contract |
| --- | --- | --- |
| MP4 | Existing H.264 medium/CRF 23, yuv420p; AAC 192 kb/s, 48 kHz stereo; faststart | Mandatory primary artifact, existing job/video/download behavior preserved. |
| MOV | Remux the finished MP4's H.264/AAC streams with explicit mapping, stream copy, MOV muxer and faststart | Same selected frames, stream payloads, overlays, FPS, and audio; no second composition or ProRes. |
| WAV | Deliver the final PCM16, 48 kHz stereo master | Exactly N*K samples; includes original/detached/replacement audio and music after gains/mutes. |
| MP3 | Encode the master once with installed `libmp3lame`, 320 kb/s, 48 kHz stereo, gapless/Xing metadata | Same final mix and intended program duration; no automatic loop or audio tail extension. |

MP4/MOV must report the intended N/F video duration and decode to N frames. AAC/MP3 encoder priming and padding are codec metadata, not permission to add timeline content. Verify gapless decoding where supported and bound residual decoded edge padding by one codec frame (AAC 1024 samples, MP3 1152 samples). WAV is the exact sample-count reference. Browser/native players may handle lossy gapless metadata differently; do not claim PCM-byte identity or universal sample-perfect MP3 seeking.

FFmpeg documents [stream copy without decoding/re-encoding](https://ffmpeg.org/ffmpeg.html#Streamcopy), its [MOV/MP4 muxers](https://ffmpeg.org/ffmpeg-formats.html), and [libmp3lame encoding options](https://ffmpeg.org/ffmpeg-codecs.html#libmp3lame). These capabilities allow the requested formats without packages or configuration changes.

### Job and resource behavior

Keep a single immutable submission and the existing bounded worker queue. MP4 remains mandatory and is rendered first from the shared picture and PCM master. Generate requested extras sequentially in the same job, with no separate upload or project re-evaluation. The default rendered preview remains the final MP4.

The export panel defaults to MP4 and offers optional MOV, WAV, and MP3 checkboxes. Requesting an audio download still produces the mandatory MP4 preview in this milestone; the WAV/MP3 artifact itself contains audio only. Capture selections at submission, disable mutation under the existing job locks, and label each completed download by format.

Version 3 status includes an `exports` map for requested formats with `queued`, `processing`, `ready`, or `failed` and safe error text. Public download links exist only for ready artifacts. Job status remains processing until requested artifacts are terminal. Primary MP4 failure fails the job and exposes no partial render. If an optional artifact fails after MP4 succeeds, complete the job with the MP4 and successful downloads plus an explicit format-specific warning. Do not falsely mark the failed format ready. Retrying a failed format requires a new normal submission in this milestone; there is no new background retry subsystem.

Retain `/api/jobs/{id}`, its MP4 video route, and its MP4 download route. Version 1/2 retain their existing response shape. Add `/api/jobs/{id}/exports/{format}` for the four fixed format names: unknown format 422, unrequested or expired artifact 404, requested but unfinished artifact 409. Failed optional artifacts return 409 with an `export_failed` code and safe failure text, without serving a partial file. Use `video/mp4`, `video/quicktime`, `audio/wav`, and `audio/mpeg`, safe generated filenames, and attachment disposition.

Write intermediates inside the job's confined directories and atomically publish an artifact only after its probe/validation succeeds. Job cleanup removes the PCM master, video intermediates, and all export artifacts together. Existing processing/deletion exclusion and retention apply to the complete job; additional artifact generation must not race cleanup. Downloads cannot extend retention indefinitely. Preserve polling cancellation and New Project behavior. An extra format failure must not remove an already valid MP4.

## 9. Errors, accessibility, and keyboard behavior

Use lane-local drop indicators and a nonmodal live error region. Invalid Video 2/audio overlaps say “This range overlaps another clip on [lane]. Move it to a free range.” Out-of-bounds Video 2 says “Replacement clips must fit within Video 1.” Invalid source windows identify the source and offer trim/metadata repair. Missing source errors keep the project/history unchanged and identify the affected occurrence. Playback errors identify whether picture or sound cannot be decoded. Export warnings identify the failed format while retaining available download links.

Wrong media types or unsupported cross-track occurrence drops explain the eligible target/action. Placing video directly in an audio lane is not an implicit Detach Audio operation; use Detach Audio on a selected video or place an audio file. A pending source has a loading indicator and cannot be committed before metadata validation. Every error leaves the prior project, selection, history, and playback leases intact, apart from the explicit pause needed for a genuine playback failure.

Do not rely on color alone for track kind, detached state, selection, overlap, or loading. Preserve accessible icon labels and tooltips in the left Timeline Tools rail; controls must not enter clip lanes. On narrow screens the tools may sit above the timeline without covering clips. Lane headers and source rows have useful names, and a segment exposes track, filename, start, duration, and linked/detached status.

Keyboard Place uses the same validation and frame rounding as drag. After successful placement/detach, focus the resulting segment, or the first segment for a multi-segment detach. After deletion focus the nearest surviving segment or lane heading. Arrow/numeric position controls use project frames; retain established timeline navigation and split shortcuts/behavior.

Preserve Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Delete, and Backspace guards for input/contenteditable, IME, dialogs, repeat, and editing locks. Ctrl+Alt+L fires only for an eligible selected video, outside text inputs and modal dialogs; prevent default only when executing Detach Audio. Ctrl+L remains the browser's location-bar command. Render/export controls are named by format and expose progress/failure through accessible status text. Unsupported keyboard/browser combinations retain the visible Detach Audio action.

## 10. Test and verification strategy

Implementation uses test-first development and existing tools only. Tests below are acceptance coverage, not an implementation task plan. Do not weaken unrelated baseline assertions or replace real render/preview checks with mocks.

### Pure/frontend unit coverage

- Overwrite within one clip, across several clips, at zero, at touching boundaries, at N, and extending N; precise left/right offsets; fully covered deletion; unchanged later positions/IDs; mixed FPS and both slow-motion speeds; capacity rejection after fragmentation; p>N rejection; Auto-FPS first-source guard.
- Preserve legacy inclusive-source split tests. Add exact-window split/trim/speed/version-replacement tests that never resurrect hidden frames. Convert FPS with fixed audio offsets and reject collapsed/colliding/EOF-invalid results atomically.
- Detach Video 1 partly covered by Video 2, detach Video 2, existing independent masking, fully hidden/no-exposed rejection, silent video, detached-mode inheritance, deletion silence/no relink, video deletion with surviving audio recipe, and independent audio remaining over later overwrite/replacement.
- Audio move, both-edge trim, exact split sample offset, lift versus explicit same-track ripple, music's default ripple with existing gaps, touching edges, overlap rejection, shorter EOF silence, longer tails, and one-frame padding limits. Test bus gain/mute once and absence of PIP audio.
- One history action per overwrite/detach/gesture; failed/no-op operations retain Redo; restoration validates before stack movement; resource reachability across bin removal, history eviction, audio-only source references, candidate cancellation, active playback, and New Project.
- Playback mapping for split, reorder, overwrite, ripple, FPS, Undo/Redo, EOF, and user Pause during readiness. Assert source element identity on same-source split, no src reset/unnecessary seek, no structural pause, stale readiness cancellation, bounded voice/element cleanup, and original/music gain routing.

### Backend/API integration coverage

- Strict Version 3 parsing, JSON size budget, missing/extra catalog files, unique IDs, audio provenance after owner deletion, source-only detached recipes, authoritative frame/sample mismatch, overlap, unsupported speed/FPS/format, missing media, and upload cleanup on every rejection.
- Keep Version 1/2 contract and existing MP4 tests unchanged, including legacy behavior isolated to legacy manifests. Verify new response fields only for Version 3 and exact old download behavior.
- Resolve windowed Video 1 picture and independently prioritized audio; validate silent beds, offsets, frozen-recipe caching, gain once, master sample count, and no-loop command/filter construction.
- Test optional export failure after MP4 success, primary failure, unfinished/failed/unrequested downloads, fixed-path routing, queue saturation, cancellation/polling behavior, atomic publication, and whole-job cleanup while busy/expired.

### Real FFmpeg coverage

Generate deterministic local fixtures with frame markers/colors and distinct tones. Exercise actual source probing, normalization, composition, encoding, and downloads, not a mocked executor.

- Verify every frame outside overwrite is the original normalized frame, later content is not shifted, Video 2 still wins, mixed FPS/slow motion is correct, and one/multi-clip MP4 remains playable H.264/AAC.
- Compare the pre/post-detach canonical PCM within PCM quantization tolerance. Verify silence after detached deletion, replacement tone priority, both mute/gain buses, no duplicated original sound, no PIP sound, preserved slow-motion pitch, short-source silence, removed music middle absent, and tails clipped to N*K.
- Verify PIP disappears at true EOF while main picture/audio continues. Include one-frame clips and normalization windows at endpoints.
- Verify WAV exact sample count; MP4/MOV N decoded frames and FPS; MOV remux packet payload equality with MP4; MP3 declared codec/bitrate/sample rate, intended duration and bounded gapless edge padding. Compare decoded tones, impulse positions, and silence intervals with appropriate lossy-codec tolerances, not PCM hash equality across AAC/MP3.
- Validate all-silent exports, missing audio streams, malformed source windows, encoder failure, no partial public artifact, and confined cleanup.

### Real browser/E2E coverage

Use the existing Playwright setup and real browser media fixtures. Test bin drag to exact positions with horizontal scrolling, keyboard placement, overwrite preview/Undo/Redo, adjacent and invalid Video 2/audio drops, narrow-screen tools, and retained PIP behavior.

While actual playback runs, split repeatedly in one source and at replacement boundaries; record presented video frames and element identity. Assert continued equivalent project/source position, no reset to zero, no unnecessary pause/remount, and no unexplained blank presented frame on a same-source split. Test genuine source buffering with visible suspension/resume and Pause cancellation, not an arbitrary timeout-based pass condition. Add an audible real-media synchronization scenario; unit mocks alone cannot establish playback reliability.

Exercise Ctrl+Alt+L, Ctrl+L browser behavior, detach/delete silence, replacement audio, music editing, gains/mutes, history, source cleanup, and keyboard-only focus. Submit a real Version 3 job, download all four artifacts, probe their contents, and test an optional-format failure while MP4 remains available. Preserve existing advanced-timeline and legacy delivery journeys.

At implementation completion run full frontend tests, backend tests, real-FFmpeg integration tests, lint, format check, production build, browser/E2E tests, and `git diff --check` using Windows-compatible commands and existing installed dependencies. Report actual results and any environment-blocked verification separately; do not infer success from this document.

### Manual acceptance checklist

- Import one/multiple videos through existing flows, and reusable video/audio through the bin; keyboard and pointer placement agree on frame positions.
- Overwrite across two cuts; inspect preserved before/after frames, unchanged later clips, extension at the end, and one-step Undo/Redo.
- Place two full-screen replacements; reject overlap; retain PIP size/position and disappearance at source EOF.
- Detach exposed base audio and a replacement take; hear no change on detach, silence after lift deletion, and intended replacement sound without doubled originals.
- Trim/split/move independent audio, explicitly ripple its middle, and default-ripple music's middle; inspect that unrelated tracks stay fixed and EOF never loops.
- Split while playing at normal/slow speed and around Video 2 boundaries; confirm continuous position, visible real buffering only when needed, audible synchronization, and correct Pause/Undo behavior.
- Render/download MP4, MOV, WAV, and MP3; compare final picture/mix/duration, all-muted output, and short/long music behavior.
- Check keyboard-only operation, Ctrl+L preservation, labels/live errors, narrow layout, failed export visibility, New Project, and retained job downloads.

## 11. Explicit exclusions and self-review

Out of scope: database, authentication, collaboration, deployment, desktop conversion, new packages or FFmpeg installation, package/lock/configuration/system-setting changes, transitions/effects, ProRes, additional PIP tracks, overlapping independent-audio mixing lanes, per-segment volume, automatic music looping, audio-only projects without Video 1, and a separate export-retry service. Existing image-overlay scheduling is preserved rather than redesigned.

Self-review resolved the principal ambiguities:

- Overwrite uses half-open normalized output windows, preserves outside frames and absolute later positions, permits end extension, rejects gaps and Auto-FPS rescaling, and does not erase positioned replacements or independent audio.
- Detach preserves exposed audio rather than revealing hidden base audio; independent audio explicitly overrides automatic original priority, persists after owner deletion, and never silently relinks. Lift and same-track ripple are distinguished by lane/action.
- Preview and all formats share ownership, gain, EOF, and duration rules. Frozen audio recipes survive video/FPS changes; WAV is sample-exact, while encoded formats have explicitly bounded codec padding rather than a false byte-equivalence promise.
- Playback findings are identified as static evidence requiring reproduction. The repair depends on real decoder readiness, stable element lifetime, and transaction position mapping, not delays or fake frames.
- Legacy manifests remain compatible, Version 3 positional mismatches fail instead of silently shifting content, and limits/cleanup cover sources referenced only by audio and every output artifact.

There are no unresolved design placeholders. This document authorizes no implementation, package/configuration change, commit, push, or deployment. Stop after specification review; an implementation plan or code requires subsequent approval.
