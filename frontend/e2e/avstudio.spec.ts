import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const values = color
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('responsive workspace and keyboard access', async ({ page }) => {
  await page.goto('/');
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [899, 768],
    [390, 844],
    [320, 640],
    [1280, 600],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const media = await page
      .getByRole('region', { name: 'Media', exact: true })
      .boundingBox();
    const monitor = await page
      .getByRole('region', { name: 'Program preview' })
      .boundingBox();
    const inspector = await page
      .getByRole('complementary', { name: 'Inspector' })
      .boundingBox();
    expect(media).not.toBeNull();
    expect(monitor).not.toBeNull();
    expect(inspector).not.toBeNull();
    if (width >= 1280) {
      expect(monitor!.x).toBeGreaterThan(media!.x);
      expect(inspector!.x).toBeGreaterThan(monitor!.x);
      if (height >= 800) {
        const timeline = await page
          .getByRole('region', { name: 'Sequence timeline' })
          .boundingBox();
        expect(timeline!.y).toBeLessThan(height - 200);
      }
    } else if (width >= 900) {
      expect(monitor!.x).toBeGreaterThan(media!.x);
      expect(inspector!.y).toBeGreaterThan(monitor!.y);
    } else {
      expect(monitor!.y).toBeGreaterThan(media!.y);
      expect(inspector!.y).toBeGreaterThan(monitor!.y);
    }
    for (const name of ['Browse files', 'Render MP4']) {
      const bounds = await page
        .getByRole('button', { name, exact: true })
        .boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: 'Sequence timeline' }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'AVStudio workspace' }).focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Browse files' }),
  ).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await chooser;
  const disclosure = page
    .locator('summary')
    .filter({ hasText: 'Video 2 overlays' });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure.locator('..')).not.toHaveAttribute('open');
  await page.keyboard.press('Enter');
  await expect(disclosure.locator('..')).toHaveAttribute('open', '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).not.toBe('smooth');
  await expect(page.getByLabel('Current time and frame')).toHaveAttribute(
    'aria-live',
    'off',
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 450,
    deviceScaleFactor: 2,
    mobile: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Browse files' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Render MP4' })).toBeVisible();
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await cdp.detach();
});

