import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { generateAudioTailVideo, probeDownloadedMp4 } from './mediaFixtures';
import { decodedAudio } from './audioParityFixtures';

let clip: string;
test.beforeAll(({ browserName }, info) => {
  void browserName;
  clip =
    process.env.AVSTUDIO_REPRESENTATIVE_CLIP ??
    generateAudioTailVideo(info.outputPath('media'));
});
test.beforeEach(async ({ page }) => {
  const backend = process.env.AVSTUDIO_VERIFY_BACKEND;
  if (backend)
    await page.route(/\/src\/lib\/api\.ts(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      expect(body).toContain('const base =');
      await route.fulfill({
        response,
        body: body.replace(
          /const base = [\s\S]*?;/,
          `const base = ${JSON.stringify(backend)};`,
        ),
      });
    });
});

test('changing speed in an existing editor session keeps preview playable', async ({
  page,
}, info) => {
  const network: unknown[] = [],
    observations: unknown[] = [],
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/preview-audio'))
      network.push({ event: 'request', url: request.url() });
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/preview-audio')) {
      const request = response.request();
      network.push({
        status: response.status(),
        url: response.url(),
        method: request.method(),
      });
      if (!response.ok())
        void response
          .text()
          .then((body) => {
            network.push({ status: response.status(), body });
          })
          .catch(() => {});
    }
  });
  page.on('requestfailed', (request) =>
    network.push({ url: request.url(), failure: request.failure() }),
  );
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
      const originalSnapshot = controller.getSnapshot;
      controller.getSnapshot = function() {
        window.slowTransportSnapshot = () => ({status: runtime.status, intent: runtime.intent,
          position: runtime.position, totalFrames: runtime.timeline.totalFrames, fps: runtime.timeline.fps,
          generation: runtime.generation, positionRevision: runtime.positionRevision,
          pending: runtime.pending, readiness: [...readiness] });
        return originalSnapshot.call(this);
      };
      return controller;`,
        ),
      });
    },
  );
  await page.route(
    /\/src\/hooks\/useProjectAudio\.ts(?:\?|$)/,
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      expect(body).toContain('get status() {');
      await route.fulfill({
        response,
        body: body.replace(
          'get status() {',
          `get status() {
      const diagnosticNodes = window.slowEnergyAnalysers ??= new WeakMap();
      window.slowAudioSnapshot = () => ({status, message, generation, gate, graphReady,
        busGains: buses.map(bus => bus.gain.value),
        energy: buses.map(bus => {
          let node = diagnosticNodes.get(bus);
          if (!node && context) {
            node = context.createAnalyser(); bus.connect(node); diagnosticNodes.set(bus, node);
          }
          if (!node) return 0;
          const values = new Float32Array(node.fftSize); node.getFloatTimeDomainData(values);
          return values.reduce((sum, v) => sum + v * v, 0) / values.length;
        }),
        preparingRecipe, recipeFailure, heldAtCommit, committedOptions,
        context: context && {state: context.state, time: context.currentTime},
        transport: { generation: latest.transport.generation, intent: latest.transport.playingIntent,
          playing: latest.transport.playing },
        recipes: [...recipes].map(([key,r]) => ({key, url: r.url, error: r.error,
          aborted: r.controller.signal.aborted})),
        voices: pools.flat().filter(Boolean).map(v => ({time:v.element.currentTime,
          duration:v.element.duration, paused:v.element.paused, seeking:v.element.seeking,
          ready:v.element.readyState, ended:v.element.ended, sourceKey:v.sourceKey,
          accepted:v.accepted, pending:v.pending, rate:v.element.playbackRate})) });`,
        ),
      });
    },
  );
  const snapshot = async (phase: string) => {
    const value = await page.evaluate(() => {
      const w = window as unknown as {
        slowTransportSnapshot?: () => {
          status: string;
          intent: boolean;
          pending: number | null;
        };
        slowAudioSnapshot?: () => {
          status: string;
          energy: number[];
          voices: { time: number; paused: boolean }[];
        };
      };
      return {
        transport: w.slowTransportSnapshot?.(),
        sound: w.slowAudioSnapshot?.(),
        picture: [
          ...document.querySelectorAll<HTMLVideoElement>(
            '.program-canvas > video:not(.program-overlay)',
          ),
        ]
          .filter((v) => !v.hidden)
          .map((v) => ({
            time: v.currentTime,
            paused: v.paused,
            seeking: v.seeking,
            ready: v.readyState,
            ended: v.ended,
            rate: v.playbackRate,
          })),
        visible: [...document.querySelectorAll('[role="status"]')].map(
          (v) => v.textContent,
        ),
      };
    });
    observations.push({ phase, ...value });
    return value;
  };
  const advance = async (phase: string) => {
    await expect
      .poll(async () => {
        const state = await snapshot(phase + '-ready');
        return (
          state.transport?.status === 'playing' &&
          state.transport.intent &&
          state.transport.pending === null &&
          state.sound?.status === 'ready' &&
          state.sound.energy.some((value) => value > 0.00001) &&
          state.picture.some((v) => !v.paused) &&
          state.sound?.voices.some((v) => !v.paused)
        );
      })
      .toBe(true);
    const before = await snapshot(phase + '-before');
    await expect
      .poll(async () => {
        const after = await snapshot(phase);
        return (
          after.picture.some(
            (v, i) =>
              !v.paused && v.time > (before.picture[i]?.time ?? 0) + 0.15,
          ) &&
          after.sound?.voices.some(
            (v, i) =>
              !v.paused && v.time > (before.sound?.voices[i]?.time ?? 0) + 0.15,
          )
        );
      })
      .toBe(true);
  };
  try {
    await page.goto(
      process.env.AVSTUDIO_VERIFY_BACKEND ? 'http://localhost:5173/' : '/',
    );
    await expect(
      page.getByText('Backend ready', { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('Choose video clips', { exact: true })
      .setInputFiles(clip);
    await expect(
      page.getByRole('button', { name: 'Render MP4', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Play preview', exact: true })
      .click();
    await advance('normal');
    await page
      .getByRole('button', { name: 'Pause preview', exact: true })
      .click();
    for (const speed of ['0.75', '0.5', '1']) {
      await page
        .getByLabel(`Speed for ${basename(clip)}`, { exact: true })
        .selectOption(speed);
      await snapshot('speed-selected-' + speed);
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      await advance('changed-speed-' + speed);
      await page
        .getByRole('button', { name: 'Pause preview', exact: true })
        .click();
      await snapshot('paused-' + speed);
    }
  } finally {
    writeFileSync(
      info.outputPath('session.json'),
      JSON.stringify({ observations, network, errors }, null, 2),
    );
  }
});

for (const [speed, frames] of [
  ['0.75', 225],
  ['0.5', 338],
] as const) {
  test(`portrait clip still renders picture and sound at speed ${speed}`, async ({
    page,
  }, info) => {
    await page.goto(
      process.env.AVSTUDIO_VERIFY_BACKEND ? 'http://localhost:5173/' : '/',
    );
    await expect(
      page.getByText('Backend ready', { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('Choose video clips', { exact: true })
      .setInputFiles(clip);
    await expect(
      page.getByRole('button', { name: 'Render MP4', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('Timeline FPS', { exact: true }).selectOption('30');
    await page
      .getByLabel(`Speed for ${basename(clip)}`, { exact: true })
      .selectOption(speed);
    await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
    const link = page.getByRole('link', { name: 'Download MP4', exact: true });
    await expect(link).toBeVisible({ timeout: 90000 });
    const pending = page.waitForEvent('download');
    await link.click();
    const output = info.outputPath(`slow-${speed}.mp4`);
    await (await pending).saveAs(output);
    const picture = probeDownloadedMp4(output);
    expect(picture.frames).toBe(frames);
    expect(picture.fps).toBe(30);
    const sound = decodedAudio(output);
    expect(sound.length).toBeGreaterThan(48000);
    expect(
      sound.reduce((sum, value) => sum + value * value, 0) / sound.length,
    ).toBeGreaterThan(0.00001);
    writeFileSync(
      info.outputPath('render-result.json'),
      JSON.stringify({ speed, picture, audioSamples: sound.length }, null, 2),
    );
  });
}
