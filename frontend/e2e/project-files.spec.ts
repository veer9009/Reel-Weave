import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  createBrowserProject,
  generateProjectFileMedia,
  normalizeProjectRequestIds,
  parseProjectRender,
  projectMediaPaths,
} from './projectFileFixtures';
import type { ProjectFileMedia } from './projectFileFixtures';
import type { ProjectDocumentV1 } from '../src/lib/projectFileTypes';
let media: ProjectFileMedia;
test.beforeAll(({ browserName }, info) => {
  media = generateProjectFileMedia(
    info.outputPath(browserName, 'project-media'),
  );
});
async function start(page: Page, offline = false) {
  await page.route('**/api/health', (route) =>
    offline
      ? route.abort()
      : route.fulfill({
          json: {
            status: 'ok',
            ffmpeg_available: true,
            ffprobe_available: true,
            limits: { max_clips: 20, max_file_size_mb: 200 },
            export_capabilities: { mov: true, wav: true, mp3: true },
          },
        }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeEnabled();
}
async function choose(page: Page, value: ProjectDocumentV1 | string) {
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({
    name: 'edit.avstudio.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      typeof value === 'string' ? value : JSON.stringify(value),
    ),
  });
  return page.getByRole('dialog', { name: 'Open Project' });
}
async function install(
  page: Page,
  d: ProjectDocumentV1,
  paths = projectMediaPaths(media),
) {
  const dialog = await choose(page, d);
  await dialog.getByLabel('Choose project media files').setInputFiles(paths);
  await expect(
    dialog.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole('button', { name: 'Open Project', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function save(page: Page, folder: string): Promise<ProjectDocumentV1> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Project', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(
    /^AVStudio-project-\d{4}-\d{2}-\d{2}-\d{6}\.avstudio\.json$/,
  );
  const path = `${folder}/${download.suggestedFilename()}`;
  await download.saveAs(path);
  return JSON.parse(readFileSync(path, 'utf8'));
}
test('B01 full roundtrip in a fresh context preserves every track and render upload bytes', async ({
  page,
  browser,
}, info) => {
  await start(page);
  const d = createBrowserProject(media, true);
  await install(page, d, projectMediaPaths(media, true));
  const saved = await save(page, info.outputPath('first'));
  expect(saved.sources).toHaveLength(6);
  expect(saved.edit.video1.map((v) => v.speed)).toEqual([1, 0.5]);
  expect(saved.edit.video2[0].speed).toBe(0.75);
  expect(saved.edit.independentAudio).toHaveLength(2);
  expect(saved.edit.music).toHaveLength(2);
  expect(saved.exportSettings.formats).toEqual(['mp4', 'mov', 'wav', 'mp3']);
  expect(JSON.stringify(saved)).not.toMatch(/blob:|data:|"file"|"token"/);
  const requests: ReturnType<typeof parseProjectRender>[] = [];
  const intercept = async (p: Page) =>
    p.route('**/api/merge', async (route) => {
      const request = route.request();
      requests.push(
        parseProjectRender(
          request.postDataBuffer()!,
          request.headers()['content-type'],
        ),
      );
      await route.fulfill({
        status: 503,
        json: { error: { code: 'busy', message: 'Test submission captured.' } },
      });
    });
  await intercept(page);
  await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await start(fresh);
  await install(fresh, saved, projectMediaPaths(media, true));
  const resaved = await save(fresh, info.outputPath('second'));
  await intercept(fresh);
  await fresh.getByRole('button', { name: 'Render MP4', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(normalizeProjectRequestIds(requests[1].manifest, resaved)).toEqual(
    normalizeProjectRequestIds(requests[0].manifest, saved),
  );
  expect(requests[1].files).toEqual(requests[0].files);
  expect(resaved.edit.video1[0].outputWindow).toEqual({
    outputInFrame: 5,
    outputOutFrame: 70,
  });
  await context.close();
});
test('B02 opening B over A is one undoable replacement including FPS and exports', async ({
  page,
}) => {
  await start(page);
  const a = createBrowserProject(media);
  await install(page, a);
  const b = createBrowserProject(media);
  b.edit.fpsSelection = '50';
  b.timingFps = 50;
  b.exportSettings.formats = ['mp4', 'mov'];
  b.edit.video1[0].trim.endFrame = 49;
  const dialog = await choose(page, b);
  await expect(page.getByLabel('Timeline FPS', { exact: true })).toHaveValue(
    '25',
  );
  await dialog
    .getByLabel('Choose project media files')
    .setInputFiles(media.base);
  await dialog
    .getByRole('button', { name: 'Open Project', exact: true })
    .click();
  await expect(page.getByLabel('Timeline FPS', { exact: true })).toHaveValue(
    '50',
  );
  await expect(page.getByLabel('MOV', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Timeline FPS', { exact: true })).toHaveValue(
    '25',
  );
  await expect(page.getByLabel('MOV', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Timeline FPS', { exact: true })).toHaveValue(
    '50',
  );
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('B03 missing media and same-name same-size mismatches block Open', async ({
  page,
}) => {
  await start(page);
  const d = createBrowserProject(media);
  const dialog = await choose(page, d);
  await expect(dialog.getByText('Missing', { exact: true })).toBeVisible();
  const wrong = {
    name: 'base.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(media.sameSizeWrongBase),
  };
  expect(wrong.buffer.length).toBe(d.sources[0].sizeBytes);
  await dialog.getByLabel('Choose project media files').setInputFiles(wrong);
  await expect(
    dialog.getByText('Fingerprint does not match the original media.'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel('Choose original for base.mp4, source 1')
    .setInputFiles(media.base);
  await expect(
    dialog.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeEnabled();
});
test('B04 renamed and ambiguous originals require explicit choices', async ({
  page,
}) => {
  await start(page);
  const dialog = await choose(page, createBrowserProject(media));
  await dialog
    .getByLabel('Choose project media files')
    .setInputFiles(media.renamedBase);
  await expect(
    dialog.getByText('Same media, different filename'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole('button', { name: 'Confirm renamed file for base.mp4' })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeEnabled();
  await dialog
    .getByLabel('Choose project media files')
    .setInputFiles([media.base, media.duplicateBase]);
  await expect(dialog.getByText('Choose a matching file')).toBeVisible();
  await dialog
    .getByRole('button', { name: /^Use base.mp4, candidate/ })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeEnabled();
});
test('B03 every missing image music bin and detached-only source remains required', async ({
  page,
}) => {
  await start(page);
  for (const missing of [media.image, media.music, media.silentTake]) {
    const d = createBrowserProject(media, true);
    if (missing === media.silentTake) {
      d.edit.binSourceIds = d.edit.binSourceIds.filter(
        (id) => id !== 'source_unused',
      );
      d.edit.independentAudio.push({
        id: 'detached_only',
        timelineStartFrame: 100,
        durationFrames: 10,
        sourceStartSample: 0,
        source: {
          kind: 'video-edit',
          sourceId: 'source_unused',
          sourceStartFrame: 0,
          sourceEndFrame: 19,
          speed: 1,
          normalizationFps: 25,
        },
        detachedFrom: { track: 'video1', clipId: 'removed_clip' },
      });
    }
    const dialog = await choose(page, d);
    await dialog
      .getByLabel('Choose project media files')
      .setInputFiles(
        projectMediaPaths(media, true).filter((path) => path !== missing),
      );
    await expect(
      dialog.getByText('5 of 6 sources matched', { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Open Project', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});
test('B05 corrupt unsupported oversized and mismatched projects preserve the installed project', async ({
  page,
}, info) => {
  await start(page);
  const d = createBrowserProject(media);
  await install(page, d);
  const before = await save(page, info.outputPath('before'));
  const invalids = [
    '{broken',
    JSON.stringify({ ...d, schemaVersion: 2 }),
    JSON.stringify({ schema_version: 3 }),
    ' '.repeat(5242881),
    JSON.stringify({
      ...d,
      edit: {
        ...d.edit,
        video1: [{ ...d.edit.video1[0], sourceId: 'missing' }],
      },
    }),
  ];
  for (const text of invalids) {
    const dialog = await choose(page, text);
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  const after = await save(page, info.outputPath('after'));
  expect(after).toEqual(before);
});
test('B06 cancel escape and repeated same-file selection never add history', async ({
  page,
}) => {
  await start(page);
  const d = createBrowserProject(media);
  let dialog = await choose(page, d);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  dialog = await choose(page, d);
  await dialog.getByRole('button', { name: 'Choose media files' }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled();
  dialog = await choose(page, d);
  await expect(dialog.getByText('Missing', { exact: true })).toBeVisible();
});
test('B07 dialog keyboard focus and actions stay reachable on a narrow zoomed viewport', async ({
  page,
  context,
}) => {
  await start(page);
  await page.setViewportSize({ width: 320, height: 720 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  const dialog = await choose(page, createBrowserProject(media));
  await expect(
    dialog.getByRole('button', { name: 'Choose media files' }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          document.querySelector('dialog')?.contains(document.activeElement),
        ),
      ),
    )
    .toBe(true);
  await dialog
    .getByRole('button', { name: 'Cancel', exact: true })
    .scrollIntoViewIfNeeded();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Open Project', exact: true }),
  ).toBeFocused();
});
test('B08 Save Open and relink work without backend connectivity or feature network requests', async ({
  page,
}, info) => {
  await start(page, true);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('/api/') &&
      !request.url().endsWith('/api/health')
    )
      requests.push(request.url());
  });
  await install(page, createBrowserProject(media));
  await save(page, info.outputPath('offline'));
  expect(requests).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'Render MP4', exact: true }),
  ).toBeDisabled();
});
test('B09 existing transport and split remain available after relinking', async ({
  page,
}) => {
  await start(page);
  await install(page, createBrowserProject(media));
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pause preview', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Pause preview', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Play preview', exact: true }),
  ).toBeVisible();
});
test('B10 reload does not automatically restore a project or retain undo history', async ({
  page,
}) => {
  await start(page);
  await install(page, createBrowserProject(media));
  await page.route('**/api/merge', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'busy', message: 'Captured test render.' } },
    }),
  );
  await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save Project', exact: true }),
  ).toBeEnabled();
  await page.unroute('**/api/merge');
  await page.route('**/api/merge', (route) =>
    route.fulfill({
      json: {
        job_id: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
        error: null,
      },
    }),
  );
  await page.getByRole('button', { name: 'Render MP4', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save Project', exact: true }),
  ).toBeDisabled();
  await install(page, createBrowserProject(media));
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Save Project', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled();
});
