import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { generateContinuityVideo } from './mediaFixtures';

// This measures real DOM geometry and native/DOM positions, not a pixel freeze.
for (const speed of ['1', '0.75', '0.5'])
  test(`reserved preview status at speed ${speed}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      const records: unknown[] = [];
      const box = (selector: string) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return (
          rect && {
            x: rect.x,
            y: rect.y,
            documentY: rect.y + window.scrollY,
            width: rect.width,
            height: rect.height,
          }
        );
      };
      const state = {
        records,
        record(label: string) {
          const video = document.querySelector<HTMLVideoElement>(
            '[aria-label="Uploaded clip preview"]',
          );
          records.push({
            label,
            preparing:
              document.querySelector('.program-monitor > [role="status"]')
                ?.textContent === 'Preparing Preview',
            frame: Number(
              document.querySelector<HTMLInputElement>(
                '[aria-label="Timeline position"]',
              )?.value,
            ),
            time: video?.currentTime,
            paused: video?.paused,
            canvas: box('.program-canvas'),
            monitor: box('.program-monitor'),
            status: box('.program-status'),
            timeline: box('.project-timeline'),
            playhead: box('.timeline-playhead'),
          });
        },
      };
      Object.assign(window, { playPauseBaseline: state });
      // Hold initial audio preparation so both static UI states can be captured
      // reliably. Native resume runs unchanged when the test releases it.
      const resume = AudioContext.prototype.resume;
      let firstResume = true;
      let releaseAudio = () => {};
      Object.assign(window, { releasePlayPauseAudio: () => releaseAudio() });
      AudioContext.prototype.resume = function () {
        if (!firstResume) return resume.call(this);
        firstResume = false;
        return new Promise<void>((resolve, reject) => {
          releaseAudio = () => {
            void resume.call(this).then(resolve, reject);
          };
        });
      };
      let previous: boolean | undefined;
      new MutationObserver(() => {
        if (!document.querySelector('.program-canvas')) return;
        const preparing =
          document.querySelector('.program-monitor > [role="status"]')
            ?.textContent === 'Preparing Preview';
        if (preparing !== previous) {
          previous = preparing;
          state.record('readiness-layout');
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    try {
      const short = generateContinuityVideo(info.outputPath('media'));
      const source = info.outputPath('play-pause.mp4');
      const repeated = spawnSync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-stream_loop',
          '4',
          '-i',
          short,
          '-c',
          'copy',
          '-t',
          '30',
          source,
        ],
        { windowsHide: true, timeout: 60_000 },
      );
      if (repeated.status !== 0) throw new Error(String(repeated.stderr));
      await page.goto('/');
      await expect(
        page.getByText('Backend ready', { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel('Choose video clips', { exact: true })
        .setInputFiles(source);
      await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
      await page
        .getByLabel('Speed for play-pause.mp4', { exact: true })
        .selectOption(speed);
      await page
        .getByRole('button', {
          name: 'Preview clip 1: play-pause.mp4',
          exact: true,
        })
        .click();
      const video = page.getByLabel('Uploaded clip preview', { exact: true });
      const position = page.getByLabel('Timeline position', { exact: true });
      const mark = (label: string) =>
        page.evaluate(
          (label) =>
            (
              window as unknown as {
                playPauseBaseline: { record: (label: string) => void };
              }
            ).playPauseBaseline.record(label),
          label,
        );
      await mark('before-play');
      await page.screenshot({ path: info.outputPath('before-play.png') });
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      await expect(
        page.getByText('Preparing Preview', { exact: true }),
      ).toBeVisible();
      await mark('held-preparation');
      await page.screenshot({ path: info.outputPath('preparing.png') });
      await page.evaluate(() =>
        (
          window as unknown as { releasePlayPauseAudio: () => void }
        ).releasePlayPauseAudio(),
      );
      await expect
        .poll(() =>
          video.evaluate((node) => (node as HTMLVideoElement).currentTime),
        )
        .toBeGreaterThan(0.3 * Number(speed));
      await expect
        .poll(async () => Number(await position.inputValue()))
        .toBeGreaterThan(0);
      await mark('playing');
      await page
        .getByRole('button', { name: 'Pause preview', exact: true })
        .click();
      await expect
        .poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused))
        .toBe(true);
      await mark('paused');
      const pausedAt = await video.evaluate(
        (node) => (node as HTMLVideoElement).currentTime,
      );
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      await expect
        .poll(() =>
          video.evaluate((node) => (node as HTMLVideoElement).currentTime),
        )
        .toBeGreaterThan(pausedAt + 0.12 * Number(speed));
      await mark('resumed');
      await page.screenshot({ path: info.outputPath('resumed.png') });
      const geometry = await page.evaluate(() => {
        const records = (
          window as unknown as {
            playPauseBaseline: {
              records: {
                label: string;
                canvas: { documentY: number };
                monitor: { documentY: number };
                status?: { height: number };
                timeline: { documentY: number };
              }[];
            };
          }
        ).playPauseBaseline.records;
        return records.slice(
          records.findIndex((entry) => entry.label === 'before-play'),
        );
      });
      expect(geometry.map((entry) => entry.label)).toEqual(
        expect.arrayContaining([
          'held-preparation',
          'playing',
          'paused',
          'resumed',
        ]),
      );
      for (const entry of geometry) {
        expect(entry.monitor.documentY).toBe(geometry[0].monitor.documentY);
        expect(entry.canvas.documentY).toBe(geometry[0].canvas.documentY);
        expect(entry.timeline.documentY).toBe(geometry[0].timeline.documentY);
        expect(entry.status?.height ?? 0).toBeGreaterThan(0);
      }
    } finally {
      const records = await page
        .evaluate(
          () =>
            (
              window as unknown as {
                playPauseBaseline?: { records: unknown[] };
              }
            ).playPauseBaseline?.records ?? [],
        )
        .catch(() => []);
      writeFileSync(
        info.outputPath('play-pause-layout.json'),
        JSON.stringify({ speed, records }, null, 2),
      );
    }
  });
