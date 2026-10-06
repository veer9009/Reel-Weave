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
  return (
    <section className="panel result" aria-labelledby="result-title">
      <div className="result-heading">
        <span className="success-icon">
          <Check aria-hidden="true" />
        </span>
        <div>
          <h2 id="result-title">MP4 ready</h2>
          <p>Rendered MP4 preview and download.</p>
        </div>
      </div>
      <video
        aria-label="Merged video preview"
        controls
        playsInline
        preload="metadata"
        src={apiUrl(`/api/jobs/${job.job_id}/video`)}
        onError={() => setPlaybackError(true)}
      />
      {playbackError && (
        <p role="alert" className="error-banner">
          <TriangleAlert aria-hidden="true" />
          Preview unavailable. Try downloading the video. If the job has
          expired, start a new project.
        </p>
      )}
      <div className="result-actions">
        <a
          className="primary-button"
          href={apiUrl(`/api/jobs/${job.job_id}/download`)}
          download
        >
          <Download aria-hidden="true" />
          Download MP4
        </a>
        <button
          type="button"
          className="secondary-button"
          onClick={onNewProject}
        >
          <Plus aria-hidden="true" />
          New project
        </button>
      </div>
      <p className="result-footnote">
        Save your video before the temporary files expire. New project clears
        browser project state; it does not cancel or delete the backend job.
      </p>
    </section>
  );
}
