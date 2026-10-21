import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { generateContinuityVideo } from './mediaFixtures';

// Causal diagnostics only. This journey makes no visual-continuity or
// native-time/wall-time acceptance claim and changes no existing browser test.
test('record pause/resume readiness before and after a running split', async ({
  page,
}, info) => {
  // No source rewriting or per-frame runtime snapshots: observe native calls
  // and readiness UI transitions without changing the production callbacks.
  await page.addInitScript(() => {
    const elements = new Set<HTMLMediaElement>();
    const records: unknown[] = [];
    const state = {
      records,
      record(label: string, details: unknown) {
        records.push({
          now: performance.now(),
          label,
          details,
          frame: document.querySelector<HTMLInputElement>(
            '[aria-label="Timeline position"]',
          )?.value,
          preparing:
            document.querySelector('.program-monitor [role="status"]')
              ?.textContent === 'Preparing Preview',
          media: [...elements].map((e) => ({
            tag: e.tagName,
            src: e.getAttribute('src'),
            time: e.currentTime,
            paused: e.paused,
            seeking: e.seeking,
            ready: e.readyState,
          })),
        });
      },
    };
    Object.assign(window, { avstudioSeekDiagnostics: state });
    const observe = (element: HTMLMediaElement) => {
      if (elements.has(element)) return;
      elements.add(element);
      for (const name of [
        'playing',
        'pause',
        'waiting',
        'seeking',
        'seeked',
        'ended',
        'error',
      ]) {
        element.addEventListener(name, () =>
          state.record(`media-event:${name}`, { tag: element.tagName }),
        );
      }
    };
    const prototype = HTMLMediaElement.prototype;
    const play = prototype.play,
      pause = prototype.pause;
    prototype.play = function () {
      observe(this);
      state.record('media-call:play', { tag: this.tagName });
      return play.call(this);
    };
    prototype.pause = function () {
      observe(this);
      state.record('media-call:pause', { tag: this.tagName });
      return pause.call(this);
    };
    const time = Object.getOwnPropertyDescriptor(prototype, 'currentTime')!;
    Object.defineProperty(prototype, 'currentTime', {
      ...time,
      set(value: number) {
        observe(this);
        state.record('media-call:seek', {
          tag: this.tagName,
          value,
          stack: new Error().stack,
        });
        time.set!.call(this, value);
      },
    });
    let preparing = false;
    new MutationObserver(() => {
      const next =
        document.querySelector('.program-monitor [role="status"]')
          ?.textContent === 'Preparing Preview';
      if (next !== preparing) {
        preparing = next;
        state.record('readiness-ui', { preparing });
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  let retained: unknown[] = [];
  const save = async () => {
    retained = await page
      .evaluate(
        () =>
          (
            window as unknown as {
              avstudioSeekDiagnostics?: { records: unknown[] };
            }
          ).avstudioSeekDiagnostics?.records ?? [],
      )
      .catch(() => retained);
    writeFileSync(
      info.outputPath('readiness-diagnostics.json'),
      JSON.stringify(retained, null, 2),
    );
  };
  try {
    const shortSource = generateContinuityVideo(info.outputPath('media'));
    const source = info.outputPath('pause-resume.mp4');
    const repeated = spawnSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-stream_loop',
        '4',
        '-i',
        shortSource,
        '-c',
        'copy',
        '-t',
        '30',
        source,
      ],
      {
        windowsHide: true,
        timeout: 60_000,
      },
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
      .getByRole('button', {
        name: 'Preview clip 1: pause-resume.mp4',
        exact: true,
      })
      .click();
    const video = page.getByLabel('Uploaded clip preview', { exact: true });
    const mark = async (label: string) => {
      await page.evaluate((label) => {
        (
          window as unknown as {
            avstudioSeekDiagnostics: {
              record: (label: string, details: unknown) => void;
            };
          }
        ).avstudioSeekDiagnostics.record(label, {});
      }, label);
      await save();
    };
    const nativeTime = () =>
      video.evaluate((node) => (node as HTMLVideoElement).currentTime);
    await page
      .getByRole('button', { name: 'Play preview', exact: true })
      .click();
    await expect.poll(nativeTime).toBeGreaterThan(0.3);
    for (const phase of ['before-split', 'after-split']) {
      if (phase === 'after-split') {
        await mark('manual-sequence:split');
        await page
          .getByRole('button', { name: 'Split Video', exact: true })
          .click();
      }
      await mark(`manual-sequence:${phase}:pause`);
      await page
        .getByRole('button', { name: 'Pause preview', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Play preview', exact: true }),
      ).toBeVisible();
      const pausedAt = await nativeTime();
      await mark(`manual-sequence:${phase}:resume`);
      await page
        .getByRole('button', { name: 'Play preview', exact: true })
        .click();
      await expect.poll(nativeTime).toBeGreaterThan(pausedAt + 0.12);
      await mark(`manual-sequence:${phase}:advanced`);
    }
  } finally {
    await save();
  }
});
