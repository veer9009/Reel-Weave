import { test, expect } from '@playwright/test';
import {
  generateAdvancedMedia,
  generateContinuityVideo,
} from './mediaFixtures';

test('empty editor dedicates space to picture and a complete editing surface', async ({
  page,
}, info) => {
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(
      page.getByText('Backend ready', { exact: true }),
    ).toBeVisible();
    const canvas = (await page.locator('.program-canvas').boundingBox())!;
    expect(canvas.height).toBeGreaterThanOrEqual(width === 1366 ? 210 : 440);
    const timeline = (await page.locator('.project-timeline').boundingBox())!;
    expect(timeline.y + timeline.height).toBeLessThanOrEqual(height);
    if (width === 1366) expect(timeline.height).toBeLessThanOrEqual(350);
    const sections = page.locator('.inspector details');
    await expect(sections.locator('summary')).toHaveCount(5);
    await expect(page.locator('.inspector details[open]')).toHaveCount(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      path: info.outputPath(`empty-${width}x${height}.png`),
    });
    await page
      .locator('.inspector details[data-section="delivery"] > summary')
      .click();
    await expect(page.getByLabel('MOV', { exact: true })).toBeVisible();
    await page
      .locator('.inspector details[data-section="delivery"] > summary')
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test('populated library, contextual inspector and timeline stay usable on laptop and desktop', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  const moving = generateContinuityVideo(info.outputPath('moving'));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles([moving, media.base, media.takeA]);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
  await page
    .getByLabel('Import Media', { exact: true })
    .setInputFiles([moving, media.takeA, media.music]);
  await expect(page.locator('.media-bin-source')).toHaveCount(3);
  await expect(page.locator('.media-source-thumbnail')).toHaveCount(2);
  await page
    .locator('.inspector details[data-section="audio"] > summary')
    .click();
  await page
    .getByLabel('Choose background audio', { exact: true })
    .setInputFiles(media.music);
  await expect(
    page.getByRole('button', { name: /^Select Background music/ }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Preview clip 1: base60.mp4', exact: true })
    .click();
  await expect(
    page.locator('.inspector details[data-section="clip"]'),
  ).toHaveAttribute('open');
  await expect(
    page.locator('.inspector details[data-section="audio"]'),
  ).not.toHaveAttribute('open');
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    const grid = await page
      .locator('.media-source-grid')
      .evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
      );
    expect(grid).toBeGreaterThanOrEqual(2);
    const timeline = (await page.locator('.project-timeline').boundingBox())!;
    for (const target of await page
      .locator('.timeline-tools button, .timeline-track')
      .all()) {
      const box = (await target.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(
        timeline.y + timeline.height,
      );
    }
    await expect(
      page.getByRole('button', { name: 'Play preview', exact: true }),
    ).toBeInViewport();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      path: info.outputPath(`populated-${width}x${height}.png`),
    });
  }
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(
    page.getByRole('button', { name: 'Redo', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save Project', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Move base.mp4 up', exact: true })
    .click();
  await expect(page.locator('.clip-list .clip-details h3').first()).toHaveText(
    'base.mp4',
  );
  await page
    .getByRole('button', { name: 'Trim base.mp4', exact: true })
    .click();
  const trimStart = page.getByLabel('Trim start frame', { exact: true });
  await trimStart.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(trimStart).toHaveValue('1');
  await page.getByRole('button', { name: 'Save trim', exact: true }).click();
  await page
    .getByRole('button', { name: 'Preview clip 1: base.mp4', exact: true })
    .click();
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
  const tools = page.getByRole('toolbar', { name: 'Timeline Tools' });
  await seek(20);
  await tools.getByRole('button', { name: 'Split Video', exact: true }).click();
  await expect(
    page.locator('.timeline-track[aria-label="VIDEO 1"] .timeline-video-card'),
  ).toHaveCount(4);
  await tools.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.locator('.timeline-track[aria-label="VIDEO 1"] .timeline-video-card'),
  ).toHaveCount(3);
  await tools.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(
    page.locator('.timeline-track[aria-label="VIDEO 1"] .timeline-video-card'),
  ).toHaveCount(4);
  await page
    .locator(
      '.timeline-track[aria-label="VIDEO 1"] .timeline-video-card > .video-block',
    )
    .nth(1)
    .click();
  await tools
    .getByRole('button', { name: 'Detach Audio', exact: true })
    .click();
  await expect(page.locator('.independent-audio-card')).toHaveCount(1);
  await page.locator('.independent-audio-card > .audio-block').click();
  await seek(30);
  await tools.getByRole('button', { name: 'Split Audio', exact: true }).click();
  await expect(page.locator('.independent-audio-card')).toHaveCount(2);
  await tools
    .getByRole('button', { name: 'Ripple Delete selected', exact: true })
    .click();
  await expect(page.locator('.independent-audio-card')).toHaveCount(1);
  await tools.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.independent-audio-card')).toHaveCount(2);
});
