import { useRef, useState } from 'react';
import { FolderOpen, Upload } from 'lucide-react';
import type { Limits } from '../lib/clips';
type Props = {
  disabled: boolean;
  limits: Limits;
  onSelect: (files: File[]) => void;
};
export function UploadCard({ disabled, limits, onSelect }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <section className="panel upload-card" aria-labelledby="upload-title">
      <div className="section-heading">
        <span className="section-icon">
          <Upload aria-hidden="true" />
        </span>
        <div>
          <h2 id="upload-title">Add to Video 1</h2>
        </div>
      </div>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) onSelect(Array.from(e.dataTransfer.files));
        }}
      >
        <h3 className="sr-only">Drop video clips</h3>
        <button
          className="browse-button"
          type="button"
          disabled={disabled}
          title="Add video clips directly to Video 1, or drop them here"
          onClick={() => input.current?.click()}
        >
          <FolderOpen aria-hidden="true" />
          Browse files
        </button>
        <input
          ref={input}
          className="hidden-input"
          tabIndex={-1}
          type="file"
          aria-label="Choose video clips"
          accept=".mp4,.mov,.webm,.mkv"
          multiple
          disabled={disabled}
          onChange={(e) => {
            onSelect(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
      <div className="upload-meta">
        <div className="file-types sr-only">
          {['MP4', 'MOV', 'WEBM', 'MKV'].map((type) => (
            <span key={type} className="file-type">
              {type}
            </span>
          ))}
        </div>
        <span>
          Up to {limits.max_clips} clips · {limits.max_file_size_mb} MB per file
        </span>
      </div>
    </section>
  );
}
