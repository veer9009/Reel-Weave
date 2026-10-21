import { test, expect } from '@playwright/test';

for (const width of [1536, 1440, 320])
  test(`audio feedback and left tools keep stable geometry at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto('/');
    await expect(
      page.getByText('Backend ready', { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(
      page.getByRole('heading', { name: 'Program', exact: true }),
    ).toBeVisible();
    const feedback = page.getByRole('status', { name: 'Preview feedback' });
    await expect(feedback).toBeVisible();
    const geometry = () =>
      page.evaluate(() =>
        ['.program-monitor', '.program-canvas', '.project-timeline'].map(
          (selector) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y + window.scrollY,
              width: r.width,
              height: r.height,
            };
          },
        ),
      );
    const before = await geometry();
    // Exercise long status content at the DOM boundary without corrective test CSS.
    await feedback.evaluate((element) => {
      const p = document.createElement('p');
      p.textContent =
        'Sound preview needs attention. Check the source or resume audio. '.repeat(
          30,
        );
      element.append(p);
    });
    const after = await geometry();
    for (let i = 0; i < before.length; i++)
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(
          Math.abs(before[i][key] - after[i][key]),
          JSON.stringify({ i, key, before, after }),
        ).toBeLessThanOrEqual(1);
    const rail = await page
      .getByRole('toolbar', { name: 'Timeline Tools' })
      .boundingBox();
    const tracks = await page
      .getByLabel('Scrollable timeline', { exact: true })
      .boundingBox();
    expect(rail!.x + rail!.width).toBeLessThanOrEqual(tracks!.x);
    await expect(
      page.getByRole('button', { name: 'Split Audio', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('workspace.png'),
      fullPage: true,
    });
  });
