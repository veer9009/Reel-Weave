import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { installPreviewSeekDiagnostics } from './previewSeekDiagnostics';
import {
  generateAdvancedMedia,
  generateContinuityVideo,
} from './mediaFixtures';

type TransportObservation = {
  instanceId: number;
  status: string;
  playingIntent: boolean;
  projectSeconds: number;
  totalFrames: number;
  fps: number;
  generation: number;
  positionRevision: number;
  pending: number | null;
  durationSeconds: number;
  remainingSeconds: number;
  remainingUntilLastFrameSeconds: number;
  timelineStatus: string;
  items: {
    id: string;
    startFrame: number;
    endFrame: number;
    metadataStatus: string;
    sourceFps: number;
    sourceTotalFrames: number;
    trim: { startFrame: number; endFrame: number };
    trimSaved: boolean;
  }[];
};

type SplitEligibility = {
  selectedClipId: string | null;
  pressedClipId: string | null;
  currentVideo1OccurrenceId: string | null;
  selectedItem: TransportObservation['items'][number] | null;
  frame: number | null;
  projectSeconds: number | null;
  ready: boolean;
  strictlyInside: boolean;
  disabled: boolean;
  describedBy: string | null;
  reason: string | null;
  eligible: boolean;
};
type ShortWindowSample = {
  now: number;
  transport: TransportObservation | null;
  time: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  ready: number;
  frame: number;
  presented: number;
  lastPresented: number | null;
  seeks: number;
  sourceWrites: number;
  pauses: number;
  pauseCalls: number;
  same: boolean;
};
type ShortWindow = {
  journey: 'split' | 'uninterrupted';
  done: boolean;
  reason: string;
  samples: ShortWindowSample[];
  residualMs?: number;
};

type PresentedFrameEvidence = {
  time: number;
  callbackEntryTime: number;
  mediaTime: number;
  presentationTime: number;
  expectedDisplayTime: number;
  presentedFrames: number;
  processingDuration: number;
  energy: number;
  nativeTime: number;
  paused: boolean;
  ended: boolean;
  readyState: number;
  transport: TransportObservation | null;
};
type ObservationWindow = Window & {
  avstudioTransportSnapshot?: () => TransportObservation;
  avstudioSetupMarker?: (reason: string, details?: unknown) => void;
  avstudioSetupDiagnostics?: unknown[];
  avstudioSplitEligibility?: () => SplitEligibility;
  avstudioMediaControlCalls?: unknown[];
  avstudioSeekDiagnostics?: { records: { label: string }[] };
  matchedPlaybackWindows?: unknown[];
  captureMatchedPlaybackWindow?: (
    phase: 'pre-action' | 'post-action',
  ) => Promise<void>;
  startMatchedPostWindow?: () => void;
  matchedPlaybackWindowPending?: Promise<void>;
  shortPlaybackWindow?: ShortWindow;
  boundaryRecords?: { type: string; tag: string; src: string }[];
  continuity: {
    element: HTMLVideoElement;
    events: { type: string }[];
    presented: PresentedFrameEvidence[];
    seeks: number[];
    srcWrites: string[];
  };
};

async function markPlaybackSetup(page: Page, reason: string) {
  await page.evaluate((reason) => {
    (window as ObservationWindow).avstudioSetupMarker?.(reason);
  }, reason);
}

async function waitForEligibleSplit(page: Page, phase: string) {
  await markPlaybackSetup(page, 'split-eligibility-wait:' + phase);
  await page.waitForFunction(
    () => (window as ObservationWindow).avstudioSplitEligibility?.().eligible,
    undefined,
    { polling: 'raf' },
  );
  await markPlaybackSetup(page, 'split-eligibility-ready:' + phase);
}

