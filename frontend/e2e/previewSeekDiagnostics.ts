import type { Page } from '@playwright/test';

// Temporary diagnostics: instrument only browser responses used by this test.
// Application source, guards, media operations, and assertions stay unchanged.
export async function installPreviewSeekDiagnostics(page: Page) {
  await page.addInitScript(() => {
    const state = {
      records: [] as unknown[],
      voices: [] as HTMLMediaElement[],
      record(label: string, details: unknown) {
        const media = (element: HTMLMediaElement) => ({
          src: element.getAttribute('src'),
          time: element.currentTime,
          paused: element.paused,
          seeking: element.seeking,
          ready: element.readyState,
          rate: element.playbackRate,
        });
        state.records.push({
          now: performance.now(),
          label,
          details,
          frame: document.querySelector<HTMLInputElement>(
            '[aria-label="Timeline position"]',
          )?.value,
          preparing: [...document.querySelectorAll('[role="status"]')].some(
            (node) => node.textContent?.trim() === 'Preparing Preview',
          ),
          picture: [
            ...document.querySelectorAll<HTMLVideoElement>(
              '.program-canvas > video:not(.program-overlay)',
            ),
          ].map(media),
          audio: state.voices.map(media),
        });
      },
    };
    Object.assign(window, { avstudioSeekDiagnostics: state });
    const original = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (element) {
      state.voices.push(element);
      return original.call(this, element);
    };
  });
  await page.route(
    /\/src\/hooks\/use(PreviewMedia|ProjectPlayback|ProjectAudio)\.ts(?:\?|$)/,
    async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      const inject = (pattern: RegExp, replacement: string) => {
        if (!pattern.test(body))
          throw new Error(`Diagnostic marker missing: ${pattern}`);
        body = body.replace(pattern, replacement);
      };
      const url = route.request().url();
      if (url.includes('/usePreviewMedia.ts')) {
        inject(
          /const retired = fresh && request\?\.waiting \? request.token : null;/,
          `$&
        if (fresh || resumed || mappingChanged) __avstudioTrace('picture-decision', {
          projectSeconds: seconds, frame: o.frame, generation: o.generation,
          positionRevision: o.positionRevision, playing: o.playing,
          sourceChanged, positionChanged, mappingChanged, fresh, resumed,
          origin, mappingTolerance, adjacentLegacyEdit, pausedTime,
          request: request && { ...request, clip: {
            id: request.clip.id, trim: request.clip.trim,
            speed: request.clip.speed, outputWindow: request.clip.outputWindow
          }}, current: { sourceTime: current.sourceTime, id: current.clip.id,
            trim: current.clip.trim, outputWindow: current.clip.outputWindow }
        });`,
        );
        inject(
          /if \(request\.needsPosition\) \{/,
          `$& __avstudioTrace('picture-position-request', {
          positionTime, resumed, fresh, sourceChanged, positionChanged,
          mappingChanged, generation: o.generation,
          positionRevision: o.positionRevision, request: { ...request }
        });`,
        );
        inject(
          /e.currentTime = Math.max\(0, time\);/,
          `{ __avstudioTrace('picture-seek-before', { requested: time, index,
          generation: latest.generation, positionRevision: latest.positionRevision,
          projectSeconds: latest.projectSeconds, request: request && { ...request },
          stack: new Error().stack });
          $&
          __avstudioTrace('picture-seek-after', { requested: time, index }); }`,
        );
      } else if (url.includes('/useProjectPlayback.ts')) {
        inject(
          /applyEdit\(edit, anchor\) \{/,
          `$& __avstudioTrace('transport-edit', { action: edit.action, anchor,
          runtime: { ...runtime }, readiness: [...readiness] });`,
        );
        inject(
          /observePicture\(seconds, presentedAt\) \{/,
          `$& __avstudioTrace('picture-clock-observation', { seconds, presentedAt,
          runtime: { ...runtime } });`,
        );
        for (const method of ['suspend', 'ready', 'seek']) {
          inject(
            new RegExp(`${method}\\((token|frame)\\) \\{`),
            `$& __avstudioTrace('transport-${method}', {
            value: arguments[0], runtime: { ...runtime }, readiness: [...readiness]
          });`,
          );
        }
      } else {
        inject(
          /const ensureGate = \(\) => \{/,
          `$& __avstudioTrace('audio-gate', { gate, generation,
          graphReady, status, anchor: latest.transport.captureAnchor() });`,
        );
        inject(
          /\.catch\(\(error\) => \{/,
          `$& __avstudioTrace('audio-play-rejection', { name: error?.name,
          message: error?.message, generation: latest.transport.generation,
          anchor: latest.transport.captureAnchor() });`,
        );
      }
      const prefix = `const __avstudioTrace = (label, details) => {
      window.avstudioSeekDiagnostics?.record(label, details);
    };\n`;
      await route.fulfill({ response, body: prefix + body });
    },
  );
}
