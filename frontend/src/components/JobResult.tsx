import { useState } from 'react';
import { Check, Download, Plus, TriangleAlert } from 'lucide-react';
import { apiUrl } from '../lib/api';
import type { Job } from '../lib/api';
export function JobResult({ job, onReset }: { job: Job; onReset: () => void }) {
  const [playbackError, setPlaybackError] = useState(false);
  return (
    <section className="panel result" aria-labelledby="result-title">
      <div className="result-heading">
        <span className="success-icon">
          <Check aria-hidden="true" />
        </span>
        <div>
          <h2 id="result-title">Your story, together.</h2>
          <p>Completed. Your video is ready for its next chapter.</p>
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
          expired, start a new merge.
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
        <button type="button" className="secondary-button" onClick={onReset}>
          <Plus aria-hidden="true" />
          Start new merge
        </button>
      </div>
      <p className="result-footnote">
        Save your video before the temporary files expire.
      </p>
    </section>
  );
}
