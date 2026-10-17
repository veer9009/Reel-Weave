import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  generateAdvancedMedia,
  generateContinuityVideo,
} from './mediaFixtures';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const records: unknown[] = [];
    (window as unknown as { boundaryRecords: unknown[] }).boundaryRecords = records;
    const record = (element: HTMLMediaElement, type: string, value?: number) => {
      records.push({ type, value, tag: element.tagName, src: element.src,
        time: element.currentTime, now: performance.now(), paused: element.paused,
        seeking: element.seeking, ready: element.readyState,
        stack: new Error().stack?.split('\n').slice(2, 6),
        frame: document.querySelector<HTMLInputElement>('[aria-label="Timeline position"]')?.value });
    };
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      ...descriptor, set(value: number) { record(this, 'seek-write', value); descriptor.set!.call(this, value); },
    });
    for (const name of ['play', 'pause'] as const) {
      const original = HTMLMediaElement.prototype[name];
      Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, writable: true,
        value(this: HTMLMediaElement) {
          if ((name === 'pause' && !this.paused) || (name === 'play' && this.paused)) record(this, name);
          return original.call(this);
        },
      });
    }
  });
});
test.afterEach(async ({ page }, info) => {
  const records = await page.evaluate(() => (window as unknown as { boundaryRecords: unknown[] }).boundaryRecords).catch(() => []);
  writeFileSync(info.outputPath('boundary-records.json'), JSON.stringify(records, null, 2));
});

for (const speed of ['1', '0.75', '0.5'])
  test(`same-source split preserves decoder and presented frames at speed ${speed}`, async ({
    page,
  }, info) => {
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
    await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
    await page
      .getByLabel('Speed for base60.mp4', { exact: true })
      .selectOption(speed);
    await page
      .getByRole('button', { name: 'Preview clip 1: base60.mp4', exact: true })
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
        presented: [] as { time: number; mediaTime: number; energy: number }[],
        srcWrites: [] as string[],
        seeks: [] as number[],
      };
      (window as unknown as { continuity: typeof state }).continuity = state;
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
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const callback = (now: number, meta: VideoFrameCallbackMetadata) => {
        context.drawImage(v, 0, 0, 16, 9);
        const rgba = context.getImageData(0, 0, 16, 9).data;
        let energy = 0;
        for (let n = 0; n < rgba.length; n += 4)
          energy += rgba[n] + rgba[n + 1] + rgba[n + 2];
        state.presented.push({ time: now, mediaTime: meta.mediaTime, energy });
        v.requestVideoFrameCallback(callback);
      };
      v.requestVideoFrameCallback(callback);
    });
    await page
      .getByRole('button', { name: 'Play preview', exact: true })
      .click();
    await expect
      .poll(() =>
        page.getByLabel('Timeline position', { exact: true }).inputValue(),
      )
      .not.toBe('0');
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
    const before = await page.evaluate(() => {
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
    await page
      .getByRole('button', { name: 'Split at playhead', exact: true })
      .click();
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
    await info.attach('split-media-events.json', {
      body: JSON.stringify({ before, after }, null, 2),
      contentType: 'application/json',
    });
    writeFileSync(
      info.outputPath('split-media-events.json'),
      JSON.stringify({ before, after }, null, 2),
    );
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
    await expect(
      page.getByRole('button', { name: 'Pause preview', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { continuity: { presented: unknown[] } })
              .continuity.presented.length,
        ),
      )
      .toBeGreaterThan(before.presented + 3);
    const presented = await page.evaluate(
      () =>
        (
          window as unknown as {
            continuity: {
              presented: { time: number; mediaTime: number; energy: number }[];
            };
          }
        ).continuity.presented,
    );
    expect(presented.every((frame) => frame.energy > 0)).toBe(true);
    expect(
      presented
        .slice(before.presented + 1)
        .every(
          (frame, index) =>
            frame.mediaTime >= presented[before.presented + index].mediaTime,
        ),
    ).toBe(true);
    for (let split = 0; split < 2; split++) {
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
        .getByRole('button', { name: 'Split at playhead', exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { continuity: { presented: unknown[] } })
                .continuity.presented.length,
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
            document.querySelector('[aria-label="Uploaded clip preview"]') ===
            s.element,
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
        state.events.slice(mark.events).some((event) => event.type === 'pause'),
      ).toBe(false);
    }
  });

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
    .locator('video').first()
    .getAttribute('src');
  await expect(page.getByLabel('Uploaded clip preview', { exact: true })).toHaveAttribute('src', baseUrl!);
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
          const range = route.request().headers().range?.match(/^bytes=(\d*)-(\d*)$/);
          const start = range ? (range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]))) : 0;
          const end = range && range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
          await route.fulfill({
            status: range ? 206 : 200,
            body: bytes.subarray(start, end + 1),
            contentType: 'video/mp4',
            headers: { 'cache-control': 'no-store', 'accept-ranges': 'bytes',
              ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}) },
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
            // The chirp's instantaneous source frequency is 440 + 400*t Hz.
            // Centre the real analyser window at the current output sample time.
            const source =
              (sound.frequency - 440) / 400 +
              (sound.window * original.playbackRate) / 2;
            const pictureTime =
              frame.mediaTime +
              (Math.max(0, performance.now() - frame.displayTime) / 1000) *
                picture.playbackRate;
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
