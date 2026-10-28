# AVStudio reference redesign

Use superpowers:executing-plans inline, following the existing sequential workflow. No agents or Git writes.

Goal: materially improve the existing workspace to match the premium cinematic reference while preserving all editing behavior.

Reference: `C:/Users/DELL/Downloads/Neon AV Studio Editing Dashboard.png`, inspected locally and explicitly confirmed by the user during execution. The initially inspected cinematic image was only the provisional reference. The user's redesign request authorizes this presentation work; the existing approved workspace design remains the behavioral contract.

Design: retain 27/46/27 spacious desktop columns, the 16:9 Program canvas, fixed picture/audio feedback slots, five lanes and the permanent left Timeline Tools rail. Give Media and Inspector continuous panel surfaces with compact headers and clear sections, reduce nested card chrome, improve media row organization, enlarge readable labels and tool captions, introduce restrained inset highlights/shadows and cyan selected states. Retain existing logo, real media, all actions and accessible names. Do not reproduce unsupported menus, effects, meters, fake waveforms, avatars or reference media.

Constraints: preserve all uncommitted changes, media identities/refs, model/history, audio/playback/Save/Open/export code, lock/recovery behavior, horizontal time geometry, fixed status dimensions and responsive access. No packages/configuration/commits/push/deployment.

1. Add a real-browser presentation regression for continuous side panels, named headers and readable tool labels; run RED on current UI and retain empty/populated baseline evidence.
2. Modify only presentational markup in EditingWorkspace, Inspector and MediaBin as necessary, plus existing workspace/timeline/global CSS. Existing callbacks, media instances and state remain unchanged. Add no new data or controls.
3. Run new checks and existing ui-polish/workspace-audio-layout checks. Capture empty/populated 1536x1024, 1440x900, 1920x1080 and short/narrow layouts; inspect screenshots against the local reference. Verify all five tracks/six tools fit and status transitions preserve geometry.
4. Run appropriate component tests, scoped lint/format, production build and git diff whitespace/status checks. Report exact results and any native process exit failures separately from assertion summaries. Save evidence and update the verification ledger. No commit.

Review focus: long filenames and wrapped fields; short-window tool containment; narrow reflow; readiness/recovery without resizing or media remounting; unchanged model/time-to-pixel behavior. Existing professional-workspace, reserved-status and component tests supplement the new visual geometry assertions.
