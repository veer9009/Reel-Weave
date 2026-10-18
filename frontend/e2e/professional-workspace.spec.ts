import { test, expect, type Page } from '@playwright/test';
import { generateAdvancedMedia } from './mediaFixtures';

const viewports = [
  [1440, 900],
  [1920, 1080],
  [1280, 720],
  [1279, 800],
  [1024, 768],
  [900, 800],
  [899, 800],
  [768, 1024],
  [320, 800],
  [1440, 600],
] as const;

async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Backend ready', { exact: true })).toBeVisible();
}

test('desktop_shell_uses_available_width_without_clipping', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page.screenshot({
    path: info.outputPath('desktop-empty-before-or-after.png'),
    fullPage: true,
  });
  const header = await page.locator('.site-header').boundingBox();
  expect(header!.height).toBe(56);
  const metrics = await page.locator('.editing-workspace').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      padding: style.paddingLeft,
      width: node.getBoundingClientRect().width,
    };
  });
  expect(metrics.padding).toBe('12px');
  expect(metrics.width).toBe(1440);
  expect(
    await page
      .locator('.workspace-panels')
      .evaluate((node) => getComputedStyle(node).columnGap),
  ).toBe('8px');
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
});

test('breakpoints_keep_all_actions_and_internal_timeline_scroll', async ({
  page,
}, info) => {
  await openWorkspace(page);
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await expect(page.getByLabel('Choose video clips')).toBeAttached();
    await expect(page.getByLabel('Import video to bin')).toBeVisible();
    await expect(page.getByLabel('Import audio to bin')).toBeVisible();
    await expect(page.getByLabel('Inspector')).toBeVisible();
    await expect(page.getByLabel('MP4', { exact: true })).toBeChecked();
    for (const name of ['MP4', 'MOV', 'WAV', 'MP3'])
      await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    const layout = await page
      .locator('.workspace-panels')
      .evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
      );
    expect(layout).toBe(width >= 1280 ? 3 : width >= 900 ? 2 : 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const inner = await page.locator('.timeline-inner').boundingBox();
    expect(inner!.width).toBeGreaterThanOrEqual(760);
    const tools = page.getByRole('toolbar', { name: 'Timeline Tools' });
    await expect(tools.getByRole('button')).toHaveCount(4);
    for (const button of await tools.getByRole('button').all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: info.outputPath(`empty-${width}x${height}.png`),
      fullPage: true,
    });
  }
});

test('reflow_preserves_monitor_and_inspector_instances', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await openWorkspace(page);
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Preview clip 1: base.mp4', exact: true })
    .click();
  await page.evaluate(() => {
    const state = {
      videos: [...document.querySelectorAll('.program-canvas video')],
      inspector: document.querySelector('.inspector'),
      frame: (
        document.querySelector(
          '[aria-label="Timeline position"]',
        ) as HTMLInputElement
      ).value,
    };
    (window as unknown as { uiIdentity: typeof state }).uiIdentity = state;
  });
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => {
        const state = (
          window as unknown as {
            uiIdentity: {
              videos: Element[];
              inspector: Element;
              frame: string;
            };
          }
        ).uiIdentity;
        return (
          state.videos.every(
            (node, index) =>
              node ===
              document.querySelectorAll('.program-canvas video')[index],
          ) &&
          state.inspector === document.querySelector('.inspector') &&
          state.frame ===
            (
              document.querySelector(
                '[aria-label="Timeline position"]',
              ) as HTMLInputElement
            ).value
        );
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`populated-${width}x${height}.png`),
      fullPage: true,
    });
  }
});

test('long_media_names_do_not_widen_workspace', async ({ page }, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await page.setViewportSize({ width: 320, height: 800 });
  await openWorkspace(page);
  const { readFileSync } = await import('node:fs');
  const name =
    'client-review-final-picture-version-with-a-very-long-descriptive-name.mp4';
  await page.getByLabel('Import video to bin', { exact: true }).setInputFiles({
    name,
    mimeType: 'video/mp4',
    buffer: readFileSync(media.base),
  });
  const place = page.getByRole('button', {
    name: `Place ${name} on track`,
    exact: true,
  });
  await expect(place).toBeEnabled();
  await expect(
    page.getByRole('button', { name: `Use ${name} as PIP`, exact: true }),
  ).toHaveText('Use as PIP');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await place.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Placement start frame')).toBeVisible();
  await page.getByLabel('Placement start frame').fill('25');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByLabel('Placement start frame')).toHaveValue('25');
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByLabel('Placement start frame')).toHaveValue('25');
  await page.screenshot({
    path: info.outputPath('placement-draft-320.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('long-media-320.png'),
    fullPage: true,
  });
});

