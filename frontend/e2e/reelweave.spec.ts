import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('desktop and mobile: select, arrange, merge, play, download and reset', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const health = await request.get('http://127.0.0.1:8000/api/health');
  expect((await health.json()).ffmpeg_available).toBe(true);
  const clipPaths = ['coast.mp4', 'a-little-moment.mp4'].map((name, index) => {
    const output = info.outputPath(name);
    mkdirSync(resolve(output, '..'), { recursive: true });
    const result = spawnSync(
      process.env.REELWEAVE_FFMPEG_PATH || 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${index ? '180x320' : '320x180'}:rate=${index ? '24' : '30'}`,
        '-t',
        '0.7',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        output,
      ],
      { timeout: 30_000, encoding: 'utf8', windowsHide: true },
    );
    expect(result.status, result.stderr).toBe(0);
    return output;
  });
  const musicPath = info.outputPath('background.wav');
  const musicResult = spawnSync(
    process.env.REELWEAVE_FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=660:sample_rate=48000:duration=0.2',
      musicPath,
    ],
    { timeout: 30_000, encoding: 'utf8', windowsHide: true },
  );
  expect(musicResult.status, musicResult.stderr).toBe(0);
  const pipPath = info.outputPath('pip.mp4');
  const pipResult = spawnSync(
    process.env.REELWEAVE_FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=lime:s=160x90:r=30:d=0.4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      pipPath,
    ],
    { timeout: 30_000, encoding: 'utf8', windowsHide: true },
  );
  expect(pipResult.status, pipResult.stderr).toBe(0);
  const logoPath = info.outputPath('logo.png');
  const logoResult = spawnSync(
    process.env.REELWEAVE_FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=yellow:s=100x60',
      '-frames:v',
      '1',
      '-threads',
      '1',
      logoPath,
    ],
    { timeout: 30_000, encoding: 'utf8', windowsHide: true },
  );
  expect(logoResult.status, logoResult.stderr).toBe(0);

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Turn your clips into one story.' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Merge workspace' }),
  ).toBeVisible();
  for (const text of [
    'Ad Assembly Timeline',
    'SMALL CLIPS. BIGGER STORIES.',
    'Bring your favorite moments together in one seamless video.',
    'Upload, arrange, and let your story unfold.',
    'Your clips. Your story.',
  ])
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Merge clips' }),
  ).toBeDisabled();
  await page.screenshot({
    path: '../docs/screenshots/desktop-empty.png',
    fullPage: true,
  });
  await page.getByLabel('Choose video clips').setInputFiles(clipPaths);
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('listitem').first()).toContainText(
    /Frames 0\u2013\d+/,
  );
  await expect(page.getByRole('listitem').last()).toContainText(
    /Frames 0\u2013\d+/,
  );
  await expect(page.getByRole('button', { name: 'Merge clips' })).toBeEnabled();
  await page
    .getByRole('listitem')
    .last()
    .dragTo(page.getByRole('listitem').first());
  await expect(page.getByRole('listitem').first()).toContainText(
    'a-little-moment.mp4',
  );
  await page.getByRole('button', { name: 'Trim a-little-moment.mp4' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Trim a-little-moment.mp4' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next Frame' }).click();
  await expect(page.locator('[data-readout="playhead"]')).toContainText(
    'Frame 1',
  );
  const trimEnd = page.getByLabel('Trim end frame');
  const discoveredEndFrame = await trimEnd.getAttribute('max');
  expect(discoveredEndFrame).not.toBeNull();
  await trimEnd.fill(discoveredEndFrame!);
  await page.getByRole('button', { name: 'Save trim' }).click();
  await expect(page.getByRole('listitem').first()).toContainText(
    `Frames 0\u2013${discoveredEndFrame}`,
  );
  await page.getByLabel('Speed for a-little-moment.mp4').selectOption('0.5');
  await page.getByLabel('Choose background audio').setInputFiles(musicPath);
  await expect(page.getByText('background.wav')).toBeVisible();
  await page.getByRole('slider', { name: 'Music volume' }).fill('40');
  await page.getByLabel('Mute original audio').check();
  await page.getByLabel('Choose image overlay').setInputFiles(logoPath);
  await page.getByLabel('Choose video overlay').setInputFiles(pipPath);
  await expect(page.getByText('logo.png')).toBeVisible();
  await expect(page.getByText('pip.mp4')).toBeVisible();
  await page.getByLabel('Image overlay start frame').fill('2');
  await page.getByLabel('Image overlay end frame').fill('9999');
  await expect(page.getByText(/outside the project timeline/i)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Merge clips' }),
  ).toBeDisabled();
  await page.getByLabel('Image overlay end frame').fill('20');
  await page.getByLabel('Video overlay start frame').fill('3');
  await page.getByLabel('Video overlay end frame').fill('15');
  await page.getByLabel('Video overlay position').selectOption('centre');
  await page.getByLabel('Video overlay size').selectOption('large');
  await expect(page.getByRole('button', { name: 'Merge clips' })).toBeEnabled();
  await page
    .getByRole('button', { name: 'Move a-little-moment.mp4 down' })
    .click();
  await page
    .getByRole('button', { name: 'Move a-little-moment.mp4 up' })
    .click();
  await expect(page.getByRole('listitem').first()).toContainText(
    'a-little-moment.mp4',
  );
  await page.screenshot({
    path: '../docs/screenshots/desktop-arranged.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const text of [
    'Ad Assembly Timeline',
    'SMALL CLIPS. BIGGER STORIES.',
    'Your clips. Your story.',
  ])
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  const mobileClipLayout = await page
    .getByRole('listitem')
    .first()
    .evaluate((item) => {
      const details = item
        .querySelector('.clip-details')!
        .getBoundingClientRect();
      const controls = item
        .querySelector('.clip-edit-controls')!
        .getBoundingClientRect();
      const actions = item
        .querySelector('.clip-actions')!
        .getBoundingClientRect();
      const bounds = item.getBoundingClientRect();
      return {
        detailsWidth: details.width,
        detailsBottom: details.bottom,
        controlsTop: controls.top,
        actionsRight: actions.right,
        itemRight: bounds.right,
      };
    });
  expect(mobileClipLayout.detailsWidth).toBeGreaterThan(80);
  expect(mobileClipLayout.controlsTop).toBeGreaterThanOrEqual(
    mobileClipLayout.detailsBottom,
  );
  expect(mobileClipLayout.actionsRight).toBeLessThanOrEqual(
    mobileClipLayout.itemRight,
  );
  await page.screenshot({
    path: '../docs/screenshots/mobile-arranged.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Timeline Demo' }).click();
  await expect(page.getByText(/Browser preview is approximate/i)).toBeVisible();
  await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
  await expect(page.getByLabel('Effective timeline FPS')).toContainText(
    '25 FPS',
  );
  await expect(page.getByLabel('Export format')).toHaveValue('MP4');
  await expect(page.getByRole('option', { name: 'MOV' })).toHaveCount(0);
  await page.getByLabel('Timeline position').fill('0.12');
  await expect(page.getByLabel('PIP overlay preview')).toBeVisible();
  await expect(page.getByLabel('Image overlay preview')).toBeVisible();
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/merge') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Merge current timeline' }).click();
  const response = await submitted;
  expect(response.status()).toBe(202);
  expect(response.request().headers()['content-type']).toContain(
    'multipart/form-data',
  );
  // The API strictly requires each non-null manifest overlay to have its
  // distinct matching multipart field; 202 proves all three named uploads
  // (image, video, and music) passed that pairing validation.
  const { job_id: jobId } = await response.json();
  await expect(
    page.getByRole('heading', { name: 'Your story, together.' }),
  ).toBeVisible({ timeout: 90_000 });
  const video = page.getByLabel('Merged video preview');
  await expect
    .poll(async () =>
      video.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect
    .poll(async () =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.screenshot({
    path: '../docs/screenshots/mobile-result.png',
    fullPage: true,
  });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download MP4' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^reelweave.*\.mp4$/);
  expect(await download.failure()).toBeNull();
  await page.getByRole('button', { name: 'Start new merge' }).click();
  await expect(page.getByText('Your story starts here')).toBeVisible();
  expect(
    (await request.delete(`http://127.0.0.1:8000/api/jobs/${jobId}`)).status(),
  ).toBe(204);
  expect(errors).toEqual([]);
});
