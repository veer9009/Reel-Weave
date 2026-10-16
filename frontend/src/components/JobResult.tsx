import { useState } from 'react';
import { Check, Download, Plus, TriangleAlert } from 'lucide-react';
import { apiUrl } from '../lib/api';
import type { Job } from '../lib/api';
export function JobResult({
  job,
  onNewProject,
}: {
  job: Job;
  onNewProject: () => void;
}) {
  const [playbackError, setPlaybackError] = useState(false);
  const primaryReady = job.exports
    ? job.exports.mp4?.status === 'ready'
    : job.status === 'completed';
  const pending = job.status === 'queued' || job.status === 'processing';
  return (
    <section className="panel result" aria-labelledby="result-title">
      <div className="result-heading">
        <span className="success-icon">
          <Check aria-hidden="true" />
        </span>
        <div>
          <h2 id="result-title">
            {primaryReady
              ? 'MP4 ready'
              : job.status === 'failed'
                ? 'Render failed'
                : 'Rendering downloads'}
          </h2>
          <p>
            {pending
              ? 'Requested downloads are still processing.'
              : 'Rendered MP4 preview and downloads.'}
          </p>
        </div>
      </div>
      {primaryReady && (
        <video
          aria-label="Merged video preview"
          controls
          playsInline
          preload="metadata"
          src={apiUrl(`/api/jobs/${job.job_id}/video`)}
          onError={() => setPlaybackError(true)}
        />
      )}
      {playbackError && (
        <p role="alert" className="error-banner">
          <TriangleAlert aria-hidden="true" />
          Preview unavailable. Try downloading the video. If the job has
          expired, start a new project.
        </p>
      )}
      <div className="result-actions">
        {primaryReady && (
          <a
            className="primary-button"
            href={apiUrl(`/api/jobs/${job.job_id}/download`)}
            download
          >
            <Download aria-hidden="true" />
            Download MP4
          </a>
        )}
        {(['mov', 'wav', 'mp3'] as const).map((format) =>
          job.exports?.[format]?.status === 'ready' ? (
            <a
              key={format}
              className="secondary-button"
              href={apiUrl(
                `/api/jobs/${encodeURIComponent(job.job_id)}/exports/${format}`,
              )}
              download
            >
              Download {format.toUpperCase()}
            </a>
          ) : null,
        )}
        {!pending && (
          <button
            type="button"
            className="secondary-button"
            onClick={onNewProject}
          >
            <Plus aria-hidden="true" />
            New project
          </button>
        )}
      </div>
      {job.exports && (
        <div aria-live="polite">
          {(['mp4', 'mov', 'wav', 'mp3'] as const).map((format) => {
            const item = job.exports?.[format];
            if (!item || item.status === 'ready') return null;
            return (
              <p role="status" key={format}>
                {format.toUpperCase()}: {item.status}
                {item.error
                  ? ` — ${item.error} Submit a new render to retry this format.`
                  : ''}
              </p>
            );
          })}
        </div>
      )}
      <p className="result-footnote">
        Save your video before the temporary files expire. New project clears
        browser project state; it does not cancel or delete the backend job.
      </p>
    </section>
  );
}