test.beforeEach(async ({ page }) => {
  await installPreviewSeekDiagnostics(page);
  // Test-served response only: expose a read-only live snapshot and record the
  // before/after state of transport calls, including the eventual stop cause.
  await page.route(
    /\/src\/hooks\/useProjectPlayback\.ts(?:\?|$)/,
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes('return controller;'))
        throw new Error('Transport observation marker missing');
      const instrumented = body.replace(
        'return controller;',
        `
      const instanceId = window.avstudioTransportInstanceSerial =
        (window.avstudioTransportInstanceSerial ?? 0) + 1;
      const diagnosticSnapshot = () => {
        const fps = runtime.timeline.fps;
        const projectSeconds = live() / (fps ?? 1);
        const durationSeconds = fps ? runtime.timeline.totalFrames / fps : 0;
        return {
        instanceId,
        status: runtime.status, playingIntent: runtime.intent,
        projectSeconds, durationSeconds,
        remainingSeconds: Math.max(0, durationSeconds - projectSeconds),
        remainingUntilLastFrameSeconds: fps ? Math.max(0,
          (runtime.timeline.totalFrames - 1) / fps - projectSeconds) : 0,
        totalFrames: runtime.timeline.totalFrames, fps: runtime.timeline.fps,
        timelineStatus: runtime.timeline.status,
        items: runtime.timeline.items.map(item => ({
          id: item.clip.id, startFrame: item.startFrame, endFrame: item.endFrame,
          frameCount: item.frameCount, sourceFps: item.clip.metadata.fps,
          metadataStatus: item.clip.metadataStatus, trimSaved: item.clip.trimSaved,
          sourceTotalFrames: item.clip.metadata.totalFrames,
          trim: { ...item.clip.trim }, speed: item.clip.speed,
          outputWindow: item.clip.outputWindow && { ...item.clip.outputWindow }
        })),
        generation: runtime.generation, positionRevision: runtime.positionRevision,
        pending: runtime.pending
      }; };
      const bindDiagnosticSnapshot = (reason) => {
        // StrictMode can discard an initializer's controller. Publish only from
        // a controller that the mounted hook actually reads or invokes.
        window.avstudioTransportSnapshot = diagnosticSnapshot;
        if (window.avstudioActiveTransportInstance !== instanceId) {
          window.avstudioActiveTransportInstance = instanceId;
          window.avstudioSetupMarker?.('transport-instance-bound:' + reason);
        }
      };
      window.avstudioSeekDiagnostics?.record('transport-instance-created', {
        snapshot: diagnosticSnapshot()
      });
      const originalGetSnapshot = controller.getSnapshot;
      controller.getSnapshot = function(...args) {
        bindDiagnosticSnapshot('getSnapshot');
        return originalGetSnapshot.apply(this, args);
      };
      for (const name of ['applyEdit', 'update', 'tick', 'observePicture',
        'pause', 'seek', 'suspend', 'ready', 'fail', 'toggle', 'resetPlayback']) {
        const original = controller[name];
        controller[name] = function(...args) {
          bindDiagnosticSnapshot(name);
          const before = diagnosticSnapshot();
          try { return original.apply(this, args); }
          finally {
            const after = diagnosticSnapshot();
            window.avstudioSeekDiagnostics?.record('transport-' + name, {
              before, after, action: name === 'applyEdit' ? args[0]?.action : undefined,
              value: ['seek', 'suspend', 'ready', 'fail'].includes(name) ? args[0] : undefined
            });
            if (before.status !== after.status || before.playingIntent !== after.playingIntent) {
              const reason = ['tick', 'observePicture', 'update'].includes(name) &&
                after.status === 'paused' && after.totalFrames > 0 &&
                after.remainingUntilLastFrameSeconds === 0 ? 'project-last-frame:' + name : name;
              const transition = { reason, before, after, stack: new Error().stack };
              window.avstudioSeekDiagnostics?.record('transport-status-transition', transition);
              window.avstudioSetupMarker?.('transport-status-transition:' + reason, transition);
            }
          }
        };
      }
      return controller;`,
      );
      await route.fulfill({ response, body: instrumented });
    },
  );
  await page.addInitScript(() => {
    const setupRecords: unknown[] = [];
    const w = window as ObservationWindow;
    w.avstudioSplitEligibility = () => {
      const transport = w.avstudioTransportSnapshot?.();
      const selectedClipId =
        document.querySelector<HTMLSelectElement>('[aria-label="Inspect clip"]')
          ?.value || null;
      const pressed = document.querySelector<HTMLButtonElement>(
        'button[id^="timeline-segment-"][aria-label^="Preview clip "][aria-pressed="true"]',
      );
      const pressedClipId =
        pressed?.id.replace('timeline-segment-', '') ?? null;
      const selectedItem =
        transport?.items.find((item) => item.id === selectedClipId) ?? null;
      const rawFrame = document.querySelector<HTMLInputElement>(
        '[aria-label="Timeline position"]',
      )?.value;
      const frame = rawFrame === undefined ? null : Number(rawFrame);
      const current = transport?.items.find(
        (item) =>
          frame !== null && frame >= item.startFrame && frame <= item.endFrame,
      );
      const button = document.querySelector<HTMLButtonElement>(
        '[aria-label="Split Video"]',
      );
      const describedBy = button?.getAttribute('aria-describedby') ?? null;
      const reason =
        describedBy
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .join(' ') || (button?.disabled ? button.title : null);
      const ready = Boolean(
        transport?.timelineStatus === 'ready' &&
        selectedItem &&
        selectedItem.metadataStatus === 'ready' &&
        typeof selectedItem.trimSaved === 'boolean' &&
        selectedClipId === pressedClipId &&
        selectedItem.sourceFps > 0 &&
        selectedItem.trim.startFrame >= 0 &&
        selectedItem.trim.endFrame < selectedItem.sourceTotalFrames,
      );
      const strictlyInside = Boolean(
        selectedItem &&
        frame !== null &&
        frame > selectedItem.startFrame &&
        frame < selectedItem.endFrame,
      );
      const disabled = button?.disabled ?? true;
      return {
        selectedClipId,
        pressedClipId,
        currentVideo1OccurrenceId: current?.id ?? null,
        selectedItem,
        frame,
        projectSeconds: transport?.projectSeconds ?? null,
        ready,
        strictlyInside,
        disabled,
        describedBy,
        reason,
        eligible: ready && strictlyInside && !disabled,
      };
    };
    w.avstudioSetupDiagnostics = setupRecords;
    w.avstudioSetupMarker = (reason, details) => {
      const picture = document.querySelector<HTMLVideoElement>(
        '[aria-label="Uploaded clip preview"]',
      );
      setupRecords.push({
        now: performance.now(),
        reason,
        details,
        transport: w.avstudioTransportSnapshot?.() ?? null,
        splitEligibility: w.avstudioSplitEligibility?.() ?? null,
        displayedPlayhead:
          document.querySelector<HTMLInputElement>(
            '[aria-label="Timeline position"]',
          )?.value ?? null,
        picture: picture
          ? {
              currentTime: picture.currentTime,
              duration: picture.duration,
              paused: picture.paused,
              ended: picture.ended,
              seeking: picture.seeking,
              ready: picture.readyState,
              playbackRate: picture.playbackRate,
            }
          : null,
      });
    };
    let eligibilityKey = '';
    new MutationObserver(() => {
      const state = w.avstudioSplitEligibility?.();
      if (!state) return;
      const key = JSON.stringify({
        selected: state.selectedClipId,
        pressed: state.pressedClipId,
        current: state.currentVideo1OccurrenceId,
        ready: state.ready,
        inside: state.strictlyInside,
        disabled: state.disabled,
        reason: state.reason,
      });
      if (key !== eligibilityKey) {
        eligibilityKey = key;
        w.avstudioSetupMarker?.('split-eligibility-change', state);
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'aria-describedby',
        'aria-pressed',
        'value',
      ],
    });
    document.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element)) return;
        const name = event.target.closest('button')?.getAttribute('aria-label');
        if (name === 'Split Video') w.startMatchedPostWindow?.();
        if (
          name === 'Play preview' ||
          name === 'Pause preview' ||
          name === 'Split Video'
        )
          w.avstudioSetupMarker?.('browser-click:' + name);
      },
      true,
    );
    for (const name of [
      'play',
      'playing',
      'pause',
      'ended',
      'waiting',
      'error',
    ]) {
      document.addEventListener(
        name,
        (event) => {
          if (
            event.target instanceof HTMLVideoElement &&
            event.target.closest('.program-canvas')
          )
            w.avstudioSetupMarker?.('picture-event:' + name, {
              currentTime: event.target.currentTime,
              duration: event.target.duration,
              paused: event.target.paused,
              ended: event.target.ended,
              errorCode: event.target.error?.code ?? null,
            });
        },
        true,
      );
    }
    const records: unknown[] = [];
    const mediaControlCalls: unknown[] = [];
    w.avstudioMediaControlCalls = mediaControlCalls;
    const recordControl = (
      element: HTMLMediaElement,
      name: string,
      value?: number | string,
    ) => {
      mediaControlCalls.push({
        callbackEntryTime: performance.now(),
        name,
        value,
        tag: element.tagName,
        src: element.getAttribute('src'),
        currentTime: element.currentTime,
        paused: element.paused,
        ended: element.ended,
        readyState: element.readyState,
        transport: w.avstudioTransportSnapshot?.() ?? null,
        stack: new Error().stack,
      });
    };
    (window as unknown as { boundaryRecords: unknown[] }).boundaryRecords =
      records;
    const record = (
      element: HTMLMediaElement,
      type: string,
      value?: number,
    ) => {
      records.push({
        type,
        value,
        tag: element.tagName,
        src: element.src,
        time: element.currentTime,
        now: performance.now(),
        paused: element.paused,
        seeking: element.seeking,
        ready: element.readyState,
        stack: new Error().stack?.split('\n').slice(2, 6),
        frame: document.querySelector<HTMLInputElement>(
          '[aria-label="Timeline position"]',
        )?.value,
      });
    };
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'currentTime',
    )!;
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      ...descriptor,
      set(value: number) {
        recordControl(this, 'currentTime-before', value);
        record(this, 'seek-write', value);
        descriptor.set!.call(this, value);
        recordControl(this, 'currentTime-after', value);
      },
    });
    const sourceDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'src',
    )!;
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...sourceDescriptor,
      set(value: string) {
        recordControl(this, 'src-before', value);
        sourceDescriptor.set!.call(this, value);
        recordControl(this, 'src-after', value);
      },
    });
    for (const name of ['play', 'pause'] as const) {
      const original = HTMLMediaElement.prototype[name];
      Object.defineProperty(HTMLMediaElement.prototype, name, {
        configurable: true,
        writable: true,
        value(this: HTMLMediaElement) {
          recordControl(this, name);
          if (
            (name === 'pause' && !this.paused) ||
            (name === 'play' && this.paused)
          )
            record(this, name);
          return original.call(this);
        },
      });
    }
    const originalLoad = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function () {
      recordControl(this, 'load');
      return originalLoad.call(this);
    };
  });
});
test.afterEach(async ({ page }, info) => {
  // Write an actual output file as well as attaching it: passing controls have
  // no retained trace under retain-on-failure, but their JSON must survive.
  const evidence = await page
    .evaluate(async () => {
      const w = window as ObservationWindow;
      await w.matchedPlaybackWindowPending;
      w.avstudioSetupMarker?.('complete-evidence-capture');
      return JSON.parse(
        JSON.stringify({
          matchedWindows: w.matchedPlaybackWindows ?? [],
          shortWindow: w.shortPlaybackWindow ?? null,
          setup: w.avstudioSetupDiagnostics ?? [],
          diagnostics: w.avstudioSeekDiagnostics?.records ?? [],
          mediaControlCalls: w.avstudioMediaControlCalls ?? [],
          mediaEvents: w.continuity?.events ?? [],
          presentedFrames: w.continuity?.presented ?? [],
          seeks: w.continuity?.seeks ?? [],
          sourceWrites: w.continuity?.srcWrites ?? [],
        }),
      ) as unknown;
    })
    .catch((error) => ({ captureError: String(error) }));
  const evidencePath = info.outputPath('playback-evidence.json');
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        title: info.title,
        status: info.status,
        expectedStatus: info.expectedStatus,
        evidence,
      },
      null,
      2,
    ),
  );
  await info.attach('playback-evidence.json', {
    path: evidencePath,
    contentType: 'application/json',
  });
  const setup = await page
    .evaluate(() => {
      const w = window as ObservationWindow;
      w.avstudioSetupMarker?.('test-teardown');
      return w.avstudioSetupDiagnostics ?? [];
    })
    .catch((error) => [
      { reason: 'page-unavailable-at-teardown', error: String(error) },
    ]);
  await info.attach('setup-lifecycle-diagnostics.json', {
    body: JSON.stringify(setup, null, 2),
    contentType: 'application/json',
  });
  const observation = await page
    .evaluate(() => (window as ObservationWindow).shortPlaybackWindow ?? null)
    .catch(() => null);
  await info.attach('short-playback-window-final.json', {
    body: JSON.stringify(observation, null, 2),
    contentType: 'application/json',
  });
  const diagnostics = await page
    .evaluate(
      () =>
        (
          window as unknown as {
            avstudioSeekDiagnostics?: { records: unknown[] };
          }
        ).avstudioSeekDiagnostics?.records ?? [],
    )
    .catch(() => []);
  writeFileSync(
    info.outputPath('seek-diagnostics.json'),
    JSON.stringify(diagnostics, null, 2),
  );
  await info.attach('preview-seek-final-diagnostics.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
  const records = await page
    .evaluate(
      () =>
        (window as unknown as { boundaryRecords: unknown[] }).boundaryRecords,
    )
    .catch(() => []);
  writeFileSync(
    info.outputPath('boundary-records.json'),
    JSON.stringify(records, null, 2),
  );
});

