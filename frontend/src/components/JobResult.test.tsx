import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { JobResult } from './JobResult';
it('retains_successful_artifact_links_and_shows_failed_extra_without_a_link', () => {
  render(
    <JobResult
      job={{
        job_id: 'job',
        status: 'completed',
        error: null,
        exports: {
          mp4: {
            status: 'ready',
            error: null,
            download_url: '/api/jobs/job/exports/mp4',
          },
          mov: {
            status: 'ready',
            error: null,
            download_url: '/api/jobs/job/exports/mov',
          },
          wav: {
            status: 'ready',
            error: null,
            download_url: '/api/jobs/job/exports/wav',
          },
          mp3: { status: 'failed', error: 'MP3 encoding failed.' },
        },
      }}
      onNewProject={() => {}}
    />,
  );
  for (const format of ['MP4', 'MOV', 'WAV'])
    expect(
      screen.getByRole('link', { name: `Download ${format}` }),
    ).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Download MP3' })).toBeNull();
  expect(screen.getByText(/MP3 encoding failed/)).toBeVisible();
  expect(screen.getByLabelText('Merged video preview')).toBeVisible();
});
it('shows_processing_without_exposing_links_for_pending_artifacts', () => {
  render(
    <JobResult
      job={{
        job_id: 'job',
        status: 'processing',
        error: null,
        exports: {
          mp4: { status: 'ready', error: null },
          mp3: { status: 'processing', error: null },
        },
      }}
      onNewProject={() => {}}
    />,
  );
  expect(screen.getByText('MP3: processing')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Download MP3' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New project' })).toBeNull();
});
