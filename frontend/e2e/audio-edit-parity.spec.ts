import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateAudioParityMedia,
  parityProject,
  installPreviewCapture,
  capturePreviewPcm,
  expectedEvents,
  expectedFrequency,
  toneAmplitude,
  decodedAudio,
} from './audioParityFixtures';
import type { AudioLane, ParityMedia } from './audioParityFixtures';

let media: ParityMedia;
for (const lane of ['independent', 'detached', 'music'] as const)
  test(`running ${lane} split preserves native audio decoder continuity`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      const probe = { active: false, events: [] as string[] };
      Object.assign(window, { runningAudioSplitProbe: probe });
      const time = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'currentTime',
      )!;
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        ...time,
        set(this: HTMLMediaElement, value: number) {
          if (probe.active && this instanceof HTMLAudioElement)
            probe.events.push('seek');
          time.set!.call(this, value);
        },
      });
      for (const key of ['load', 'pause'] as const) {
        const native = HTMLMediaElement.prototype[key];
        HTMLMediaElement.prototype[key] = function (this: HTMLMediaElement) {
          if (probe.active && this instanceof HTMLAudioElement)
            probe.events.push(key);
          return native.call(this);
        };
      }
    });
    await page.goto('/');
    await expect(
      page.getByText('Backend ready', { exact: true }),
    ).toBeVisible();
    const projectDocument = parityProject(media, lane);
    (lane === 'music'
      ? projectDocument.edit.music
      : projectDocument.edit.independentAudio)[0].durationFrames = 100;
    await open(page, Buffer.from(JSON.stringify(projectDocument)), [
      media.picture,
      media.sourceA,
    ]);
    await page
      .getByRole('button', {
        name:
          lane === 'music'
            ? /Select Background music/
            : /Original\/Replacement Audio .*start 0, 100 frames/,
      })
      .click();
    await seek(page, 0);
    await page
      .getByRole('button', { name: 'Play preview', exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLVideoElement>(
          '[aria-label="Uploaded clip preview"]',
        )!.currentTime >= 0.3,
    );
    const anchor = await page.evaluate(() => {
      const probe = (
        window as unknown as {
          runningAudioSplitProbe: { active: boolean; events: string[] };
        }
      ).runningAudioSplitProbe;
      probe.events = [];
      probe.active = true;
      const video = document.querySelector<HTMLVideoElement>(
        '[aria-label="Uploaded clip preview"]',
      )!;
      const time = video.currentTime;
      document
        .querySelector<HTMLButtonElement>('[aria-label="Split Audio"]')!
        .click();
      return time;
    });
    await page.waitForFunction(
      (start) =>
        document.querySelector<HTMLVideoElement>(
          '[aria-label="Uploaded clip preview"]',
        )!.currentTime >=
        start + 0.3,
      anchor,
    );
    const events = await page.evaluate(() => {
      const probe = (
        window as unknown as {
          runningAudioSplitProbe: { active: boolean; events: string[] };
        }
      ).runningAudioSplitProbe;
      probe.active = false;
      return probe.events;
    });
    writeFileSync(
      info.outputPath('native-audio-events.json'),
      JSON.stringify(events),
    );
    expect(events).toEqual([]);
    const start = Number(
      await page
        .getByLabel(
          lane === 'music'
            ? 'Timeline start frame'
            : 'Audio timeline start frame',
          { exact: true },
        )
        .inputValue(),
    );
    const offset = Number(
      await page
        .getByLabel(
          lane === 'music'
            ? 'Source start sample (48 kHz)'
            : 'Audio source start sample',
          { exact: true },
        )
        .inputValue(),
    );
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(100);
    expect(offset).toBe(start * 1920);
  });
test.beforeAll(({ baseURL }, info) => {
  expect(baseURL).toBeTruthy();
  media = generateAudioParityMedia(info.outputPath('parity-media'));
});