test('AVStudio branding', async ({ page, request }, info) => {
  await page.goto('/');
  await expect(page).toHaveTitle('AVStudio — Editing workspace');
  await expect(
    page.getByRole('link', { name: 'AVStudio workspace' }),
  ).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Assemble video clips, overlays, and audio into an MP4 in AVStudio.',
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    'href',
    '/branding/avstudio-icon.svg',
  );
  for (const name of ['icon', 'wordmark']) {
    const response = await request.get(`/branding/avstudio-${name}.svg`);
    expect(response.ok()).toBe(true);
    const svg = await response.text();
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/<script|<image|<text|@font-face|href=["']https?:/);
  }
  await page.setContent(
    `<body style="background:#0b0d16;color:white;padding:24px;font:16px system-ui"><div style="display:flex;gap:24px;align-items:end">${[16, 24, 32, 64].map((size) => `<figure style="margin:0"><img src="/branding/avstudio-icon.svg" width="${size}" height="${size}"><figcaption>${size}px</figcaption></figure>`).join('')}</div><img style="margin-top:32px" src="/branding/avstudio-wordmark.svg" width="240" height="64"></body>`,
  );
  await expect
    .poll(() =>
      page
        .locator('img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('branding-size-review.png') });
});

test('desktop and mobile: edit, render, play, download and New project', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/merge') && request.method() === 'POST')
      submissions += 1;
  });
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
        index ? '0.7' : '2',
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
    page.getByRole('region', { name: 'Sequence timeline' }),
  ).toBeVisible();
  for (const text of [
    'Ad Assembly Timeline',
    'SMALL CLIPS. BIGGER STORIES.',
    'Bring your favorite moments together in one seamless video.',
    'Upload, arrange, and let your story unfold.',
    'Your clips. Your story.',
  ])
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Render MP4' })).toBeDisabled();
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
  await expect(page.getByRole('button', { name: 'Render MP4' })).toBeEnabled();
  await expect(page.locator('li[draggable=true]')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Move a-little-moment.mp4 up' })
    .click();
  await expect(page.getByRole('listitem').first()).toContainText(
    'a-little-moment.mp4',
  );
  await page.getByRole('button', { name: 'Trim a-little-moment.mp4' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Trim a-little-moment.mp4' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel trim' })).toBeFocused();
  const trimColors = await page.getByRole('dialog').evaluate((dialog) => ({
    background: getComputedStyle(dialog).backgroundColor,
    text: getComputedStyle(dialog.querySelector('h2')!).color,
  }));
  expect(
    contrast(trimColors.background, trimColors.text),
  ).toBeGreaterThanOrEqual(4.5);
  await page.getByRole('button', { name: 'Save trim' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel trim' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Trim a-little-moment.mp4' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
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
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector' })
      .getByText('background.wav', { exact: true }),
  ).toBeVisible();
  await page.getByRole('slider', { name: 'Music volume' }).fill('40');
  await page.getByLabel('Mute original audio').check();
  await page.getByLabel('Choose image overlay').setInputFiles(logoPath);
  await page.getByLabel('Choose video overlay').setInputFiles(pipPath);
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector' })
      .getByText('logo.png', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector' })
      .getByText('pip.mp4', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Image overlay start frame').fill('2');
  await page.getByLabel('Image overlay end frame').fill('9999');
  await expect(page.getByText(/outside the project timeline/i)).toBeVisible();
  await expect(
    page.getByLabel('Image overlay end frame'),
  ).toHaveAccessibleDescription(/outside the project timeline/i);
  await page.locator('summary').filter({ hasText: 'Video 2 overlays' }).click();
  await expect(page.getByText('Image overlay needs attention.')).toBeVisible();
  await page.getByRole('button', { name: 'Review image overlay' }).click();
  await expect(page.getByLabel('Image overlay end frame')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Render MP4' })).toBeDisabled();
  await page.getByLabel('Image overlay end frame').fill('20');
  await page.getByLabel('Video overlay start frame').fill('3');
  await page.getByLabel('Video overlay end frame').fill('15');
  await page.getByLabel('Video overlay position').selectOption('centre');
  await page.getByLabel('Video overlay size').selectOption('large');
  const fieldColors = await page
    .getByLabel('Image overlay end frame')
    .evaluate((input) => ({
      background: getComputedStyle(input).backgroundColor,
      border: getComputedStyle(input).borderTopColor,
    }));
  expect(
    contrast(fieldColors.background, fieldColors.border),
  ).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('button', { name: 'Render MP4' })).toBeEnabled();
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
  await expect(page.getByText(/Silent browser preview/i)).toBeVisible();
  await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
  await expect(page.getByLabel('Effective timeline FPS')).toContainText(
    '25 FPS',
  );
  await expect(page.getByText('1280 × 720 · H.264 + AAC')).toBeVisible();
  await expect(page.getByRole('option', { name: 'MOV' })).toHaveCount(0);
  await page.getByLabel('Video overlay start frame').fill('10');
  await page.getByLabel('Video overlay end frame').fill('49');
  await page.getByLabel('Timeline position').fill('19');
  await expect(page.getByLabel('PIP overlay preview')).toBeVisible();
  const ruler = page.getByLabel('Timeline position');
  await ruler.focus();
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Current time and frame')).toContainText(
    'Frame 0 /',
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Current time and frame')).toContainText(
    'Frame 1 /',
  );
  await page.keyboard.press('End');
  await expect(ruler).toHaveValue((await ruler.getAttribute('max'))!);
  await ruler.fill('19');
  await expect(page.getByLabel('Image overlay preview')).toBeVisible();
  await page.getByLabel('Timeline position').fill('20');
  await expect(page.getByLabel('PIP overlay preview')).toHaveCount(0);
  await expect(page.getByLabel('Image overlay preview')).toBeVisible();
  await page.getByLabel('Timeline position').fill('19');
  await expect(page.getByLabel('PIP overlay preview')).toBeVisible();
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/merge') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Render MP4' }).click();
  const response = await submitted;
  expect(response.status(), await response.text()).toBe(202);
  expect(response.request().headers()['content-type']).toContain(
    'multipart/form-data',
  );
  // The API strictly requires each non-null manifest overlay to have its
  // distinct matching multipart field; 202 proves all three named uploads
  // (image, video, and music) passed that pairing validation.
  const { job_id: jobId } = await response.json();
  await expect(
    page.getByRole('region', { name: 'Sequence timeline' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Browse files' }),
  ).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'MP4 ready' })).toBeVisible({
    timeout: 90_000,
  });
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
  const downloadedPath = info.outputPath('downloaded.mp4');
  await download.saveAs(downloadedPath);
  const probe = spawnSync(
    process.env.REELWEAVE_FFPROBE_PATH || 'ffprobe',
    ['-v', 'error', '-show_streams', '-of', 'json', downloadedPath],
    { timeout: 30000, encoding: 'utf8', windowsHide: true },
  );
  expect(probe.status, probe.stderr).toBe(0);
  const streams = JSON.parse(probe.stdout).streams;
  expect(
    streams.find(
      (stream: { codec_type: string }) => stream.codec_type === 'video',
    ),
  ).toMatchObject({
    codec_name: 'h264',
    width: 1280,
    height: 720,
    r_frame_rate: '25/1',
  });
  expect(
    streams.find(
      (stream: { codec_type: string }) => stream.codec_type === 'audio',
    ),
  ).toMatchObject({ codec_name: 'aac' });
  expect(submissions).toBe(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole('region', { name: 'Sequence timeline' }),
  ).toBeVisible();
  await page.screenshot({
    path: '../docs/screenshots/desktop-result.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'New project' }).click();
  expect(
    (await request.get(`http://127.0.0.1:8000/api/jobs/${jobId}`)).status(),
  ).toBe(200);
  await expect(page.getByLabel('Timeline FPS', { exact: true })).toHaveValue(
    'auto',
  );
  await expect(
    page.getByRole('region', { name: 'VIDEO 2' }).getByRole('button'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'AUDIO 2' }).getByRole('button'),
  ).toHaveCount(0);
  await expect(page.getByText('No video clips')).toBeVisible();
  const longName =
    'a-very-long-source-filename-that-must-remain-reachable-on-a-320-pixel-screen.mp4';
  await page.getByLabel('Choose video clips').setInputFiles([
    {
      name: longName,
      mimeType: 'video/mp4',
      buffer: readFileSync(clipPaths[0]),
    },
    {
      name: 'second.mp4',
      mimeType: 'video/mp4',
      buffer: readFileSync(clipPaths[1]),
    },
  ]);
  await expect(page.getByRole('button', { name: 'Render MP4' })).toBeEnabled();
  await page.getByRole('button', { name: `Trim ${longName}` }).click();
  await page.getByLabel('Trim end frame').fill('0');
  await page.getByRole('button', { name: 'Save trim' }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel('Inspect clip').selectOption({ label: longName });
  const shortInterval = page.getByRole('button', {
    name: `Preview clip 1: ${longName}`,
  });
  const intervalGeometry = await shortInterval.evaluate((element) => {
    const block = element as HTMLElement;
    return {
      actual: block.getBoundingClientRect().width,
      expected:
        (block.parentElement!.getBoundingClientRect().width *
          parseFloat(block.style.width)) /
        100,
    };
  });
  expect(
    Math.abs(intervalGeometry.actual - intervalGeometry.expected),
  ).toBeLessThan(0.1);
  await expect(
    page.getByText(`Selected: ${longName}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Preview clip 1: ${longName}` }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Timeline position').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Current time and frame')).toHaveAttribute(
    'aria-live',
    'off',
  );
  expect(
    (await request.delete(`http://127.0.0.1:8000/api/jobs/${jobId}`)).status(),
  ).toBe(204);
  expect(errors).toEqual([]);
});

