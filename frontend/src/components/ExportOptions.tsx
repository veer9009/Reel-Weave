import type { ExportFormat, Health } from '../lib/api';
export function ExportOptions({
  formats,
  onChange,
  capabilities,
  disabled,
}: {
  formats: readonly ExportFormat[];
  onChange: (formats: ExportFormat[]) => void;
  capabilities?: Health['export_capabilities'];
  disabled: boolean;
}) {
  return (
    <fieldset className="export-options" disabled={disabled}>
      <legend>Downloads</legend>
      <p>
        MP4 is included with every render. Add picture or final-mix audio
        downloads.
      </p>
      {(['mp4', 'mov', 'wav', 'mp3'] as const).map((format) => {
        const available = format === 'mp4' || capabilities?.[format] === true;
        return (
          <div key={format}>
            <label>
              <input
                type="checkbox"
                aria-label={format.toUpperCase()}
                checked={format === 'mp4' || formats.includes(format)}
                disabled={
                  disabled ||
                  format === 'mp4' ||
                  (!available && !formats.includes(format))
                }
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...formats, format]
                      : formats.filter((v) => v !== format),
                  )
                }
              />
              {format.toUpperCase()}
            </label>
            {!available && (
              <small>
                {format.toUpperCase()} is unavailable on this backend.
              </small>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
