import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { generateContinuityVideo } from './mediaFixtures';

// Ordinary Play only. DOM/native progression is not pixel-freeze evidence.
for (const speed of ['1', '0.75', '0.5'])
  test(`ready Video 1 plays continuously at speed ${speed}`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      const records: unknown[] = [];
      const state = {
        records,
        record(kind: string, details: unknown) {
          records.push({ now: performance.now(), kind, details });
        },
      };
      Object.assign(window, { normalPlaybackRecovery: state });
      let previous: boolean | undefined;
      new MutationObserver(() => {
        const preparing = [
          ...document.querySelectorAll('[role="status"]'),
        ].some((node) => node.textContent === 'Preparing Preview');
        if (preparing !== previous) {
          previous = preparing;
          state.record('readiness-ui', { preparing });
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    // Observe only state-transition boundaries in served test responses. No
    // production file, native callback, readiness decision, or threshold changes.
    await page.route(
      /\/src\/hooks\/use(ProjectPlayback|ProjectAudio|PreviewMedia)\.ts(?:\?|$)/,
      async (route) => {
        const response = await route.fetch();
        let body = await response.text();
        const log = (kind: string, details: string) =>
          `window.normalPlaybackRecovery?.record(${JSON.stringify(kind)}, ${details});`;
        const replace = (pattern: RegExp, addition: string) => {
          if (!pattern.test(body))
            throw new Error(`Missing diagnostic marker: ${pattern}`);
          body = body.replace(pattern, `$& ${addition}`);
        };
        const url = route.request().url();
        if (url.includes('useProjectPlayback.ts')) {
          for (const method of ['suspend', 'ready'])
            replace(
              new RegExp(`${method}\\(token\\) \\{`),
              log(
                `transport-${method}`,
                `{
            token, pending: runtime.pending, readiness: [...readiness],
            intent: runtime.intent, status: runtime.status, generation: runtime.generation,
            position: runtime.position, presentationRevision: runtime.presentationRevision
          }`,
              ),
            );
        } else if (url.includes('useProjectAudio.ts')) {
          replace(
            /if \(generation !== o\.transport\.generation\) \{/,
            log(
              'audio-generation',
              '{generation, next: o.transport.generation, gate}',
            ),
          );
          replace(
            /const allReady = \(\) => \{/,
            log(
              'audio-all-ready-check',
              '{gate, generation, graphReady, intent: latest.transport.playingIntent}',
            ),
          );
          if (/prepareAudio\(\) \{/.test(body))
            replace(
              /prepareAudio\(\) \{/,
              log(
                'audio-prepare',
                '{gate, generation, liveGeneration: latest.transport.getSnapshot().generation}',
              ),
            );
        } else {
          replace(
            /const retired = fresh && request\?\.waiting \? request.token : null;/,
            `if (fresh || resumed) ${log(
              'picture-request',
              `{
          fresh, resumed, generation: o.generation, positionRevision: o.positionRevision,
          presentationRevision: o.presentationRevision, origin,
          presentationOrigin: request?.presentationOrigin, waiting: request?.waiting,
          playing: o.playing, frame: o.frame
        }`,
            )}`,
          );
        }
        await route.fulfill({ response, body });
      },
    );
    const samples: unknown[] = [];
    const steadySamples: {
      time: number;
      frame: number;
      paused: boolean;
      preparing: boolean;
    }[] = [];
    try {
      const short = generateContinuityVideo(info.outputPath('media'));
      const source = info.outputPath('normal-play.mp4');
      const result = spawnSync(
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
      if (result.status !== 0) throw new Error(String(result.stderr));
      await page.goto('/');
      await expect(
        page.getByText('Backend ready', { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel('Choose video clips', { exact: true })
        .setInputFiles(source);
      await page.getByLabel('Timeline FPS', { exact: true }).selectOption('25');
      await page
        .getByLabel('Speed for normal-play.mp4', { exact: true })
        .selectOption(speed);
      await page
        .getByRole('button', {
          name: 'Preview clip 1: normal-play.mp4',
          exact: true,
        })
        .click();
      const read = () =>
        page.evaluate(() => {
          const video = document.querySelector<HTMLVideoElement>(
            '[aria-label="Uploaded clip preview"]',
          );
          return {
            time: video?.currentTime ?? 0,
            frame: Number(
              document.querySelector<HTMLInputElement>(
                '[aria-label="Timeline position"]',
              )?.value,
            ),
            paused: video?.paused ?? true,
            preparing: [...document.querySelectorAll('[role="status"]')].some(
              (node) => node.textContent === 'Preparing Preview',
            ),
          };
        });
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      await expect
        .poll(async () => {
          const value = await read();
          samples.push(value);
          return (
            !value.preparing &&
            !value.paused &&
            value.time > 0.3 * Number(speed) &&
            value.frame > 0
          );
        })
        .toBe(true);
      let previous = await read();
      const steadyStart = await page.evaluate(() => performance.now());
      for (let index = 0; index < 5; index++) {
        await expect
          .poll(async () => {
            const value = await read();
            samples.push(value);
            steadySamples.push(value);
            expect(value.preparing).toBe(false);
            expect(value.paused).toBe(false);
            expect(value.frame).toBeGreaterThanOrEqual(previous.frame);
            return (
              value.time > previous.time + 0.08 * Number(speed) &&
              value.frame > previous.frame
            );
          })
          .toBe(true);
        previous = await read();
      }
      // Polling retries must not hide an observed interruption or rollback.
      for (const [index, value] of steadySamples.entries()) {
        expect(value.preparing).toBe(false);
        expect(value.paused).toBe(false);
        if (index > 0) {
          expect(value.time).toBeGreaterThanOrEqual(
            steadySamples[index - 1].time,
          );
          expect(value.frame).toBeGreaterThanOrEqual(
            steadySamples[index - 1].frame,
          );
        }
      }
      const interruptions = await page.evaluate((start) => {
        const state = (
          window as unknown as {
            normalPlaybackRecovery: {
              records: {
                now: number;
                kind: string;
                details: { preparing?: boolean };
              }[];
            };
          }
        ).normalPlaybackRecovery;
        return state.records.filter(
          (entry) =>
            entry.now >= start &&
            entry.kind === 'readiness-ui' &&
            entry.details.preparing,
        );
      }, steadyStart);
      expect(interruptions).toEqual([]);
    } finally {
      const records = await page
        .evaluate(
          () =>
            (
              window as unknown as {
                normalPlaybackRecovery?: { records: unknown[] };
              }
            ).normalPlaybackRecovery?.records ?? [],
        )
        .catch(() => []);
      writeFileSync(
        info.outputPath('normal-playback.json'),
        JSON.stringify({ speed, samples, steadySamples, records }, null, 2),
      );
    }
  });
