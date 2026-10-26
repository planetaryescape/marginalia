import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SyncBar } from "./sync-bar";

export type SettingsStatus = {
  tone: "quiet" | "progress" | "failed";
  label: string;
};

const dotClass: Record<SettingsStatus["tone"], string> = {
  quiet: "bg-[var(--reader-muted)]",
  // Pulses only when motion is allowed; the static dot says the same thing.
  progress: "bg-[var(--ink-muted)] motion-safe:animate-pulse",
  failed: "bg-[var(--danger)]",
};

const textClass: Record<SettingsStatus["tone"], string> = {
  quiet: "text-[var(--reader-muted)]",
  progress: "text-[var(--reader-muted)]",
  failed: "text-[var(--danger)]",
};

/**
 * Page frame for Sources, Account and Readers: one 680px column. The header
 * names the settings page (SETTINGS_PAGES in site-header.tsx).
 */
export function SettingsPage({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[680px] px-5 pt-[clamp(0.75rem,4vh,3rem)] pb-16 md:px-0">
      <h1 className="font-serif text-[clamp(2.25rem,5vw,46px)] font-light leading-[1.05] tracking-tight">
        {title}
      </h1>
      {meta && (
        <p className="mt-3 text-sm text-[var(--reader-muted)]">{meta}</p>
      )}
      <div className="mt-10 flex flex-col">{children}</div>
    </main>
  );
}

/**
 * One settings section: heading, optional status, one sentence, controls and
 * optional Details. Sections are separated by a hairline and 48px, not cards.
 */
export function SettingsSection({
  title,
  status,
  description,
  action,
  details,
  syncing = false,
  children,
  className,
}: {
  title: string;
  status?: SettingsStatus;
  /** A quiet control at the right of the heading, such as "Check now". */
  action?: ReactNode;
  description?: ReactNode;
  details?: ReactNode;
  /** A sync or check is running: an indeterminate bar sits under the heading. */
  syncing?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-t border-[var(--reader-border)] pt-12 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-serif text-[22px] font-normal leading-tight">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {status && <SettingsStatusLine status={status} />}
          {action}
        </div>
      </div>
      {syncing && <SyncBar label={`${title}: syncing`} />}
      {description && (
        <div className="mb-4 text-[15px] leading-relaxed text-[var(--reader-fg-soft)]">
          {description}
        </div>
      )}
      {children && <div className="space-y-4">{children}</div>}
      {details && (
        <details className="group mt-4">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm text-[var(--reader-fg)] underline decoration-[var(--pencil-rule)] underline-offset-[3px] [&::-webkit-details-marker]:hidden">
            Details ▸
          </summary>
          <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-[var(--reader-muted)]">
            {details}
          </div>
        </details>
      )}
    </section>
  );
}

function SettingsStatusLine({ status }: { status: SettingsStatus }) {
  return (
    <p
      role={status.tone === "failed" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2 text-[13px]",
        textClass[status.tone],
      )}
    >
      <span
        aria-hidden
        className={cn("h-[7px] w-[7px] rounded-full", dotClass[status.tone])}
      />
      {status.label}
    </p>
  );
}
