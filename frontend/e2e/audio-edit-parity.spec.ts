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
      const probe = {
        active: false,
        events: [] as string[],
        details: [] as unknown[],
        voices: [] as HTMLMediaElement[],
        pending: new Map<HTMLMediaElement, number>(),
      };
      const createSource = AudioContext.prototype.createMediaElementSource;
      AudioContext.prototype.createMediaElementSource = function (
        this: AudioContext,
        element: HTMLMediaElement,
      ) {
        probe.voices.push(element);
        return createSource.call(this, element);
      };
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        const result = nativePlay.call(this);
        if (this instanceof HTMLAudioElement) {
          probe.pending.set(this, (probe.pending.get(this) ?? 0) + 1);
          const settled = () =>
            probe.pending.set(this, (probe.pending.get(this) ?? 1) - 1);
          void result.then(settled, settled);
        }
        return result;
      };
      const record = (
        kind: string,
        element: HTMLMediaElement,
        target?: number,
      ) => {
        if (!probe.active || !(element instanceof HTMLAudioElement)) return;
        probe.events.push(kind);
        probe.details.push({
          kind,
          target,
          sourceTime: element.currentTime,
          src: element.src,
          at: performance.now(),
          picture: document.querySelector<HTMLVideoElement>(
            '[aria-label="Uploaded clip preview"]',
          )?.currentTime,
          frame: document.querySelector<HTMLInputElement>(
            '[aria-label="Timeline position"]',
          )?.value,
          stack: new Error().stack,
        });
      };
      Object.assign(window, { runningAudioSplitProbe: probe });
      const time = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'currentTime',
      )!;
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        ...time,
        set(this: HTMLMediaElement, value: number) {
          record('seek', this, value);
          time.set!.call(this, value);
        },
      });
      for (const key of ['load', 'pause'] as const) {
        const native = HTMLMediaElement.prototype[key];
        HTMLMediaElement.prototype[key] = function (this: HTMLMediaElement) {
          record(key, this);
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
    await page.waitForFunction(() => {
      const probe = (
        window as unknown as {
          runningAudioSplitProbe: {
            voices: HTMLMediaElement[];
            pending: Map<HTMLMediaElement, number>;
          };
        }
      ).runningAudioSplitProbe;
      const active = probe.voices.filter((voice) => voice.getAttribute('src'));
      return (
        active.length > 0 &&
        active.every(
          (voice) =>
            !voice.paused &&
            !voice.seeking &&
            voice.readyState >= 2 &&
            voice.currentTime >= 0.3 &&
            !probe.pending.get(voice),
        )
      );
    });
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
    writeFileSync(
      info.outputPath('native-audio-observations.json'),
      JSON.stringify(
        await page.evaluate(
          () =>
            (
              window as unknown as {
                runningAudioSplitProbe: { details: unknown[] };
              }
            ).runningAudioSplitProbe.details,
        ),
      ),
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
  expectedAmplitude = 0.12,
) {
  expect(values.length).toBeGreaterThan(0);
  const rms = Math.sqrt(
    Array.from(values).reduce((sum, v) => sum + v * v, 0) / values.length,
  );
  if (!wanted) {
    expect(rms * rms).toBeLessThan(1e-7);
    return;
  }
  const amplitude = toneAmplitude(values, wanted, rate);
  expect(amplitude).toBeGreaterThan(0.006);
  const powerRatio = (amplitude / expectedAmplitude) ** 2;
  expect(powerRatio).toBeGreaterThanOrEqual(0.7);
  expect(powerRatio).toBeLessThanOrEqual(1.3);
  for (const excluded of [330, 440, 660, 990, 1100].filter((v) => v !== wanted))
    expect(amplitude * amplitude).toBeGreaterThan(
      20 * toneAmplitude(values, excluded, rate) ** 2,
    );
}

// Independent fixture contract: stereo files carry 0.12 left / -0.06 right;
// the mono picture sine is 1/8 full scale, normalized with equal-power stereo.
function fixtureAmplitude(
  frequency: number,
  channel: 'left' | 'right' | 'mono',
) {
  if (!frequency) return 0;
  if (frequency === 440) return 0.125 * Math.SQRT1_2;
  return channel === 'left' ? 0.12 : channel === 'right' ? 0.06 : 0.03;
}
function assertPreviewStereo(
  chunk: { left: readonly number[]; right: readonly number[] },
  frequency: number,
  rate: number,
) {
  assertTone(chunk.left, frequency, rate, fixtureAmplitude(frequency, 'left'));
  assertTone(
    chunk.right,
    frequency,
    rate,
    fixtureAmplitude(frequency, 'right'),
  );
  if (frequency) {
    const leftPower = chunk.left.reduce((sum, v) => sum + v * v, 0);
    const rightPower = chunk.right.reduce((sum, v) => sum + v * v, 0);
    const dot = chunk.left.reduce((sum, v, i) => sum + v * chunk.right[i], 0);
    const correlation = dot / Math.sqrt(leftPower * rightPower);
    expect(frequency === 440 ? correlation : -correlation).toBeGreaterThan(
      0.98,
    );
  }
}

test('sound oracle rejects excess gain, swapped asymmetric channels and non-silent gaps', () => {
  const signal = Float32Array.from(
    { length: 4800 },
    (_, i) => 0.12 * Math.sin((2 * Math.PI * 330 * i) / 48000),
  );
  assertTone(signal, 330, 48000);
  for (const corrupt of [
    signal.map((v) => v * Math.SQRT2),
    signal.map((v) => -v / 2),
  ])
    expect(() => assertTone(corrupt, 330, 48000)).toThrow();
  expect(() =>
    assertTone(new Float32Array(4800).fill(0.0005), 0, 48000),
  ).toThrow();
});

for (const fps of [24, 30, 50, 60] as const)
  test(`music split at ${fps} FPS preserves sound and all four exports`, async ({
    page,
  }, info) => {
    await installPreviewCapture(page);
    await page.goto('/');
    await expect(
      page.getByText('Backend ready', { exact: true }),
    ).toBeVisible();
    const document = parityProject(media, 'music');
    document.edit.fpsSelection = `${fps}`;
    document.timingFps = fps;
    document.edit.video1[0].trim = { startFrame: 0, endFrame: 74 };
    document.edit.video1[0].outputWindow = {
      outputInFrame: 0,
      outputOutFrame: 3 * fps,
    };
    document.edit.music[0].durationFrames = 2 * fps;
    await open(page, Buffer.from(JSON.stringify(document)), [
      media.picture,
      media.sourceA,
    ]);
    await page.getByRole('button', { name: /Select Background music/ }).click();
    await seek(page, fps);
    await page
      .getByRole('button', { name: 'Split Audio', exact: true })
      .click();
    await expect(
      page.getByLabel('Timeline start frame', { exact: true }),
    ).toHaveValue(String(fps));
    await expect(
      page.getByLabel('Source start sample (48 kHz)', { exact: true }),
    ).toHaveValue('48000');
    await expect(
      page.getByLabel('Music duration frames', { exact: true }),
    ).toHaveValue(String(fps));
    const captured = await capturePreviewPcm(page, Math.ceil(2.8 * fps), fps);
    writeFileSync(
      info.outputPath('preview-clock.json'),
      JSON.stringify(
        await page.evaluate(
          () =>
            (window as unknown as { avstudioCaptureClock: unknown })
              .avstudioCaptureClock,
        ),
      ),
    );
    writeFileSync(
      info.outputPath('preview-evidence.json'),
      JSON.stringify({ rate: captured.sampleRate, buses: captured.buses }),
    );
    const checks = [
      [0.4, 330],
      [1.4, 660],
      [2.6, 0],
    ];
    const failures: Error[] = [];
    const evidence: Record<string, string> = {};
    const verify = (scope: string, check: () => void) => {
      try {
        check();
        evidence[scope] = 'passed';
      } catch (error) {
        const failure = new Error(`${scope}: ${String(error)}`);
        failures.push(failure);
        evidence[scope] = failure.message;
      }
    };
    verify('preview', () => {
      for (const [time, frequency] of checks) {
        const nearest = [...captured.buses[1]].sort(
          (a, b) =>
            Math.abs(a.at + a.left.length / (2 * captured.sampleRate) - time) -
            Math.abs(b.at + b.left.length / (2 * captured.sampleRate) - time),
        )[0];
        expect(
          Math.abs(
            nearest.at + nearest.left.length / (2 * captured.sampleRate) - time,
          ),
        ).toBeLessThanOrEqual(0.05);
        assertPreviewStereo(nearest, frequency, captured.sampleRate);
      }
    });
    await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
    for (const format of ['MP4', 'MOV', 'WAV', 'MP3']) {
      const link = page.getByRole('link', {
        name: `Download ${format}`,
        exact: true,
      });
      await expect(link).toBeVisible({ timeout: 90000 });
      const pending = page.waitForEvent('download');
      await link.click();
      const download = await pending;
      const path = info.outputPath(`split-${fps}.${format.toLowerCase()}`);
      await download.saveAs(path);
      verify(format, () => {
        const decoded = decodedAudio(path);
        for (const [time, frequency] of checks)
          assertTone(
            decoded.slice(
              Math.round((time - 0.05) * 48000),
              Math.round((time + 0.05) * 48000),
            ),
            frequency,
            48000,
            fixtureAmplitude(frequency, 'mono'),
          );
      });
      writeFileSync(
        info.outputPath('parity-results.json'),
        JSON.stringify(evidence, null, 2),
      );
    }
    if (failures.length)
      throw new AggregateError(failures, JSON.stringify(evidence, null, 2));
  });

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
        if (action === 'delete')
          await page.keyboard.press(lane === 'music' ? 'Backspace' : 'Delete');
        else
          await page
            .getByRole('button', {
              name:
                lane === 'music'
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
      writeFileSync(
        info.outputPath('preview-clock.json'),
        JSON.stringify(
          await page.evaluate(
            () =>
              (window as unknown as { avstudioCaptureClock: unknown })
                .avstudioCaptureClock,
          ),
        ),
      );
      const events = expectedEvents(lane, action),
        times = [0.25, 0.75, 1.1, 1.4, 1.65, 1.9, 2.25, 2.75, 3.1];
      writeFileSync(
        info.outputPath('preview-evidence.json'),
        JSON.stringify({
          events,
          rate: captured.sampleRate,
          buses: captured.buses,
        }),
      );
      const chunks = captured.buses[lane === 'music' ? 1 : 0];
      // A preview mismatch must not hide whether the same edit renders
      // correctly. Preserve the failure and still inspect every delivery.
      const failures: Error[] = [];
      const evidence: Record<string, string> = {};
      const verify = (scope: string, check: () => void) => {
        try {
          check();
          evidence[scope] = 'passed';
        } catch (error) {
          const failure = new Error(`${scope}: ${String(error)}`);
          failures.push(failure);
          evidence[scope] = failure.message;
        }
      };
      verify('preview', () => {
        expect(chunks?.length).toBeGreaterThan(10);
        expect(
          captured.buses[lane === 'music' ? 0 : 1]?.length,
        ).toBeGreaterThan(10);
        for (const quiet of captured.buses[lane === 'music' ? 0 : 1]) {
          if (quiet.at >= 0.1 && quiet.at < 3.1)
            expect(
              Math.sqrt(
                quiet.left.reduce((n, v) => n + v * v, 0) / quiet.left.length,
              ),
            ).toBeLessThan(Math.sqrt(1e-7));
        }
        for (const time of times) {
          const nearest = [...chunks].sort(
            (a, b) =>
              Math.abs(
                a.at + a.left.length / (2 * captured.sampleRate) - time,
              ) -
              Math.abs(b.at + b.left.length / (2 * captured.sampleRate) - time),
          )[0];
          expect(
            Math.abs(
              nearest.at +
                nearest.left.length / (2 * captured.sampleRate) -
                time,
            ),
          ).toBeLessThanOrEqual(0.05);
          assertPreviewStereo(
            nearest,
            expectedFrequency(lane, events, time),
            captured.sampleRate,
          );
        }
      });
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
        verify(format, () => {
          const decoded = decodedAudio(path);
          for (const time of times)
            assertTone(
              decoded.slice(
                Math.round((time - 0.05) * 48000),
                Math.round((time + 0.05) * 48000),
              ),
              expectedFrequency(lane, events, time),
              48000,
              fixtureAmplitude(expectedFrequency(lane, events, time), 'mono'),
            );
        });
        writeFileSync(
          info.outputPath('parity-results.json'),
          JSON.stringify(evidence, null, 2),
        );
      }
      if (failures.length)
        throw new AggregateError(failures, JSON.stringify(evidence, null, 2));
    });