async function open(page: Page, bytes: Buffer, files: string[]) {
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({
    name: 'parity.avstudio.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  const dialog = page.getByRole('dialog', { name: 'Open Project' });
  await dialog.getByLabel('Choose project media files').setInputFiles(files);
  await expect(
    dialog.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole('button', { name: 'Open Project', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function seek(page: Page, frame: number) {
  await page
    .getByLabel('Timeline position', { exact: true })
    .evaluate((node, value) => {
      const input = node as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, frame);
}
function segment(page: Page, lane: AudioLane, left = false) {
  if (lane === 'music')
    return page.getByRole('button', {
      name: left
        ? /Select Background music.*frames 0–24/
        : /Select Background music.*frames 25–49/,
    });
  return page.getByRole('button', {
    name: left
      ? /Original\/Replacement Audio .*start 0, 25 frames/
      : /Original\/Replacement Audio .*start 25, 25 frames/,
  });
}
function assertTone(
  values: readonly number[] | Float32Array,
  wanted: number,
  rate: number,
) {
  expect(values.length).toBeGreaterThan(0);
  const rms = Math.sqrt(
    Array.from(values).reduce((sum, v) => sum + v * v, 0) / values.length,
  );
  if (!wanted) {
    expect(rms).toBeLessThan(0.001);
    return;
  }
  const amplitude = toneAmplitude(values, wanted, rate);
  expect(amplitude).toBeGreaterThan(0.006);
  for (const excluded of [330, 440, 660, 990, 1100].filter((v) => v !== wanted))
    expect(amplitude * amplitude).toBeGreaterThan(
      20 * toneAmplitude(values, excluded, rate) ** 2,
    );
}

for (const lane of ['independent', 'detached', 'music'] as const)
  for (const action of [
    'split',
    'move',
    'trim-start',
    'trim-end',
    'delete',
    'lift',
    'replace',
  ] as const)
    test(`${lane} ${action}: actual preview and four exports preserve authored audio events`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1536, height: 1024 });
      await installPreviewCapture(page);
      await page.goto('/');
      await expect(
        page.getByText('Backend ready', { exact: true }),
      ).toBeVisible();
      await open(
        page,
        Buffer.from(JSON.stringify(parityProject(media, lane))),
        [media.picture, media.sourceA],
      );
      const initial =
        lane === 'music'
          ? page.getByRole('button', { name: /Select Background music/ })
          : page.getByRole('button', {
              name: /Original\/Replacement Audio .*start 0, 50 frames/,
            });
      await initial.click();
      await seek(page, 25);
      await page
        .getByRole('button', { name: 'Split Audio', exact: true })
        .click();
      await expect(segment(page, lane)).toBeVisible();
      if (['move', 'trim-start', 'trim-end'].includes(action)) {
        const music = lane === 'music';
        if (action === 'move')
          await page
            .getByLabel(
              music ? 'Timeline start frame' : 'Audio timeline start frame',
              { exact: true },
            )
            .fill('50');
        if (action === 'trim-start') {
          await page
            .getByLabel(
              music ? 'Timeline start frame' : 'Audio timeline start frame',
              { exact: true },
            )
            .fill('30');
          await page
            .getByLabel(
              music
                ? 'Source start sample (48 kHz)'
                : 'Audio source start sample',
              { exact: true },
            )
            .fill('57600');
          await page
            .getByLabel(
              music ? 'Music duration frames' : 'Audio duration frames',
              { exact: true },
            )
            .fill('20');
        }
        if (action === 'trim-end')
          await page
            .getByLabel(
              music ? 'Music duration frames' : 'Audio duration frames',
              { exact: true },
            )
            .fill('20');
        await page
          .getByRole('button', {
            name: music ? 'Save timeline range' : 'Save audio range',
            exact: true,
          })
          .click();
      }
      if (action === 'delete' || action === 'lift') {
        await segment(page, lane, true).click();
        await page
          .getByRole('button', {
            name:
              action === 'delete'
                ? 'Ripple Delete selected'
                : lane === 'music'
                  ? 'Lift selected music'
                  : 'Lift selected audio',
            exact: true,
          })
          .click();
      }
      if (action === 'replace') {
        await page
          .getByLabel('Replace Audio', { exact: true })
          .setInputFiles(lane === 'music' ? media.compressed : media.sourceB);
        await expect(
          page.getByRole('button', {
            name:
              lane === 'music'
                ? /Select Background music.*parity-b/
                : /Original\/Replacement Audio parity-b.wav: start 25/,
          }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
      }
      if (lane === 'music' && action === 'replace') {
        const pending = page.waitForEvent('download');
        await page
          .getByRole('button', { name: 'Save Project', exact: true })
          .click();
        const download = await pending,
          path = info.outputPath('edited.avstudio.json');
        await download.saveAs(path);
        const saved = JSON.parse(readFileSync(path, 'utf8'));
        expect(saved.schemaVersion).toBe(2);
        expect(saved.edit).not.toHaveProperty('musicSourceId');
        expect(
          new Set(saved.edit.music.map((v: { sourceId: string }) => v.sourceId))
            .size,
        ).toBe(2);
        await open(page, readFileSync(path), [
          media.picture,
          media.sourceA,
          media.compressed,
        ]);
      }
      await seek(page, 0);
      await page.screenshot({
        path: info.outputPath('edited-workspace.png'),
        fullPage: true,
      });
      const captured = await capturePreviewPcm(page, 80, 25);
      const events = expectedEvents(lane, action),
        times = [0.25, 0.75, 1.1, 1.4, 1.65, 1.9, 2.25, 2.75, 3.1];
      const chunks = captured.buses[lane === 'music' ? 1 : 0];
      expect(chunks?.length).toBeGreaterThan(10);
      for (const quiet of captured.buses[lane === 'music' ? 0 : 1]) {
        if (quiet.at >= 0.1 && quiet.at < 3.1)
          expect(
            Math.sqrt(
              quiet.left.reduce((n, v) => n + v * v, 0) / quiet.left.length,
            ),
          ).toBeLessThan(0.001);
      }
      for (const time of times) {
        const nearest = [...chunks].sort(
          (a, b) =>
            Math.abs(a.at + a.left.length / (2 * captured.sampleRate) - time) -
            Math.abs(b.at + b.left.length / (2 * captured.sampleRate) - time),
        )[0];
        expect(
          Math.abs(
            nearest.at + nearest.left.length / (2 * captured.sampleRate) - time,
          ),
        ).toBeLessThanOrEqual(0.05);
        assertTone(
          nearest.left,
          expectedFrequency(lane, events, time),
          captured.sampleRate,
        );
      }
      writeFileSync(
        info.outputPath('preview-evidence.json'),
        JSON.stringify({
          events,
          rate: captured.sampleRate,
          buses: captured.buses,
        }),
      );
      for (const format of ['MOV', 'WAV', 'MP3'])
        await expect(page.getByLabel(format, { exact: true })).toBeChecked();
      await page
        .getByRole('button', { name: 'Render MP4', exact: true })
        .click();
      for (const format of ['MP4', 'MOV', 'WAV', 'MP3']) {
        const link = page.getByRole('link', {
          name: `Download ${format}`,
          exact: true,
        });
        await expect(link).toBeVisible({ timeout: 90000 });
        const pending = page.waitForEvent('download');
        await link.click();
        const download = await pending,
          path = join(info.outputDir, `result.${format.toLowerCase()}`);
        await download.saveAs(path);
        const decoded = decodedAudio(path);
        for (const time of times)
          assertTone(
            decoded.slice(
              Math.round((time - 0.05) * 48000),
              Math.round((time + 0.05) * 48000),
            ),
            expectedFrequency(lane, events, time),
            48000,
          );
      }
    });