for (const speed of ['1', '0.75', '0.5'])
  for (const journey of ['split', 'uninterrupted'] as const)
    test(
      journey === 'split'
        ? `same-source split preserves decoder and presented frames at speed ${speed}`
        : `uninterrupted control preserves decoder and presented frames at speed ${speed}`,
      async ({ page }, info) => {
        const media = generateAdvancedMedia(info.outputPath('media'));
        const base60 = generateContinuityVideo(info.outputPath('continuity'));
        await page.goto('/');
        await expect(
          page.getByText('Backend ready', { exact: true }),
        ).toBeVisible();
        await page
          .getByLabel('Choose video clips', { exact: true })
          .setInputFiles([base60, media.takeA]);
        await expect(
          page.getByRole('button', { name: 'Render MP4', exact: true }),
        ).toBeEnabled();
        await page
          .getByLabel('Timeline FPS', { exact: true })
          .selectOption('25');
        await page
          .getByLabel('Speed for base60.mp4', { exact: true })
          .selectOption(speed);
        await page
          .getByRole('button', {
            name: 'Preview clip 1: base60.mp4',
            exact: true,
          })
          .click();
        const expectedSource = await page
          .getByRole('list', { name: 'Clip order', exact: true })
          .locator('video')
          .first()
          .getAttribute('src');
        await expect(
          page.getByLabel('Uploaded clip preview', { exact: true }),
        ).toHaveAttribute('src', expectedSource!);
        await expect
          .poll(() =>
            page
              .getByLabel('Uploaded clip preview', { exact: true })
              .evaluate((node) => (node as HTMLVideoElement).readyState),
          )
          .toBeGreaterThanOrEqual(2);
        await page.evaluate(() => {
          const state = {
            element: document.querySelector<HTMLVideoElement>(
              '[aria-label="Uploaded clip preview"]',
            )!,
            events: [] as unknown[],
            presented: [] as PresentedFrameEvidence[],
            srcWrites: [] as string[],
            seeks: [] as number[],
          };
          (window as unknown as { continuity: typeof state }).continuity =
            state;
          const v = state.element;
          for (const type of [
            'play',
            'playing',
            'pause',
            'waiting',
            'seeking',
            'seeked',
            'loadeddata',
            'canplay',
            'ended',
            'error',
          ])
            v.addEventListener(type, () =>
              state.events.push({
                type,
                now: performance.now(),
                time: v.currentTime,
                readyState: v.readyState,
              }),
            );
          const ct = Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype,
            'currentTime',
          )!;
          Object.defineProperty(v, 'currentTime', {
            configurable: true,
            get() {
              return ct.get!.call(v);
            },
            set(value: number) {
              state.seeks.push(value);
              ct.set!.call(v, value);
            },
          });
          const observer = new MutationObserver((records) => {
            for (const record of records)
              if (record.attributeName === 'src') state.srcWrites.push(v.src);
          });
          observer.observe(v, { attributes: true });
          const canvas = document.createElement('canvas');
          canvas.width = 16;
          canvas.height = 9;
          const context = canvas.getContext('2d', {
            willReadFrequently: true,
          })!;
          const callback = (now: number, meta: VideoFrameCallbackMetadata) => {
            const callbackEntryTime = performance.now();
            const nativeTime = v.currentTime;
            const paused = v.paused;
            const ended = v.ended;
            const readyState = v.readyState;
            const transport =
              (window as ObservationWindow).avstudioTransportSnapshot?.() ??
              null;
            context.drawImage(v, 0, 0, 16, 9);
            const rgba = context.getImageData(0, 0, 16, 9).data;
            let energy = 0;
            for (let n = 0; n < rgba.length; n += 4)
              energy += rgba[n] + rgba[n + 1] + rgba[n + 2];
            state.presented.push({
              time: now,
              callbackEntryTime,
              mediaTime: meta.mediaTime,
              presentationTime: meta.presentationTime,
              expectedDisplayTime: meta.expectedDisplayTime,
              presentedFrames: meta.presentedFrames,
              processingDuration: meta.processingDuration,
              energy,
              nativeTime,
              paused,
              ended,
              readyState,
              transport,
            });
            v.requestVideoFrameCallback(callback);
          };
          v.requestVideoFrameCallback(callback);
        });
        await markPlaybackSetup(page, 'before-play-click');
        await page
          .getByRole('button', { name: 'Play preview', exact: true })
          .click();
        await markPlaybackSetup(page, 'play-click-completed');
        await expect
          .poll(() =>
            page.getByLabel('Timeline position', { exact: true }).inputValue(),
          )
          .not.toBe('0');
        await markPlaybackSetup(page, 'playhead-nonzero-wait-completed');
        await expect
          .poll(() =>
            page.evaluate(() =>
              Number(
                document.querySelector<HTMLVideoElement>(
                  '[aria-label="Uploaded clip preview"]',
                )?.currentTime,
              ),
            ),
          )
          .toBeGreaterThan(0.3);
        await markPlaybackSetup(page, 'native-time-over-0.3-wait-completed');
        await page.evaluate(
          async ({ journey }) => {
            const w = window as ObservationWindow;
            const s = w.continuity;
            w.matchedPlaybackWindows = [];
            w.captureMatchedPlaybackWindow = (phase) => {
              const durationMs = 200; // Passive capture duration, not an acceptance bound.
              let mediaCursor = w.avstudioMediaControlCalls?.length ?? 0;
              let transportCursor =
                w.avstudioSeekDiagnostics?.records.length ?? 0;
              let frameCursor = s.presented.length;
              const sample = (origin: string) => {
                const callbackEntryTime = performance.now();
                const frame = s.presented.at(-1);
                const mediaControlCalls = (
                  w.avstudioMediaControlCalls ?? []
                ).slice(mediaCursor);
                const transportTransitions = (
                  w.avstudioSeekDiagnostics?.records ?? []
                )
                  .slice(transportCursor)
                  .filter((record) => record.label.startsWith('transport-'));
                const presentedFrames = s.presented.slice(frameCursor);
                mediaCursor = w.avstudioMediaControlCalls?.length ?? 0;
                transportCursor =
                  w.avstudioSeekDiagnostics?.records.length ?? 0;
                frameCursor = s.presented.length;
                return {
                  callbackEntryTime,
                  origin,
                  latestVideoCallback: frame
                    ? {
                        callbackEntryTime: frame.callbackEntryTime,
                        timestamp: frame.time,
                        mediaTime: frame.mediaTime,
                        presentationTime: frame.presentationTime,
                        expectedDisplayTime: frame.expectedDisplayTime,
                        presentedFrames: frame.presentedFrames,
                      }
                    : null,
                  native: {
                    currentTime: s.element.currentTime,
                    paused: s.element.paused,
                    ended: s.element.ended,
                    readyState: s.element.readyState,
                    duration: s.element.duration,
                  },
                  transport: w.avstudioTransportSnapshot?.() ?? null,
                  mediaControlCalls,
                  transportTransitions,
                  presentedFrames,
                  seekCount: s.seeks.length,
                  sourceWriteCount: s.srcWrites.length,
                };
              };
              const first = sample('start');
              const observation = {
                phase,
                journey,
                durationMs,
                startedAt: first.callbackEntryTime,
                endedAt: null as number | null,
                elapsedMs: null as number | null,
                done: false,
                samples: [first],
              };
              w.matchedPlaybackWindows!.push(observation);
              w.avstudioSetupMarker?.('matched-window-start:' + phase, {
                journey,
                durationMs,
              });
              const pending = new Promise<void>((resolve) => {
                let animation: number;
                const tick = () => {
                  observation.samples.push(sample('animation-frame'));
                  animation = requestAnimationFrame(tick);
                };
                animation = requestAnimationFrame(tick);
                // Finish even if video callbacks stop. This timer bounds passive
                // evidence collection; it never changes a playback assertion.
                window.setTimeout(() => {
                  cancelAnimationFrame(animation);
                  const last = sample('end');
                  observation.samples.push(last);
                  observation.endedAt = last.callbackEntryTime;
                  observation.elapsedMs =
                    last.callbackEntryTime - observation.startedAt;
                  observation.done = true;
                  w.avstudioSetupMarker?.('matched-window-finish:' + phase, {
                    journey,
                  });
                  resolve();
                }, durationMs);
              });
              w.matchedPlaybackWindowPending = pending;
              return pending;
            };
            let postStarted = false;
            w.startMatchedPostWindow = () => {
              if (postStarted) return;
              postStarted = true;
              void w.captureMatchedPlaybackWindow?.('post-action');
            };
            await w.captureMatchedPlaybackWindow('pre-action');
          },
          { journey },
        );
        const before = await page.evaluate(() => {
          (window as ObservationWindow).avstudioSetupMarker?.(
            'pre-observation-sample',
          );
          const s = (
            window as unknown as {
              continuity: {
                element: HTMLVideoElement;
                events: unknown[];
                presented: unknown[];
                srcWrites: string[];
                seeks: number[];
              };
            }
          ).continuity;
          return {
            now: performance.now(),
            time: s.element.currentTime,
            frame: Number(
              document.querySelector<HTMLInputElement>(
                '[aria-label="Timeline position"]',
              )!.value,
            ),
            events: s.events.length,
            presented: s.presented.length,
            srcWrites: s.srcWrites.length,
            seeks: s.seeks.length,
          };
        });
        await page.evaluate(
          ({ journey, speed }) => {
            const w = window as ObservationWindow;
            w.avstudioSetupMarker?.('observation-armed', { journey, speed });
            const s = w.continuity;
            const observation: ShortWindow = {
              journey,
              done: false,
              reason: 'armed',
              samples: [],
            };
            w.shortPlaybackWindow = observation;
            const sample = (): ShortWindowSample => ({
              now: performance.now(),
              transport: w.avstudioTransportSnapshot?.() ?? null,
              time: s.element.currentTime,
              paused: s.element.paused,
              ended: s.element.ended,
              seeking: s.element.seeking,
              ready: s.element.readyState,
              frame: Number(
                document.querySelector<HTMLInputElement>(
                  '[aria-label="Timeline position"]',
                )?.value,
              ),
              presented: s.presented.length,
              lastPresented: s.presented.at(-1)?.mediaTime ?? null,
              seeks: s.seeks.length,
              sourceWrites: s.srcWrites.length,
              pauses: s.events.filter((event) => event.type === 'pause').length,
              pauseCalls: (w.boundaryRecords ?? []).filter(
                (record) =>
                  record.type === 'pause' &&
                  record.tag === 'VIDEO' &&
                  record.src === s.element.src,
              ).length,
              same:
                document.querySelector(
                  '[aria-label="Uploaded clip preview"]',
                ) === s.element,
            });
            const start = () => {
              if (journey === 'uninterrupted') w.startMatchedPostWindow?.();
              w.avstudioSetupMarker?.('observation-start', { journey, speed });
              observation.reason = 'observing';
              const first = sample();
              observation.samples.push(first);
              const finish = (reason: string) => {
                observation.reason = reason;
                observation.done = true;
                w.avstudioSetupMarker?.('observation-finish:' + reason, {
                  journey,
                  speed,
                });
                const last = observation.samples.at(-1)!;
                observation.residualMs =
                  1000 *
                  (last.time -
                    first.time -
                    ((last.now - first.now) * speed) / 1000);
              };
              const tick = () => {
                const current = sample();
                observation.samples.push(current);
                const transport = current.transport;
                // Keep at least one second of project and source headroom. A late
                // click is an explicit invalid observation, never a continuity pass.
                if (
                  !transport ||
                  !Number.isFinite(s.element.duration) ||
                  current.time >= s.element.duration - speed ||
                  transport.projectSeconds >=
                    transport.totalFrames / transport.fps - 1
                ) {
                  finish('insufficient-eof-headroom');
                } else if (
                  transport.status !== 'playing' ||
                  !transport.playingIntent ||
                  current.paused ||
                  current.ended
                ) {
                  finish('inactive');
                } else if (
                  !current.same ||
                  current.seeks !== first.seeks ||
                  current.sourceWrites !== first.sourceWrites ||
                  current.pauses !== first.pauses ||
                  current.pauseCalls !== first.pauseCalls
                ) {
                  finish('media-interruption');
                } else if (
                  current.presented >= first.presented + 4 &&
                  current.time > first.time
                ) {
                  finish('advanced');
                } else if (current.now - first.now >= 500) {
                  // Observation deadline, not a delay or a retry of a failed window.
                  finish('progress-deadline');
                } else requestAnimationFrame(tick);
              };
              tick();
            };
            if (journey === 'uninterrupted') start();
            else {
              const onSplit = (event: MouseEvent) => {
                if (
                  !(event.target instanceof Element) ||
                  !event.target.closest('button[aria-label="Split Video"]')
                )
                  return;
                document.removeEventListener('click', onSplit);
                // React's root click handler has completed before document bubbling.
                start();
              };
              document.addEventListener('click', onSplit);
            }
          },
          { journey, speed: Number(speed) },
        );
        if (journey === 'split') {
          await waitForEligibleSplit(page, 'initial');
          await page
            .getByRole('button', { name: 'Split Video', exact: true })
            .click();
        }
        const after = await page.evaluate(() => {
          const s = (
            window as unknown as {
              continuity: {
                element: HTMLVideoElement;
                events: unknown[];
                presented: unknown[];
                srcWrites: string[];
                seeks: number[];
              };
            }
          ).continuity;
          const current = document.querySelector<HTMLVideoElement>(
            '[aria-label="Uploaded clip preview"]',
          );
          return {
            now: performance.now(),
            same: current === s.element,
            time: current?.currentTime,
            frame: Number(
              document.querySelector<HTMLInputElement>(
                '[aria-label="Timeline position"]',
              )!.value,
            ),
            paused: current?.paused,
            events: s.events,
            presented: s.presented,
            srcWrites: s.srcWrites,
            seeks: s.seeks,
          };
        });
        // Transfer the complete JSON as a string, avoiding Playwright's costly
        // recursive object serialization while the short source keeps playing.
        const previewDiagnostics = await page.evaluate(() =>
          JSON.stringify(
            (window as ObservationWindow).avstudioSeekDiagnostics?.records ??
              [],
            null,
            2,
          ),
        );
        await info.attach('preview-seek-diagnostics.json', {
          body: previewDiagnostics,
          contentType: 'application/json',
        });
        await info.attach('split-media-events.json', {
          body: JSON.stringify({ before, after }, null, 2),
          contentType: 'application/json',
        });
        writeFileSync(
          info.outputPath('split-media-events.json'),
          JSON.stringify({ before, after }, null, 2),
        );
        let windowFailure: unknown;
        try {
          await page.waitForFunction(
            () => (window as ObservationWindow).shortPlaybackWindow?.done,
            undefined,
            { polling: 'raf' },
          );
        } catch (error) {
          windowFailure = error;
        }
        const observation = await page.evaluate(
          () => (window as ObservationWindow).shortPlaybackWindow!,
        );
        await info.attach('short-playback-window.json', {
          body: JSON.stringify(observation, null, 2),
          contentType: 'application/json',
        });
        if (windowFailure) throw windowFailure;
        const first = observation.samples[0];
        const last = observation.samples.at(-1)!;
        await test.step('Playback is active at the start of the short window', async () => {
          expect(first.transport?.status).toBe('playing');
          expect(first.transport?.playingIntent).toBe(true);
          expect(first.paused).toBe(false);
          expect(first.ended).toBe(false);
        });
        await test.step('Native media and presented frames advance before EOF', async () => {
          expect(observation.reason).toBe('advanced');
          expect(last.time).toBeGreaterThan(first.time);
          expect(last.presented).toBeGreaterThan(first.presented + 3);
          expect(last.lastPresented!).toBeGreaterThan(first.lastPresented!);
        });
        await test.step('The short window has no seek, source write, or pause', async () => {
          for (const sample of observation.samples) {
            expect(sample.same).toBe(true);
            expect(sample.transport?.status).toBe('playing');
            expect(sample.transport?.playingIntent).toBe(true);
            expect(sample.paused).toBe(false);
            expect(sample.ended).toBe(false);
            expect(sample.seeks).toBe(first.seeks);
            expect(sample.sourceWrites).toBe(first.sourceWrites);
            expect(sample.pauses).toBe(first.pauses);
            expect(sample.pauseCalls).toBe(first.pauseCalls);
          }
        });
        if (journey === 'uninterrupted') return;
        expect(after.same).toBe(true);
        expect(after.srcWrites).toHaveLength(before.srcWrites);
        expect(after.seeks).toHaveLength(before.seeks);
        expect(
          Math.abs(
            after.time! -
              before.time -
              ((after.now - before.now) * Number(speed)) / 1000,
          ),
        ).toBeLessThanOrEqual(1 / 25);
        expect(after.events.slice(before.events)).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'pause' })]),
        );
        await test.step('Later transport remains active after the short window', async () => {
          await expect(
            page.getByRole('button', { name: 'Pause preview', exact: true }),
          ).toBeVisible();
        });
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as unknown as { continuity: { presented: unknown[] } })
                  .continuity.presented.length,
            ),
          )
          .toBeGreaterThan(before.presented + 3);
        const presented = await page.evaluate(() =>
          (
            window as unknown as {
              continuity: {
                presented: {
                  time: number;
                  mediaTime: number;
                  energy: number;
                }[];
              };
            }
          ).continuity.presented.map(({ time, mediaTime, energy }) => ({
            time,
            mediaTime,
            energy,
          })),
        );
        expect(presented.every((frame) => frame.energy > 0)).toBe(true);
        expect(
          presented
            .slice(before.presented + 1)
            .every(
              (frame, index) =>
                frame.mediaTime >=
                presented[before.presented + index].mediaTime,
            ),
        ).toBe(true);
        for (let split = 0; split < 2; split++) {
          await waitForEligibleSplit(page, `repeat-${split + 1}`);
          const mark = await page.evaluate(() => {
            const s = (
              window as unknown as {
                continuity: {
                  element: HTMLVideoElement;
                  events: unknown[];
                  presented: unknown[];
                  srcWrites: string[];
                  seeks: number[];
                };
              }
            ).continuity;
            return {
              events: s.events.length,
              frames: s.presented.length,
              writes: s.srcWrites.length,
              seeks: s.seeks.length,
            };
          });
          await page
            .getByRole('button', { name: 'Split Video', exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  (
                    window as unknown as {
                      continuity: { presented: unknown[] };
                    }
                  ).continuity.presented.length,
              ),
            )
            .toBeGreaterThan(mark.frames + 3);
          const state = await page.evaluate(() => {
            const s = (
              window as unknown as {
                continuity: {
                  element: HTMLVideoElement;
                  events: { type: string }[];
                  presented: { energy: number }[];
                  srcWrites: string[];
                  seeks: number[];
                };
              }
            ).continuity;
            return {
              same:
                document.querySelector(
                  '[aria-label="Uploaded clip preview"]',
                ) === s.element,
              events: s.events,
              writes: s.srcWrites.length,
              seeks: s.seeks.length,
              nonblank: s.presented.every((v) => v.energy > 0),
            };
          });
          expect(state.same).toBe(true);
          expect(state.writes).toBe(mark.writes);
          expect(state.seeks).toBe(mark.seeks);
          expect(state.nonblank).toBe(true);
          expect(
            state.events
              .slice(mark.events)
              .some((event) => event.type === 'pause'),
          ).toBe(false);
        }
      },
    );