test('mobile long filename errors and retry actions remain reachable', async ({
  page,
}) => {
  const filename = `${'uninterrupted'.repeat(24)}.mp4`;
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        ffmpeg_available: false,
        ffprobe_available: false,
        limits: { max_clips: 10, max_file_size_mb: 200 },
      }),
    }),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Browse files' }),
  ).toBeEnabled();
  await page.getByLabel('Choose video clips').setInputFiles({
    name: filename,
    mimeType: 'video/mp4',
    buffer: Buffer.from('invalid video'),
  });
  const banner = page.getByRole('alert');
  await expect(banner).toContainText(`Could not read metadata for ${filename}`);
  const bounds = await banner.evaluate((element) =>
    Array.from(element.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        scroll: child.scrollWidth,
        width: child.clientWidth,
      };
    }),
  );
  for (const child of bounds) {
    expect(child.left).toBeGreaterThanOrEqual(0);
    expect(child.right).toBeLessThanOrEqual(320);
    expect(child.scroll).toBeLessThanOrEqual(child.width + 1);
  }
  await expect(
    page.getByRole('button', { name: 'Retry connection' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retry connection' }).click();
});

test('one-frame intervals preserve physical frame geometry', async ({
  page,
}, info) => {
  const path = info.outputPath('long-source.mp4');
  mkdirSync(resolve(path, '..'), { recursive: true });
  const fixture = spawnSync(
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
      'color=c=blue:s=16x16:r=30:d=60',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      path,
    ],
    { timeout: 30000, encoding: 'utf8', windowsHide: true },
  );
  expect(fixture.status, fixture.stderr).toBe(0);
  await page.goto('/');
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(
    page.getByRole('button', { name: 'Browse files' }),
  ).toBeEnabled();
  await page.getByLabel('Choose video clips').setInputFiles(
    ['short.mp4', 'long.mp4'].map((name) => ({
      name,
      mimeType: 'video/mp4',
      buffer: readFileSync(path),
    })),
  );
  await expect(page.getByRole('button', { name: 'Render MP4' })).toBeEnabled();
  await page.getByLabel('Timeline FPS', { exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Trim short.mp4' }).click();
  await page.getByLabel('Trim end frame').fill('0');
  await page.getByRole('button', { name: 'Save trim' }).click();
  const geometry = await page
    .getByRole('button', { name: 'Preview clip 1: short.mp4' })
    .evaluate((element) => {
      const block = element as HTMLElement;
      return {
        actual: block.getBoundingClientRect().width,
        expected:
          (block.parentElement!.getBoundingClientRect().width *
            parseFloat(block.style.width)) /
          100,
      };
    });
  expect(geometry.expected).toBeLessThan(14);
  expect(Math.abs(geometry.actual - geometry.expected)).toBeLessThan(0.1);
});
