import { test, expect, type Page } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { once } from 'node:events';
import {
  generateAdvancedMedia,
  probeDownloadedMp4,
  pixel,
  toneEnergy,
} from './mediaFixtures';

async function base(page: Page, file: string) {
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(file);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
}
async function seek(page: Page, frame: number) {
  await page
    .getByLabel('Timeline position', { exact: true })
    .evaluate((node, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(node, String(value));
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, frame);
}
function probe(path: string) {
  const out = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-count_frames',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      path,
    ],
    { windowsHide: true, timeout: 60000 },
  );
  expect(out.status, out.stderr.toString()).toBe(0);
  return JSON.parse(out.stdout.toString());
}

test('bin overwrite detach replacement audio and four real downloads preserve the sequence', async ({
  page,
  request,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await base(page, media.base);
  // Make two real cuts, then overwrite across both without rippling the tail.
  await page
    .getByRole('button', { name: 'Preview clip 1: base.mp4', exact: true })
    .click();
  await seek(page, 60);
  await page
    .getByRole('button', { name: 'Split at playhead', exact: true })
    .click();
  await seek(page, 120);
  await page
    .getByRole('button', { name: 'Split at playhead', exact: true })
    .click();
  await page
    .getByLabel('Import video to bin', { exact: true })
    .setInputFiles(media.takeA);
  await expect(
    page.getByRole('button', {
      name: 'Place take-a.mp4 on track',
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Place take-a.mp4 on track', exact: true })
    .click();
  await page.getByLabel('Placement start frame', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Place media', exact: true }).click();
  await expect(page.locator('.clip-item')).toHaveCount(4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.clip-item')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.clip-item')).toHaveCount(4);
  const take = page.getByRole('button', {
    name: 'Preview clip 2: take-a.mp4',
    exact: true,
  });
  await take.click();
  // Ctrl+L belongs to browser chrome; page-level default must remain unprevented.
  expect(
    await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'l',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.keyboard.press('Control+Alt+l');
  const detached = page.getByRole('button', {
    name: /Original\/Replacement Audio take-a.mp4.*start 40.*60 frames.*Detached/,
  });
  await expect(detached).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(detached).toHaveCount(0);
  await expect(page.locator('.clip-item')).toHaveCount(4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await detached.click();
  await page
    .getByLabel('Replace Audio', { exact: true })
    .setInputFiles(media.music);
  await expect(
    page.getByRole('button', {
      name: /Original\/Replacement Audio song.wav.*start 40.*60 frames.*Replacement/,
    }),
  ).toBeVisible();
  await page
    .getByLabel('Choose background audio', { exact: true })
    .setInputFiles(media.music);
  await expect(
    page.getByRole('button', { name: /Select Background music/ }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Remove take-a.mp4 from bin', exact: true })
    .click();
  for (const format of ['MOV', 'WAV', 'MP3']) {
    await expect(page.getByLabel(format, { exact: true })).toBeEnabled();
    await page.getByLabel(format, { exact: true }).check();
  }
  await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Download MP3', exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const paths: Record<string, string> = {};
  let mp4Url = '';
  for (const format of ['MP4', 'MOV', 'WAV', 'MP3']) {
    const link = page.getByRole('link', {
      name: `Download ${format}`,
      exact: true,
    });
    if (format === 'MP4') mp4Url = (await link.getAttribute('href'))!;
    const event = page.waitForEvent('download');
    await link.click();
    const download = await event;
    const path = info.outputPath(`delivery.${format.toLowerCase()}`);
    await download.saveAs(path);
    paths[format] = path;
  }
  expect(probeDownloadedMp4(paths.MP4).frames).toBe(150);
  expect(probeDownloadedMp4(paths.MOV).frames).toBe(150);
  const wav = probe(paths.WAV).streams[0];
  expect(wav.codec_name).toBe('pcm_s16le');
  expect(wav.sample_rate).toBe('48000');
  expect(wav.channels).toBe(2);
  expect(Number(wav.duration_ts)).toBe(288000);
  const mp3 = probe(paths.MP3).streams[0];
  expect(mp3.codec_name).toBe('mp3');
  expect(mp3.sample_rate).toBe('48000');
  expect(Number(mp3.bit_rate)).toBe(320000);
  expect(pixel(paths.MP4, 39)[0]).toBeGreaterThan(200);
  expect(pixel(paths.MP4, 40)[2]).toBeGreaterThan(200);
  expect(pixel(paths.MP4, 99)[2]).toBeGreaterThan(200);
  expect(pixel(paths.MP4, 100)[0]).toBeGreaterThan(200);
  expect(toneEnergy(paths.WAV, 2.1, 330)).toBeGreaterThan(
    10 * toneEnergy(paths.WAV, 2.1, 880),
  );
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  expect((await request.get(mp4Url)).ok()).toBe(true);
  await expect(page.getByLabel('WAV', { exact: true })).not.toBeChecked();
});

test('scrolled bin drag uses the indicated frame and tools stay outside all lanes', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await base(page, media.base);
  await page
    .getByLabel('Import video to bin', { exact: true })
    .setInputFiles(media.takeB);
  await expect(
    page.getByRole('button', {
      name: 'Place take-b.mp4 on track',
      exact: true,
    }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 480, height: 850 });
  const scroll = page.locator('.timeline-scroll');
  await scroll.evaluate((node) => {
    node.scrollLeft = 180;
  });
  const source = page.getByRole('article', { name: 'video source take-b.mp4' }),
    lane = page.getByLabel('Video 2 replacement drop target', { exact: true });
  // Exercise real drag events and their browser DataTransfer while scrolled.
  const data = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer: data });
  const rect = await lane.boundingBox();
  const x = Math.max(100, rect!.x + rect!.width * 0.5),
    y = rect!.y + 20;
  await lane.dispatchEvent('dragover', {
    dataTransfer: data,
    clientX: x,
    clientY: y,
  });
  const ghost = lane.getByRole('status');
  await expect(ghost).toContainText('Frame');
  const indicated = Number((await ghost.innerText()).match(/Frame (\d+)/)![1]);
  await lane.dispatchEvent('drop', {
    dataTransfer: data,
    clientX: x,
    clientY: y,
  });
  await source.dispatchEvent('dragend', { dataTransfer: data });
  await expect(
    page.getByRole('button', {
      name: new RegExp(
        `Select Video 2 take-b.mp4.*frames ${indicated}–${indicated + 19}`,
      ),
    }),
  ).toHaveCount(1);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const tools = (await page
      .getByRole('toolbar', { name: 'Timeline Tools' })
      .boundingBox())!;
    const lanes = await page.locator('.track-content').evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        const viewport = n.closest('.timeline-scroll')?.getBoundingClientRect();
        return {
          x: Math.max(r.x, viewport?.x ?? r.x),
          y: r.y,
          right: Math.min(r.right, viewport?.right ?? r.right),
          bottom: r.bottom,
        };
      }),
    );
    for (const r of lanes)
      expect(
        tools.x + tools.width <= r.x ||
          tools.y + tools.height <= r.y ||
          tools.y >= r.bottom,
      ).toBe(true);
  }
});

test('real optional MP3 failure retains an encoded MP4 and shows no failed download', async ({
  page,
}, info) => {
  const root = resolve('..'),
    working = resolve(info.outputPath('failure-storage')),
    ready = info.outputPath('failure-ready.json');
  const child = spawn(
    resolve(root, '.venv/Scripts/python.exe'),
    ['-m', 'tests.integration.browser_export_failure_server', working, ready],
    { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let errors = '';
  child.stderr.on('data', (data) => {
    errors += data.toString();
  });
  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null) throw new Error(errors);
          return existsSync(ready);
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const url = JSON.parse(readFileSync(ready, 'utf8')).url as string;
    const media = generateAdvancedMedia(info.outputPath('media'));
    await page.context().route('**/api/**', async (route) => {
      const original = new URL(route.request().url());
      const destination = `${url}${original.pathname}${original.search}`;
      // Chromium interception omits file-backed upload bytes from postData.
      // Forward the browser's actual manifest with the same fixture File bytes
      // to the real test worker, rather than submitting an empty video.
      const manifest =
        original.pathname === '/api/merge'
          ? route
              .request()
              .postDataBuffer()
              ?.toString('utf8')
              .match(/name="manifest"\r\n\r\n([\s\S]*?)\r\n--/)?.[1]
          : undefined;
      if (original.pathname === '/api/merge') expect(manifest).toBeDefined();
      const result = manifest
        ? await page.request.post(destination, {
            multipart: {
              files: {
                name: 'base.mp4',
                mimeType: 'video/mp4',
                buffer: readFileSync(media.base),
              },
              manifest,
            },
          })
        : await route.fetch({ url: destination });
      await route.fulfill({ response: result });
    });
    await base(page, media.base);
    await page.getByLabel('MP3', { exact: true }).check();
    await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
    await expect(page.getByText(/MP3: failed/)).toBeVisible({ timeout: 90000 });
    await expect(
      page.getByRole('link', { name: 'Download MP3', exact: true }),
    ).toHaveCount(0);
    const downloadLink = page.getByRole('link', {
      name: 'Download MP4',
      exact: true,
    });
    // Edge's download manager bypasses intercepted page/context requests.
    // Keep the UI's artifact path and point its origin at this test's worker.
    await downloadLink.evaluate((node, origin) => {
      const anchor = node as HTMLAnchorElement;
      const target = new URL(anchor.href);
      anchor.href = `${origin}${target.pathname}${target.search}`;
    }, url);
    const event = page.waitForEvent('download');
    await downloadLink.click();
    const output = info.outputPath('surviving.mp4');
    await (await event).saveAs(output);
    expect(probeDownloadedMp4(output).frames).toBe(150);
  } finally {
    await page.context().unroute('**/api/**');
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    // This root is unique to this test and checked before recursive cleanup.
    const inside = relative(resolve(root, 'frontend'), working);
    if (
      !inside.startsWith(`..${sep}`) &&
      !inside.startsWith('..') &&
      inside !== ''
    )
      rmSync(working, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
  }
});
