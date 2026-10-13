import { test, expect, type Page } from '@playwright/test';
import {
  generateAdvancedMedia,
  probeDownloadedMp4,
  pixel,
  toneEnergy,
} from './mediaFixtures';

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
async function addTake(page: Page, file: string, start: number) {
  await seek(page, start);
  await page
    .getByLabel('Choose replacement video', { exact: true })
    .setInputFiles(file);
  await expect(
    page.getByRole('button', { name: 'Save replacement', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Save replacement', exact: true })
    .click();
}
async function base(page: Page, file: string) {
  page.on('pageerror', (error) =>
    console.error('Browser error:', error.message),
  );
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

test('advanced timeline edits render exact picture audio and music', async ({
  page,
  request,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await base(page, media.base);
  await page.getByLabel('Video 2 replacement drop target').evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'cross-track-occurrence');
    node.dispatchEvent(
      new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
    );
  });
  await expect(page.getByRole('alert')).toContainText('between tracks');
  await expect(
    page
      .getByRole('region', { name: 'VIDEO 2', exact: true })
      .getByRole('button', { name: /^Select Video 2/ }),
  ).toHaveCount(0);
  await addTake(page, media.takeA, 40);
  const firstTake = page.getByRole('button', {
    name: /Select Video 2 take-a.mp4.*frames 40–99/,
  });
  await firstTake.click();
  await page
    .getByLabel('Replacement source end frame', { exact: true })
    .fill('58');
  await page
    .getByRole('button', { name: 'Save source trim', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: /Select Video 2 take-a.mp4.*frames 40–98/,
    }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await firstTake.click();
  await firstTake.scrollIntoViewIfNeeded();
  const bounds = (await firstTake.boundingBox())!;
  const lane = (await page
    .getByLabel('Video 2 replacement drop target')
    .boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + (lane.width * 10) / 150,
    bounds.y + bounds.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(
    page.getByRole('button', {
      name: /Select Video 2 take-a.mp4.*frames 50–109/,
    }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await firstTake.click();
  await seek(page, 70);
  await page
    .getByRole('button', { name: 'Split at playhead', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'VIDEO 2', exact: true })
      .getByRole('button', { name: /^Select Video 2/ }),
  ).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Ripple Delete selected', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'VIDEO 2', exact: true })
      .getByRole('button', { name: /^Select Video 2/ }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(firstTake).toHaveCount(1);
  await addTake(page, media.takeB, 110);
  await expect(
    page
      .getByRole('region', { name: 'VIDEO 2', exact: true })
      .getByRole('button', { name: /^Select Video 2/ }),
  ).toHaveCount(2);
  await addTake(page, media.takeB, 90);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'overlap',
  );
  await page.getByRole('button', { name: 'Cancel replacement' }).click();
  let baseUrl = '',
    takeUrl = '';
  for (const frame of [39, 40, 99, 100]) {
    await seek(page, frame);
    const preview = page.getByLabel('Uploaded clip preview', { exact: true });
    await expect(preview).toBeVisible();
    const url = (await preview.getAttribute('src'))!;
    if (frame === 39) baseUrl = url;
    if (frame === 40) {
      takeUrl = url;
      expect(takeUrl).not.toBe(baseUrl);
    }
    if (frame === 99) expect(url).toBe(takeUrl);
    if (frame === 100) expect(url).toBe(baseUrl);
  }
  await page
    .getByLabel('Choose video overlay', { exact: true })
    .setInputFiles(media.pip);
  await expect(
    page.getByLabel('Video overlay start frame', { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('Video overlay start frame', { exact: true })
    .fill('10');
  await page.getByLabel('Video overlay end frame', { exact: true }).fill('49');
  await seek(page, 19);
  await expect(
    page.getByLabel('PIP overlay preview', { exact: true }),
  ).toBeVisible();
  await seek(page, 20);
  await expect(
    page.getByLabel('PIP overlay preview', { exact: true }),
  ).toHaveCount(0);
  await seek(page, 19);
  await expect(
    page.getByLabel('PIP overlay preview', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Choose image overlay', { exact: true })
    .setInputFiles(media.image);
  await expect(
    page.getByLabel('Image overlay start frame', { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('Image overlay start frame', { exact: true })
    .fill('10');
  await page.getByLabel('Image overlay end frame', { exact: true }).fill('49');
  await page
    .getByLabel('Choose background audio', { exact: true })
    .setInputFiles(media.music);
  await page.getByRole('button', { name: /^Select Background music/ }).click();
  await page.getByLabel('Timeline start frame', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Save timeline range' }).click();
  for (const frame of [75, 100]) {
    await seek(page, frame);
    await page
      .getByRole('button', { name: 'Split at playhead', exact: true })
      .click();
  }
  await page
    .getByRole('button', { name: /Select Background music.*frames 75–99/ })
    .click();
  await page
    .getByRole('button', { name: 'Ripple Delete selected', exact: true })
    .click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: /Select Background music.*frames 75–199/,
    }),
  ).toBeVisible();
  await page
    .getByRole('slider', { name: 'Original audio volume', exact: true })
    .fill('80');
  await page
    .getByRole('slider', { name: 'Music volume', exact: true })
    .fill('40');
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      if (init?.body instanceof FormData) {
        Object.defineProperty(window, 'lastTimelineManifest', {
          configurable: true,
          value: String(init.body.get('manifest')),
        });
      }
      return originalFetch(input, init);
    };
  });
  const submitted = page.waitForRequest(
    (r) => r.url().endsWith('/api/merge') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
  await submitted;
  const upload = await page.evaluate(() =>
    String(Reflect.get(window, 'lastTimelineManifest')),
  );
  expect(upload).toContain('"schema_version":2');
  expect(upload).toContain('"source_start_sample":144000');
  await expect(page.getByText('MP4 ready', { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const downloadEvent = page.waitForEvent('download');
  const link = page.getByRole('link', { name: /Download MP4/ });
  const href = await link.getAttribute('href');
  await link.click();
  const download = await downloadEvent;
  const path = info.outputPath('edited.mp4');
  await download.saveAs(path);
  expect(probeDownloadedMp4(path)).toEqual({
    frames: 150,
    fps: 25,
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1280,
    height: 720,
  });
  for (const n of [39, 100]) expect(pixel(path, n)[0]).toBeGreaterThan(200);
  for (const n of [40, 99]) expect(pixel(path, n)[2]).toBeGreaterThan(200);
  expect(pixel(path, 110)[0]).toBeGreaterThan(200);
  expect(pixel(path, 110)[1]).toBeGreaterThan(200);
  expect(toneEnergy(path, 2.1, 880)).toBeGreaterThan(
    10 * toneEnergy(path, 2.1, 440),
  );
  expect(toneEnergy(path, 4.1, 440)).toBeGreaterThan(
    10 * toneEnergy(path, 4.1, 880),
  );
  expect(toneEnergy(path, 3.3, 990)).toBeGreaterThan(
    10 * toneEnergy(path, 3.3, 660),
  );
  const jobId = href!.match(/jobs\/([^/]+)/)![1];
  expect(
    (await request.delete(`http://127.0.0.1:8000/api/jobs/${jobId}`)).status(),
  ).toBe(204);
});

test('keyboard positioned edits and mobile one-frame geometry', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await base(page, media.base);
  await seek(page, 40);
  await page
    .getByLabel('Choose replacement video', { exact: true })
    .setInputFiles(media.takeA);
  await expect(
    page.getByRole('button', { name: 'Save replacement', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await addTake(page, media.takeA, 40);
  await page.getByRole('button', { name: /^Select Video 2/ }).focus();
  await page.keyboard.press('Enter');
  await page
    .getByLabel('Content out frame (exclusive)', { exact: true })
    .fill('1');
  await page.getByRole('button', { name: 'Save timeline range' }).click();
  for (const [width, height] of [
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const card = page.locator('[data-positioned-id]');
    const lane = page.getByLabel('Video 2 replacement drop target');
    expect(
      (await card.boundingBox())!.width / (await lane.boundingBox())!.width,
    ).toBeCloseTo(1 / 150, 2);
    await expect(
      page.getByLabel('Timeline start frame', { exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: /^Select Video 2/ }).focus();
  await page.keyboard.press('Delete');
  await expect(
    page.getByRole('button', { name: /^Select Video 2/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(
    page.getByRole('button', { name: /Select Video 2.*frames 40–40/ }),
  ).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Trim base.mp4', exact: true })
    .click();
  await page.getByLabel('Trim end frame', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Save trim', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Review take-a.mp4 range', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Timeline start frame', { exact: true }).focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('20');
  await page
    .getByRole('button', { name: 'Save timeline range', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
});
