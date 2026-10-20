import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { createProjectDocumentFixture } from './test/projectFileFixtures';
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            ffmpeg_available: true,
            ffprobe_available: true,
            limits: { max_clips: 20, max_file_size_mb: 200 },
          }),
        ),
    ),
  );
});
function chooseProject(text: string) {
  const file = new File([text], 'edit.avstudio.json');
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(text).buffer,
  });
  fireEvent.change(screen.getByLabelText('Choose project file'), {
    target: { files: [file] },
  });
}
it('adds Save/Open without changing empty-project render readiness', async () => {
  render(<App />);
  await screen.findByText('Backend ready');
  expect(screen.getByRole('button', { name: 'Save Project' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Open Project' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Render MP4' })).toBeDisabled();
});
it('invalid input preserves the workspace and restores focus when closed', async () => {
  render(<App />);
  await screen.findByText('Backend ready');
  chooseProject('{broken');
  const dialog = await screen.findByRole('dialog', { name: 'Open Project' });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('corrupt');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Open Project' })).toHaveFocus();
});
it('lists missing media and blocks render and history until cancel without feature fetches', async () => {
  render(<App />);
  await screen.findByText('Backend ready');
  const calls = vi.mocked(fetch).mock.calls.length;
  chooseProject(JSON.stringify(createProjectDocumentFixture()));
  const dialog = await screen.findByRole('dialog', { name: 'Open Project' });
  expect(await within(dialog).findByText('base.mp4')).toBeVisible();
  expect(within(dialog).getByText('Missing')).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: 'Open Project' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Render MP4' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
});
