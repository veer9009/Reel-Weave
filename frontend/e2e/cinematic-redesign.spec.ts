import { test, expect } from '@playwright/test';
import { generateAdvancedMedia } from './mediaFixtures';

test('cinematic workspace has continuous side panels and readable editing chrome', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const label of await page.locator('.timeline-track > h3').all()) {
    await expect(label).toBeVisible();
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({ path: info.outputPath('empty-workspace.png') });
  await expect(
    page
      .locator('.media-panel')
      .getByRole('heading', { name: 'Media', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector', exact: true })
      .getByRole('heading', { name: 'Inspector', exact: true }),
  ).toBeVisible();
  for (const selector of ['.media-panel', '.inspector', '.program-monitor']) {
    const panel = await page.locator(selector).evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        border: parseFloat(style.borderTopWidth),
        fill: style.backgroundColor,
      };
    });
    expect(panel.border).toBeGreaterThanOrEqual(1);
    expect(panel.fill).not.toBe('rgba(0, 0, 0, 0)');
  }
  const tools = page.getByRole('toolbar', { name: 'Timeline Tools' });
  for (const button of await tools.getByRole('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(
      ['Undo', 'Redo'].includes((await button.getAttribute('aria-label')) ?? '')
        ? 44
        : 68,
    );
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(
      await button
        .locator('span')
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    ).toBeGreaterThanOrEqual(11);
  }
});

test('populated cinematic workspace preserves real media and panel hierarchy', async ({
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
  await page
    .getByLabel('Import Media', { exact: true })
    .setInputFiles([media.base, media.music]);
  await expect(
    page.getByRole('button', { name: /Place .* on track/ }),
  ).toHaveCount(2);
  await page
    .getByLabel('Choose background audio', { exact: true })
    .setInputFiles(media.music);
  await page
    .getByRole('button', { name: 'Preview clip 1: base.mp4', exact: true })
    .click();
  for (const [width, height] of [
    [1536, 1024],
    [1440, 900],
    [1920, 1080],
    [1366, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(
      page.getByRole('button', { name: 'Play preview', exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole('button', { name: 'Import Media', exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const frameOrigin = await page.evaluate(() => ({
      playhead: document
        .querySelector('.timeline-playhead')!
        .getBoundingClientRect().left,
      lane: document.querySelector('.track-content')!.getBoundingClientRect()
        .left,
    }));
    expect(
      Math.abs(frameOrigin.playhead - frameOrigin.lane),
    ).toBeLessThanOrEqual(1);
    const labels = await page
      .locator('.timeline-track > h3')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const text = range.getBoundingClientRect();
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            label: node.textContent,
            textX: text.x,
            textY: text.y,
            textWidth: text.width,
            textHeight: text.height,
            boxX: box.x,
            boxY: box.y,
            width: box.width,
            height: box.height,
            color: style.color,
            opacity: style.opacity,
          };
        }),
      );
    await info.attach(`labels-${width}`, {
      body: JSON.stringify(labels, null, 2),
      contentType: 'application/json',
    });
    for (const label of labels) {
      expect(label.textWidth).toBeGreaterThan(20);
      expect(label.textHeight).toBeGreaterThan(10);
      expect(label.textY).toBeGreaterThanOrEqual(label.boxY);
      expect(label.textY + label.textHeight).toBeLessThanOrEqual(
        label.boxY + label.height,
      );
    }
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
  await expect(
    page.getByLabel('Uploaded clip preview', { exact: true }),
  ).toHaveAttribute('src', /^blob:/);
  await expect(
    page.getByRole('button', { name: 'Save Project', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [768, 1024],
    [320, 800],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const source of await page.locator('.media-bin-source').all()) {
      const bounds = (await source.boundingBox())!;
      for (const button of await source.getByRole('button').all()) {
        const action = (await button.boundingBox())!;
        expect(action.x).toBeGreaterThanOrEqual(bounds.x);
        expect(action.x + action.width).toBeLessThanOrEqual(
          bounds.x + bounds.width,
        );
      }
    }
    await page.screenshot({
      path: info.outputPath(`populated-${width}x${height}.png`),
      fullPage: true,
    });
  }
});
