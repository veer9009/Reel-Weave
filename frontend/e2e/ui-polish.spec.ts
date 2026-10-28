import { test, expect } from '@playwright/test';
import { generateAdvancedMedia } from './mediaFixtures';

function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const values = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((v) => {
        const c = Number(v) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('200-percent-equivalent scaling keeps editing controls reachable', async ({
  browser,
  baseURL,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 768, height: 512 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    const media = generateAdvancedMedia(info.outputPath('media'));
    await page.goto(baseURL!);
    await expect(
      page.getByText('Backend ready', { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('Choose video clips', { exact: true })
      .setInputFiles(media.base);
    await expect(
      page.getByRole('button', { name: 'Render MP4', exact: true }),
    ).toBeEnabled();
    const play = page.getByRole('button', {
      name: 'Play preview',
      exact: true,
    });
    await play.scrollIntoViewIfNeeded();
    await expect(play).toBeInViewport();
    await page
      .getByLabel('Timeline FPS', { exact: true })
      .scrollIntoViewIfNeeded();
    const tools = page.getByRole('toolbar', { name: 'Timeline Tools' });
    await tools.scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scale: devicePixelRatio,
      overflow: document.documentElement.scrollWidth > innerWidth,
      toolsRight: document
        .querySelector('.timeline-tools')!
        .getBoundingClientRect().right,
      tracksLeft: document
        .querySelector('.timeline-scroll')!
        .getBoundingClientRect().left,
    }));
    expect(geometry.width).toBe(768);
    expect(geometry.scale).toBe(2);
    expect(geometry.overflow).toBe(false);
    expect(geometry.toolsRight).toBeLessThanOrEqual(geometry.tracksLeft);
    for (const button of await tools.getByRole('button').all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    const reason = page.locator('#split-audio-reason');
    await reason.focus();
    await expect(reason).toBeFocused();
    await expect(reason).toBeInViewport();
    await page.screenshot({ path: info.outputPath('scaled-200-percent.png') });
  } finally {
    await context.close();
  }
});

test('essential import limits remain readable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
  const limits = page.locator('.upload-meta');
  await expect(limits).toContainText('Up to 20 clips');
  const box = (await limits.boundingBox())!;
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(12);
  const notice = page.locator('.program-feedback .preview-note');
  await expect(notice).toContainText('approximate');
  const noticeBox = (await notice.boundingBox())!;
  expect(noticeBox.width).toBeGreaterThan(100);
  expect(noticeBox.height).toBeGreaterThanOrEqual(18);
});

test('spacious workspace follows the approved panel proportions', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
  for (const [width, height] of [
    [1536, 1024],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    const panels = await page
      .locator('.workspace-panels > *')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().width),
      );
    const available = panels.reduce((sum, width) => sum + width, 0);
    for (const [index, fraction] of [0.25, 0.5, 0.25].entries())
      expect(Math.abs(panels[index] / available - fraction)).toBeLessThan(
        0.015,
      );
    const monitor = (await page.locator('.program-monitor').boundingBox())!;
    const timeline = (await page.locator('.project-timeline').boundingBox())!;
    expect(monitor.height).toBeGreaterThan(timeline.height);
    if (height >= 1000)
      expect(timeline.height).toBeLessThanOrEqual((height - 56) * 0.43);
    await page.screenshot({
      path: info.outputPath(`empty-${width}x${height}.png`),
    });
  }
});

test('disabled audio guidance stays readable and keyboard reachable', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
  const reason = page.locator('#split-audio-reason');
  await expect(reason).toContainText('Select an editable audio segment');
  await expect(reason).toHaveAttribute('tabindex', '0');
  const readable = await reason.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return box.width >= 200 && box.height >= 18 && style.clip === 'auto';
  });
  expect(readable).toBe(true);
});

test('populated desktop workspace keeps monitor, left tools and every track in view', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  const controls = await page
    .locator(
      '.site-header > .primary-button, .import-media-button, .program-transport button, .timeline-tools button:not(:disabled)',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        let parent = node.parentElement;
        while (
          parent &&
          getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)'
        )
          parent = parent.parentElement;
        return {
          name: node.textContent || node.getAttribute('aria-label'),
          text: style.color,
          fill: style.backgroundColor,
          border: style.borderTopColor,
          outside: getComputedStyle(parent!).backgroundColor,
        };
      }),
    );
  for (const control of controls) {
    expect(
      contrast(control.text, control.fill),
      `${control.name} text`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      Math.max(
        contrast(control.fill, control.outside),
        contrast(control.border, control.outside),
      ),
      `${control.name} boundary`,
    ).toBeGreaterThanOrEqual(3);
  }
  await page
    .getByLabel('Import Media', { exact: true })
    .setInputFiles([media.base, media.music]);
  await expect(
    page.getByRole('button', { name: /Place .* on track/ }),
  ).toHaveCount(2);
  await page
    .getByLabel('Choose background audio', { exact: true })
    .setInputFiles(media.music);
  await expect(
    page.getByRole('button', { name: /^Select Background music/ }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Preview clip 1: base.mp4', exact: true })
    .click();
  for (const [width, height] of [
    [1366, 768],
    [1536, 1024],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const layout = await page.evaluate(() => {
      const rect = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      const monitor = rect('.program-monitor');
      const canvas = rect('.program-canvas');
      const timeline = rect('.project-timeline');
      const tools = rect('.timeline-tools');
      const tracks = rect('.timeline-scroll');
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        monitorBottom: monitor.bottom,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        timelineTop: timeline.top,
        timelineBottom: timeline.bottom,
        toolsRight: tools.right,
        tracksLeft: tracks.left,
        trackBottoms: [...document.querySelectorAll('.timeline-track')].map(
          (node) => node.getBoundingClientRect().bottom,
        ),
        toolBottoms: [
          ...document.querySelectorAll('.timeline-tools button'),
        ].map((node) => node.getBoundingClientRect().bottom),
      };
    });
    expect(layout.overflow).toBe(false);
    // Overlay percentages must address the same 16:9 frame as final exports.
    expect(
      Math.abs(layout.canvasWidth - (layout.canvasHeight * 16) / 9),
    ).toBeLessThanOrEqual(1);
    expect(layout.monitorBottom).toBeLessThanOrEqual(layout.timelineTop);
    expect(layout.timelineBottom).toBeLessThanOrEqual(height);
    expect(layout.toolsRight).toBeLessThanOrEqual(layout.tracksLeft);
    expect(layout.trackBottoms).toHaveLength(5);
    expect(layout.toolBottoms).toHaveLength(6);
    for (const bottom of layout.toolBottoms)
      expect(bottom).toBeLessThanOrEqual(layout.timelineBottom);
    for (const bottom of layout.trackBottoms)
      expect(bottom).toBeLessThanOrEqual(
        Math.min(height, layout.timelineBottom),
      );
    await expect(
      page.getByRole('button', { name: 'Import Media', exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole('button', { name: 'Play preview', exact: true }),
    ).toBeInViewport();
    await expect(page.getByLabel('Current time and frame')).toContainText(
      '00:00.000',
    );
    await expect(
      page.getByRole('toolbar', { name: 'Timeline Tools' }).getByRole('button'),
    ).toHaveCount(6);
    await page.screenshot({
      path: info.outputPath(`workspace-${width}x${height}.png`),
    });
  }
  await page
    .locator('.inspector details[data-section="audio"] > summary')
    .click();
  await page
    .getByLabel('Original audio volume', { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByLabel('Original audio volume', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Music volume', { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Mute original audio', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Mute music', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Volume and mute affect every segment on their audio bus.', {
      exact: true,
    }),
  ).toBeVisible();
});
