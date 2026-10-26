import type { ReactNode } from "react";
import {
  confirmControl,
  destructiveControl,
  quietControl,
} from "./settings-controls";

/**
 * A destructive action that confirms in place: "Remove", then
 * "question  Remove · Keep". Open state is controlled so the page can close
 * it when another row is touched.
 */
export function ConfirmAction({
  label,
  ariaLabel,
  question,
  confirmLabel,
  open,
  busy = false,
  onOpenChange,
  onConfirm,
  children,
}: {
  label: string;
  ariaLabel?: string;
  question: string;
  confirmLabel: string;
  open: boolean;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  if (!open) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={busy}
        onClick={() => onOpenChange(true)}
        className={destructiveControl}
      >
        {label}
      </button>
    );
  }
  return (
    <span
      role="group"
      aria-label={question}
      className="flex flex-wrap items-center gap-2 text-sm text-[var(--reader-fg-soft)]"
      onKeyDown={(event) => {
        if (event.key === "Escape") onOpenChange(false);
      }}
    >
      {question}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onOpenChange(false);
          onConfirm();
        }}
        className={confirmControl}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onOpenChange(false)}
        className={quietControl}
      >
        Keep
      </button>
      {children}
    </span>
  );
}