test('tools_show_keyboard_tooltips_on_focus', async ({ page }, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await openWorkspace(page);
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Preview clip 1: base.mp4', exact: true })
    .click();
  await page
    .getByLabel('Timeline position', { exact: true })
    .evaluate((node) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(node, '25');
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
  const split = page
    .getByRole('toolbar', { name: 'Timeline Tools' })
    .getByRole('button', { name: 'Split at playhead', exact: true });
  await expect(split).toBeEnabled();
  await page.keyboard.press('Tab');
  await split.focus();
  await expect(split).toBeFocused();
  expect(
    await split.evaluate((node) => getComputedStyle(node, '::after').content),
  ).toContain('Split at playhead');
});

test('fixed_labels_survive_horizontal_scroll', async ({ page }, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await page.setViewportSize({ width: 320, height: 800 });
  await openWorkspace(page);
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  const label = page.locator('#video1-header');
  const before = (await label.boundingBox())!.x;
  await page
    .getByLabel('Scrollable timeline', { exact: true })
    .evaluate((node) => {
      node.scrollLeft = 200;
    });
  expect((await label.boundingBox())!.x).toBe(before);
  await expect(
    page.getByLabel('Timeline position', { exact: true }),
  ).toBeAttached();
  await page.screenshot({
    path: info.outputPath('fixed-labels-320.png'),
    fullPage: true,
  });
});

test('delivery_partial_results_keep_truthful_states_and_restrained_chrome', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  const job = {
    job_id: 'ui-result',
    status: 'processing',
    error: null,
    exports: {
      mp4: { status: 'ready', error: null },
      mov: { status: 'processing', error: null },
      wav: { status: 'failed', error: 'UI fixture: optional encoding failed.' },
    },
  };
  await page.route('**/api/merge', (route) =>
    route.fulfill({ status: 202, json: job }),
  );
  await page.route('**/api/jobs/ui-result', (route) =>
    route.fulfill({ json: job }),
  );
  await page.route('**/api/jobs/ui-result/video', (route) =>
    route.fulfill({ path: media.base, contentType: 'video/mp4' }),
  );
  await openWorkspace(page);
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MP4 ready' })).toBeVisible();
  await expect(
    page.getByText('MOV: processing', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/UI fixture: optional encoding failed/),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Download MP4', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Download WAV', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'New project', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('partial-results.png'),
    fullPage: true,
  });
  expect(
    await page
      .locator('.result')
      .evaluate((node) => getComputedStyle(node).backgroundImage),
  ).toBe('none');
});

test('queued_processing_failure_and_poll_retry_stay_visible', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  let phase = 'queued';
  let failPoll = true;
  const job = () => ({
    job_id: 'ui-progress',
    status: phase,
    error: phase === 'failed' ? 'UI fixture: render failed safely.' : null,
  });
  await page.route('**/api/merge', (route) =>
    route.fulfill({ status: 202, json: job() }),
  );
  await page.route('**/api/jobs/ui-progress', (route) => {
    if (failPoll) {
      failPoll = false;
      return route.abort('failed');
    }
    return route.fulfill({ json: job() });
  });
  await openWorkspace(page);
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry status', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('poll-failure.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Retry status', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Queued', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.summary .primary-button')).toBeDisabled();
  await page.screenshot({
    path: info.outputPath('queued.png'),
    fullPage: true,
  });
  phase = 'processing';
  await expect(
    page.getByRole('heading', { name: 'Rendering MP4', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Keep this tab open while the backend processes your media.',
    ),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('processing.png'),
    fullPage: true,
  });
  phase = 'failed';
  await expect(page.getByText('Render failed', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath('render-failed.png'),
    fullPage: true,
  });
});

test('workspace_chrome_has_flat_panels_and_unclipped_labels', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  for (const selector of [
    '.program-monitor',
    '.project-timeline',
    '.inspector-content .panel',
  ]) {
    for (const panel of await page.locator(selector).all())
      expect(
        await panel.evaluate((node) => getComputedStyle(node).backgroundImage),
      ).toBe('none');
  }
  for (const label of await page.locator('.timeline-track > h3').all()) {
    expect(
      await label.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  }
});

test('populated_picture_overlay_audio_and_music_lanes_stay_distinct', async ({
  page,
}, info) => {
  const media = generateAdvancedMedia(info.outputPath('media'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page
    .getByLabel('Choose video clips', { exact: true })
    .setInputFiles(media.base);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
  await page
    .getByLabel('Choose replacement video', { exact: true })
    .setInputFiles(media.takeA);
  await page
    .getByRole('button', { name: 'Save replacement', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /^Select Video 2/ }),
  ).toBeVisible();
  await page
    .getByLabel('Choose video overlay', { exact: true })
    .setInputFiles(media.pip);
  await expect(
    page.getByLabel('Video overlay start frame', { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('Choose image overlay', { exact: true })
    .setInputFiles(media.image);
  await expect(
    page.getByLabel('Image overlay start frame', { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('Choose background audio', { exact: true })
    .setInputFiles(media.music);
  await expect(
    page.getByRole('button', { name: /^Select Background music/ }),
  ).toBeVisible();
  await page
    .getByLabel('Import audio to bin', { exact: true })
    .setInputFiles(media.music);
  const place = page.getByRole('button', { name: /Place .* on track/ });
  await expect(place).toBeEnabled();
  await place.click();
  await page
    .getByLabel('Placement track', { exact: true })
    .selectOption('independent');
  await page.getByRole('button', { name: 'Place media', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Original\/Replacement Audio/ }),
  ).toBeVisible();
  const pictureColors = await page
    .locator(
      '.timeline-track[aria-label="VIDEO 1"] .video-block, .timeline-track[aria-label="VIDEO 2"] .video-block',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).backgroundColor),
    );
  expect(new Set(pictureColors).size).toBe(2);
  const musicColor = await page
    .getByRole('region', { name: 'AUDIO 2', exact: true })
    .locator('.video-block')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(pictureColors).not.toContain(musicColor);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [
    [1440, 900],
    [320, 800],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`all-lanes-${width}.png`),
      fullPage: true,
    });
  }
});
