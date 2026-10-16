"use client";
import type { ReactNode } from "react";
import { useChangeWash } from "@/lib/use-timed-flag";

/**
 * "Saved", shown at the control that changed instead of in a toast. The live
 * region stays mounted so screen readers hear it; the word itself runs one
 * fade-in, 1.6 s hold, fade-out animation (globals.css) and unmounts when
 * `visible` clears.
 */
export function SavedMark({
  visible,
  hold = false,
  children = "Saved",
}: {
  visible: boolean;
  /** Stays after fading in, for a result that remains true (the article is saved). */
  hold?: boolean;
  children?: ReactNode;
}) {
  return (
    <span role="status" aria-live="polite">
      {visible && (
        <span className="saved-mark" data-hold={hold || undefined}>
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * A failure in the place the action was: one sentence that says what happened,
 * with Retry beside it. The page around it keeps working.
 */
export function InlineError({
  message,
  onRetry,
  busy = false,
}: {
  message: string;
  onRetry: () => void;
  busy?: boolean;
}) {
  return (
    <p role="alert" className="inline-error">
      <span className="inline-error-dot" aria-hidden="true" />
      <span>{message}</span>{" "}
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="inline-error-retry"
      >
        Retry
      </button>
    </p>
  );
}

/**
 * A row that takes a surface tint for 600 ms when `value` changes, so a
 * change the reader did not make themselves is visible where it landed.
 */
export function ChangeWash({
  value,
  className,
  children,
}: {
  value: unknown;
  className?: string;
  children: ReactNode;
}) {
  const [washing] = useChangeWash(value);
  return (
    <div className={className} data-washing={washing || undefined}>
      {children}
    </div>
  );
}
