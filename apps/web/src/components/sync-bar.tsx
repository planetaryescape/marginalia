import { Fragment } from "react";

/** A real percentage when supplied; otherwise a shimmer, never fake progress. */
export function SyncBar({
  label,
  value,
  text = "Syncing…",
}: {
  label: string;
  value?: number;
  text?: string;
}) {
  const progress =
    value !== undefined && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : undefined;
  return (
    <Fragment>
      <div
        role="progressbar"
        aria-busy="true"
        aria-label={label}
        aria-valuemin={progress === undefined ? undefined : 0}
        aria-valuemax={progress === undefined ? undefined : 100}
        aria-valuenow={progress}
        aria-valuetext={text}
        data-determinate={progress === undefined ? undefined : true}
        className="sync-bar"
      >
        {progress !== undefined && (
          <span
            aria-hidden="true"
            className="sync-bar-fill"
            style={{ transform: `scaleX(${progress / 100})` }}
          />
        )}
      </div>
      <p role="status" className="sync-bar-text">
        {text}
      </p>
    </Fragment>
  );
}