test('replacement boundaries hand off real decoders and return without stopping transport', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
  const seek = async (frame: number) =>
    page
      .getByLabel('Timeline position', { exact: true })
      .evaluate((node, value) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(node, String(value));
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, frame);
  await seek(40);
  await page
    .getByLabel('Choose replacement video', { exact: true })
    .setInputFiles(media.takeA);
  await page
    .getByRole('button', { name: 'Save replacement', exact: true })
    .click();
  await seek(30);
  const baseUrl = await page
    .getByRole('list', { name: 'Clip order', exact: true })
    .locator('video')
    .first()
    .getAttribute('src');
  await expect(
    page.getByLabel('Uploaded clip preview', { exact: true }),
  ).toHaveAttribute('src', baseUrl!);
  await page.evaluate(() => {
    const events: unknown[] = [];
    (window as unknown as { handoffEvents: unknown[] }).handoffEvents = events;
    document
      .querySelectorAll<HTMLVideoElement>(
        '.program-canvas > video:not(.program-overlay)',
      )
      .forEach((v, index) => {
        for (const type of [
          'loadedmetadata',
          'loadeddata',
          'canplay',
          'seeking',
          'seeked',
          'waiting',
          'play',
          'playing',
          'pause',
          'error',
        ])
          v.addEventListener(type, () =>
            events.push({
              index,
              type,
              now: performance.now(),
              time: v.currentTime,
              readyState: v.readyState,
              seeking: v.seeking,
              src: v.src,
            }),
          );
      });
  });
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  try {
    await expect
      .poll(async () =>
        Number(
          await page
            .getByLabel('Timeline position', { exact: true })
            .inputValue(),
        ),
      )
      .toBeGreaterThanOrEqual(44);
  } finally {
    const data = await page.evaluate(() => ({
      events: (window as unknown as { handoffEvents: unknown[] }).handoffEvents,
      media: [
        ...document.querySelectorAll<HTMLVideoElement>(
          '.program-canvas > video:not(.program-overlay)',
        ),
      ].map((v) => ({
        src: v.src,
        readyState: v.readyState,
        seeking: v.seeking,
        time: v.currentTime,
        paused: v.paused,
        hidden: v.hidden,
      })),
    }));
    writeFileSync(
      info.outputPath('handoff-events.json'),
      JSON.stringify(data, null, 2),
    );
    await info.attach('handoff-events', {
      body: JSON.stringify(data),
      contentType: 'application/json',
    });
  }
  const takeUrl = await page
    .getByLabel('Uploaded clip preview', { exact: true })
    .getAttribute('src');
  expect(takeUrl).not.toBe(baseUrl);
  await expect
    .poll(async () =>
      Number(
        await page
          .getByLabel('Timeline position', { exact: true })
          .inputValue(),
      ),
    )
    .toBeGreaterThanOrEqual(104);
  await expect(
    page.getByLabel('Uploaded clip preview', { exact: true }),
  ).toHaveAttribute('src', baseUrl!);
  await expect(
    page.getByRole('button', { name: 'Pause preview', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.program-canvas > video:not(.program-overlay)'),
  ).toHaveCount(2);
  expect(
    await page
      .getByLabel('Uploaded clip preview', { exact: true })
      .evaluate((node) => (node as HTMLVideoElement).readyState),
  ).toBeGreaterThanOrEqual(2);
});

for (const cancel of [false, true])
  test(`genuine upcoming resource buffering ${cancel ? 'respects Pause cancellation' : 'suspends and resumes picture and sound'}`, async ({
    page,
  }, info) => {
    const media = generateAdvancedMedia(info.outputPath('buffered-media'));
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob) =>
        blob instanceof File && blob.name === 'take-a.mp4'
          ? `${location.origin}/fixtures/buffered-take.mp4`
          : create(blob);
      const voices: HTMLMediaElement[] = [];
      (
        window as unknown as { bufferedVoices: HTMLMediaElement[] }
      ).bufferedVoices = voices;
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        createMediaElementSource(element: HTMLMediaElement) {
          voices.push(element);
          return super.createMediaElementSource(element);
        }
      };
    });
    let blocked = false,
      held = 0,
      release = () => {};
    const responses = new Set<Promise<void>>();
    const delivery = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/fixtures/buffered-take.mp4', async (route) => {
      const response = (async () => {
        if (blocked) {
          held++;
          await delivery;
        }
        try {
          const bytes = readFileSync(media.takeA);
          const range = route
            .request()
            .headers()
            .range?.match(/^bytes=(\d*)-(\d*)$/);
          const start = range
            ? range[1]
              ? Number(range[1])
              : Math.max(0, bytes.length - Number(range[2]))
            : 0;
          const end =
            range && range[1] && range[2]
              ? Math.min(Number(range[2]), bytes.length - 1)
              : bytes.length - 1;
          await route.fulfill({
            status: range ? 206 : 200,
            body: bytes.subarray(start, end + 1),
            contentType: 'video/mp4',
            headers: {
              'cache-control': 'no-store',
              'accept-ranges': 'bytes',
              ...(range
                ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` }
                : {}),
            },
          });
        } catch (error) {
          if (!route.request().failure()) throw error;
        }
      })();
      responses.add(response);
      try {
        await response;
      } finally {
        responses.delete(response);
      }
    });
    try {
      await page.goto('/');
      await expect(
        page.getByText('Backend ready', { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel('Choose video clips', { exact: true })
        .setInputFiles(media.base);
      await expect(
        page.getByRole('button', { name: 'Render MP4', exact: true }),
      ).toBeEnabled();
      await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
      const seek = async (frame: number) =>
        page
          .getByLabel('Timeline position', { exact: true })
          .evaluate((node, value) => {
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value',
            )!.set!.call(node, String(value));
            node.dispatchEvent(new Event('input', { bubbles: true }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }, frame);
      await seek(40);
      await page
        .getByLabel('Choose replacement video', { exact: true })
        .setInputFiles(media.takeA);
      await expect(
        page.getByRole('button', { name: 'Save replacement', exact: true }),
      ).toBeEnabled();
      blocked = true;
      await page
        .getByRole('button', { name: 'Save replacement', exact: true })
        .click();
      await seek(30);
      await expect.poll(() => held).toBeGreaterThan(0);
      await page.evaluate(() => {
        const events: unknown[] = [];
        (window as unknown as { bufferEvents: unknown[] }).bufferEvents =
          events;
        for (const video of document.querySelectorAll<HTMLVideoElement>(
          '.program-canvas > video:not(.program-overlay)',
        ))
          for (const type of [
            'waiting',
            'canplay',
            'loadeddata',
            'playing',
            'pause',
          ])
            video.addEventListener(type, () =>
              events.push({
                type,
                time: performance.now(),
                mediaTime: video.currentTime,
                readyState: video.readyState,
              }),
            );
      });
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: /^Preparing Preview$/ }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          Number(
            await page
              .getByLabel('Timeline position', { exact: true })
              .inputValue(),
          ),
        )
        .toBeGreaterThanOrEqual(40);
      const frozen = await page
        .getByLabel('Timeline position', { exact: true })
        .inputValue();
      const sound = await page.evaluate(() =>
        (
          window as unknown as { bufferedVoices: HTMLMediaElement[] }
        ).bufferedVoices.map((v) => ({
          time: v.currentTime,
          paused: v.paused,
        })),
      );
      // Advance real browser animation frames while the actual MP4 response remains withheld.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let remaining = 12;
            const frame = () => {
              if (--remaining === 0) resolve();
              else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          }),
      );
      expect(
        await page
          .getByLabel('Timeline position', { exact: true })
          .inputValue(),
      ).toBe(frozen);
      expect(sound.every((v) => v.paused)).toBe(true);
      if (cancel)
        await page
          .getByRole('button', { name: 'Pause preview', exact: true })
          .click();
      release();
      await expect(
        page.getByRole('status').filter({ hasText: /^Preparing Preview$/ }),
      ).toHaveCount(0);
      if (cancel) {
        await expect(
          page.getByRole('button', { name: 'Play preview', exact: true }),
        ).toBeVisible();
        expect(
          await page
            .getByLabel('Timeline position', { exact: true })
            .inputValue(),
        ).toBe(frozen);
      } else {
        await expect
          .poll(async () =>
            Number(
              await page
                .getByLabel('Timeline position', { exact: true })
                .inputValue(),
            ),
          )
          .toBeGreaterThan(Number(frozen) + 3);
        await expect(
          page.getByLabel('Uploaded clip preview', { exact: true }),
        ).toHaveAttribute('src', /buffered-take/);
      }
      const evidence = await page.evaluate(() => ({
        events: (window as unknown as { bufferEvents: unknown[] }).bufferEvents,
        voices: (
          window as unknown as { bufferedVoices: HTMLMediaElement[] }
        ).bufferedVoices.map((v) => ({
          time: v.currentTime,
          paused: v.paused,
          readyState: v.readyState,
        })),
      }));
      await info.attach('genuine-buffering.json', {
        body: JSON.stringify(
          { held, cancel, frozen, sound, ...evidence },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      release();
      const diagnostic = await page
        .evaluate(() => ({
          events: (window as unknown as { bufferEvents?: unknown[] })
            .bufferEvents,
          position: document.querySelector<HTMLInputElement>(
            '[aria-label="Timeline position"]',
          )?.value,
          status: [...document.querySelectorAll('[role="status"]')].map(
            (v) => v.textContent,
          ),
          voices: (
            (window as unknown as { bufferedVoices?: HTMLMediaElement[] })
              .bufferedVoices ?? []
          ).map((v) => ({
            time: v.currentTime,
            ready: v.readyState,
            paused: v.paused,
            seeking: v.seeking,
          })),
          picture: [
            ...document.querySelectorAll<HTMLVideoElement>(
              '.program-canvas > video:not(.program-overlay)',
            ),
          ].map((v) => ({
            src: v.src,
            time: v.currentTime,
            ready: v.readyState,
            paused: v.paused,
            seeking: v.seeking,
            hidden: v.hidden,
          })),
        }))
        .catch(() => null);
      await info.attach('buffering-final-diagnostic.json', {
        body: JSON.stringify({ held, cancel, ...diagnostic }, null, 2),
        contentType: 'application/json',
      });
      writeFileSync(
        info.outputPath('buffering-final-diagnostic.json'),
        JSON.stringify({ held, cancel, ...diagnostic }, null, 2),
      );
      await Promise.allSettled([...responses]);
      await page.unroute('**/fixtures/buffered-take.mp4');
    }
  });

for (const speed of ['1', '0.75', '0.5'])
  test(`native sound buses produce distinct tones and stay aligned at speed ${speed}`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      const evidence = {
        contexts: [] as AudioContext[],
        events: [] as unknown[],
        buses: [] as { gain: GainNode; analyser: AnalyserNode; rate: number }[],
        voices: [] as HTMLMediaElement[],
        samples: [] as {
          frame: number;
          contexts: unknown[];
          time: number;
          picture: number;
          original: number;
          nativePicture: number;
          nativeOriginal: number;
          frequency: number;
          renderAhead: number;
          error: number;
          energy: number[];
        }[],
      };
      (window as unknown as { audioEvidence: typeof evidence }).audioEvidence =
        evidence;
      const Native = window.AudioContext;
      class MeasuredContext extends Native {
        constructor() {
          super();
          evidence.contexts.push(this);
        }
        createGain() {
          const gain = super.createGain(),
            analyser = super.createAnalyser(),
            connect = gain.connect.bind(gain);
          analyser.fftSize = 2048;
          gain.connect = ((destination: AudioNode) => {
            if (destination === this.destination) {
              connect(analyser);
              analyser.connect(destination);
              return destination;
            }
            return connect(destination);
          }) as typeof gain.connect;
          evidence.buses.push({ gain, analyser, rate: this.sampleRate });
          return gain;
        }
        createMediaElementSource(element: HTMLMediaElement) {
          evidence.voices.push(element);
          for (const type of [
            'play',
            'playing',
            'pause',
            'waiting',
            'seeking',
            'seeked',
            'ended',
            'error',
          ])
            element.addEventListener(type, () =>
              evidence.events.push({
                type,
                time: performance.now(),
                source: element.src,
                mediaTime: element.currentTime,
              }),
            );
          return super.createMediaElementSource(element);
        }
      }
      window.AudioContext = MeasuredContext;
      const presented = new WeakMap<
          HTMLVideoElement,
          { mediaTime: number; displayTime: number }
        >(),
        watching = new WeakSet<HTMLVideoElement>();
      const watch = (video: HTMLVideoElement) => {
        if (watching.has(video)) return;
        watching.add(video);
        const callback = (_time: number, frame: VideoFrameCallbackMetadata) => {
          presented.set(video, {
            mediaTime: frame.mediaTime,
            displayTime: frame.expectedDisplayTime,
          });
          video.requestVideoFrameCallback(callback);
        };
        video.requestVideoFrameCallback(callback);
      };
      const measure = ({
        analyser,
        rate,
      }: {
        analyser: AnalyserNode;
        rate: number;
      }) => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let power = 0;
        const crossings: number[] = [];
        for (let n = 0; n < data.length; n++) {
          power += data[n] * data[n];
          if (n && data[n - 1] <= 0 && data[n] > 0)
            crossings.push(n - 1 - data[n - 1] / (data[n] - data[n - 1]));
        }
        return {
          energy: power / data.length,
          frequency:
            crossings.length >= 8
              ? ((crossings.length - 1) * rate) /
                (crossings.at(-1)! - crossings[0])
              : null,
          window: data.length / rate,
        };
      };
      const tick = () => {
        const picture = document.querySelector<HTMLVideoElement>(
            '[aria-label="Uploaded clip preview"]',
          ),
          original = evidence.voices.find(
            (v) => v.src === picture?.src && !v.paused && !v.seeking,
          );
        if (picture) watch(picture);
        const frame = picture ? presented.get(picture) : undefined,
          preparing = [...document.querySelectorAll('[role="status"]')].some(
            (node) => node.textContent?.trim() === 'Preparing Preview',
          );
        if (
          picture &&
          !picture.paused &&
          !picture.seeking &&
          frame &&
          frame.mediaTime > 0.3 &&
          original &&
          !preparing
        ) {
          const output = evidence.buses.map(measure),
            sound = output[0];
          if (sound?.frequency && sound.energy > 0.000001) {
            // The analyser reads render-ahead PCM. Convert its window centre
            // to audible device time, just like the edit-parity worklet probe.
            const ctx = evidence.contexts[0];
            const stamp = ctx.getOutputTimestamp();
            const audibleContextTime =
              stamp.contextTime +
              (performance.now() - stamp.performanceTime) / 1000;
            const renderAhead = Math.max(
              0,
              ctx.currentTime - audibleContextTime,
            );
            const source =
              (sound.frequency - 440) / 400 +
              (sound.window * original.playbackRate) / 2 -
              renderAhead * original.playbackRate;
            const pictureTime = picture.currentTime;
            evidence.samples.push({
              frame: Number(
                document.querySelector<HTMLInputElement>(
                  '[aria-label="Timeline position"]',
                )?.value,
              ),
              contexts: evidence.contexts.map((c) => ({
                state: c.state,
                time: c.currentTime,
                latency: c.baseLatency,
              })),
              time: performance.now(),
              picture: pictureTime,
              original: source,
              nativePicture: picture.currentTime,
              nativeOriginal: original.currentTime,
              frequency: sound.frequency,
              renderAhead,
              error: Math.abs(pictureTime - source) / original.playbackRate,
              energy: output.map((v) => v.energy),
            });
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const media = generateAdvancedMedia(info.outputPath('media')),
      base60 = generateContinuityVideo(info.outputPath('continuity'), true);
    await page.goto('/');
    await expect(
      page.getByText('Backend ready', { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('Choose video clips', { exact: true })
      .setInputFiles(base60);
    await expect(
      page.getByRole('button', { name: 'Render MP4', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
    await page
      .getByLabel('Speed for base60.mp4', { exact: true })
      .selectOption(speed);
    await page
      .getByLabel('Choose background audio', { exact: true })
      .setInputFiles(media.music);
    await page
      .locator('.inspector details[data-section="audio"] > summary')
      .click();
    await expect(
      page.getByRole('button', { name: 'Remove song.wav', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Preview clip 1: base60.mp4', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Play preview', exact: true })
      .click();
    try {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { audioEvidence: { samples: unknown[] } })
                .audioEvidence.samples.length,
          ),
        )
        .toBeGreaterThan(20);
    } finally {
      const diagnostic = await page.evaluate(() => {
        const e = (
          window as unknown as {
            audioEvidence: {
              events: unknown[];
              samples: unknown[];
              contexts: AudioContext[];
              voices: HTMLMediaElement[];
            };
          }
        ).audioEvidence;
        return {
          events: e.events,
          samples: e.samples,
          contexts: e.contexts.map((c) => ({
            state: c.state,
            time: c.currentTime,
          })),
          voices: e.voices.map((v) => ({
            src: v.src,
            time: v.currentTime,
            ready: v.readyState,
            seeking: v.seeking,
            paused: v.paused,
          })),
          picture: [
            ...document.querySelectorAll<HTMLVideoElement>(
              '.program-canvas > video:not(.program-overlay)',
            ),
          ].map((v) => ({
            src: v.src,
            time: v.currentTime,
            ready: v.readyState,
            seeking: v.seeking,
            paused: v.paused,
            hidden: v.hidden,
          })),
        };
      });
      writeFileSync(
        info.outputPath('audio-readiness-diagnostic.json'),
        JSON.stringify(diagnostic, null, 2),
      );
    }
    const data = await page.evaluate(() => {
      const e = (
        window as unknown as {
          audioEvidence: {
            events: unknown[];
            samples: { error: number; energy: number[] }[];
            buses: { gain: GainNode }[];
            voices: HTMLMediaElement[];
          };
        }
      ).audioEvidence;
      return {
        events: e.events,
        samples: e.samples,
        buses: e.buses.map((v) => v.gain.gain.value),
        voices: e.voices.map((v) => ({
          src: v.src,
          rate: v.playbackRate,
          preservesPitch: v.preservesPitch,
          muted: v.muted,
          volume: v.volume,
        })),
      };
    });
    writeFileSync(
      info.outputPath('actual-audio-output.json'),
      JSON.stringify(data, null, 2),
    );
    expect(data.buses).toHaveLength(2);
    expect(data.buses[0]).toBeCloseTo(1, 6);
    expect(data.buses[1]).toBeCloseTo(0.3, 6);
    expect(data.voices.length).toBeLessThanOrEqual(4);
    expect(Math.max(...data.samples.map((v) => v.energy[0]))).toBeGreaterThan(
      0.00001,
    );
    expect(Math.max(...data.samples.map((v) => v.energy[1]))).toBeGreaterThan(
      0.000003,
    );
    expect(Math.max(...data.samples.map((v) => v.error))).toBeLessThanOrEqual(
      0.05,
    );
    expect(data.voices.every((v) => v.preservesPitch)).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Pause preview', exact: true }),
    ).toBeVisible();
  });
