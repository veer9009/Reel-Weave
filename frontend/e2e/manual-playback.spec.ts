import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { generateContinuityVideo } from './mediaFixtures';
import { installPreviewSeekDiagnostics } from './previewSeekDiagnostics';

// Exercise ordinary imported-clip playback without preview selection, music,
// a forced project FPS, or a test-only transport action.
for (const speed of ['1', '0.75', '0.5']) {
  test(`manual playback starts, resumes and replays at speed ${speed}`, async ({
    page,
  }, info) => {
    const video = generateContinuityVideo(info.outputPath('media'), true);
    await installPreviewSeekDiagnostics(page);
    await page.route(
      /\/src\/hooks\/useProjectPlayback\.ts(?:\?|$)/,
      async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        expect(body).toContain('return controller;');
        await route.fulfill({
          response,
          body: body.replace(
            'return controller;',
            `
        const readSnapshot = () => ({ status: runtime.status, intent: runtime.intent,
          position: runtime.position, fps: runtime.timeline.fps,
          totalFrames: runtime.timeline.totalFrames, pending: runtime.pending,
          readiness: [...readiness], generation: runtime.generation });
        const originalSnapshot = controller.getSnapshot;
        controller.getSnapshot = function() {
          window.manualPlaybackSnapshot = readSnapshot;
          return originalSnapshot.call(this);
        };
        for (const name of ['toggle', 'pause', 'suspend', 'ready', 'fail']) {
          const original = controller[name];
          controller[name] = function(...args) {
            const before = readSnapshot();
            try { return original.apply(this, args); }
            finally { window.avstudioSeekDiagnostics?.record('manual-' + name,
              { args, before, after: readSnapshot() }); }
          };
        }
        return controller;`,
          ),
        });
      },
    );
    await page.addInitScript(() => {
      const nodes: AnalyserNode[] = [];
      const create = AudioContext.prototype.createMediaElementSource;
      AudioContext.prototype.createMediaElementSource = function (element) {
        const node = create.call(this, element);
        const analyser = this.createAnalyser();
        node.connect(analyser);
        nodes.push(analyser);
        for (const name of ['ended', 'waiting', 'error'])
          element.addEventListener(name, () => {
            (
              window as unknown as {
                avstudioSeekDiagnostics?: {
                  record: (label: string, details: unknown) => void;
                };
              }
            ).avstudioSeekDiagnostics?.record('sound-' + name, {
              time: element.currentTime,
              duration: element.duration,
              error: element.error?.message,
            });
          });
        return node;
      };
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const promise = play.call(this);
        if (this instanceof HTMLAudioElement)
          void promise.catch((error) => {
            (
              window as unknown as {
                avstudioSeekDiagnostics?: {
                  record: (label: string, details: unknown) => void;
                };
              }
            ).avstudioSeekDiagnostics?.record('sound-play-error', {
              name: error.name,
              message: error.message,
              time: this.currentTime,
              duration: this.duration,
            });
          });
        return promise;
      };
      Object.assign(window, {
        manualAudioEnergy: () =>
          nodes.map((node) => {
            const values = new Float32Array(node.fftSize);
            node.getFloatTimeDomainData(values);
            return values.reduce((sum, v) => sum + v * v, 0) / values.length;
          }),
      });
    });
    const observations: unknown[] = [];
    const snapshot = async (phase: string) => {
      const value = await page.evaluate(() => {
        const w = window as unknown as {
          manualPlaybackSnapshot?: () => unknown;
          manualAudioEnergy: () => number[];
          avstudioSeekDiagnostics: { voices: HTMLAudioElement[] };
        };
        const media = (e: HTMLMediaElement) => ({
          time: e.currentTime,
          duration: e.duration,
          paused: e.paused,
          ended: e.ended,
          ready: e.readyState,
          seeking: e.seeking,
        });
        return {
          transport: w.manualPlaybackSnapshot?.(),
          picture: [
            ...document.querySelectorAll<HTMLVideoElement>(
              '.program-canvas > video:not(.program-overlay)',
            ),
          ]
            .filter((e) => !e.hidden)
            .map(media),
          audio: w.avstudioSeekDiagnostics.voices.map(media),
          energy: w.manualAudioEnergy(),
          status: [...document.querySelectorAll('[role="status"]')].map(
            (e) => e.textContent,
          ),
        };
      });
      observations.push({ phase, ...value });
      return value;
    };
    const advance = async (phase: string) => {
      const before = await snapshot(phase + '-before');
      await expect
        .poll(async () => {
          const after = await snapshot(phase);
          return (
            after.picture.some(
              (p, i) =>
                !p.paused && p.time > (before.picture[i]?.time ?? 0) + 0.15,
            ) &&
            after.audio.some(
              (a, i) =>
                !a.paused && a.time > (before.audio[i]?.time ?? 0) + 0.15,
            ) &&
            after.energy.some((e) => e > 0.00001)
          );
        })
        .toBe(true);
    };
    try {
      await page.goto('/');
      await expect(
        page.getByText('Backend ready', { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel('Choose video clips', { exact: true })
        .setInputFiles(video);
      await expect(
        page.getByRole('button', { name: 'Render MP4', exact: true }),
      ).toBeEnabled();
      await page
        .getByLabel('Speed for base60.mp4', { exact: true })
        .selectOption(speed);
      await snapshot('imported');
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      await advance('ordinary');
      await page
        .getByRole('button', { name: 'Pause preview', exact: true })
        .click();
      const paused = await snapshot('paused');
      await page.waitForTimeout(200);
      const held = await snapshot('pause-held');
      expect(
        Math.abs(held.picture[0].time - paused.picture[0].time),
      ).toBeLessThanOrEqual(0.04);
      expect(held.picture.every((v) => v.paused)).toBe(true);
      expect(held.audio.every((v) => v.paused)).toBe(true);
      for (const [index, voice] of held.audio.entries())
        expect(
          Math.abs(voice.time - paused.audio[index].time),
        ).toBeLessThanOrEqual(0.04);
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      await advance('resumed');
      await expect(
        page.getByRole('button', { name: 'Play preview', exact: true }),
      ).toBeVisible();
      const end = await snapshot('natural-end');
      const transport = end.transport as {
        position: number;
        totalFrames: number;
      };
      expect(transport.position).toBe(transport.totalFrames - 1);
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      // Restart crosses from the final source frame to zero.
      await expect
        .poll(async () => (await snapshot('replay-start')).picture[0]?.time)
        .toBeLessThan(2);
      await advance('replayed');
    } finally {
      writeFileSync(
        info.outputPath('manual-playback.json'),
        JSON.stringify(
          {
            speed,
            observations,
            diagnostics: await page
              .evaluate(
                () =>
                  (window as unknown as { avstudioSeekDiagnostics?: unknown })
                    .avstudioSeekDiagnostics,
              )
              .catch(() => null),
          },
          null,
          2,
        ),
      );
    }
  });
}
