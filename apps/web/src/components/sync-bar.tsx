import { Fragment } from "react";

/**
 * Shows that a sync is running without saying how far along it is, so it has
 * no value. Under reduced motion globals.css makes the bar still and reveals
 * the "Syncing…" text.
 */
export function SyncBar({ label }: { label: string }) {
  return (
    <Fragment>
      <div
        role="progressbar"
        aria-busy="true"
        aria-label={label}
        className="sync-bar"
      />
      <p aria-hidden="true" className="sync-bar-text">
        Syncing…
      </p>
    </Fragment>
  );
}
