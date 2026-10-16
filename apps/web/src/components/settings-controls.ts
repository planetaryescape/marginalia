// The five control roles for settings pages. Settings controls use these,
// not ad hoc button styles, so every settings page reads the same.

/** One per section at most: the action the section exists for. */
export const primaryControl =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--reader-fg)] px-4 text-sm font-medium text-[var(--reader-bg)] transition-opacity hover:opacity-90 disabled:opacity-40";

/** Everything else that acts: sync, check, pause, copy. */
export const quietControl =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-[var(--reader-chip)] px-3 text-sm text-[var(--reader-fg-soft)] transition-opacity hover:opacity-90 disabled:opacity-40";

/** Remove, Revoke, Disconnect and Disable, before they are confirmed. */
export const destructiveControl = `${quietControl} text-[var(--reader-fg-soft)]`;

/** The confirming half of a destructive action. */
export const confirmControl = `${quietControl} text-[var(--danger)]`;

/** Inline links such as "Details" and "import an OPML file". */
export const textControl =
  "inline-flex min-h-11 items-center text-sm text-[var(--reader-fg)] underline decoration-[var(--pencil-rule)] underline-offset-[3px] disabled:opacity-40";

/** Text fields, including token, URL and password inputs. */
export const fieldControl =
  "min-h-11 w-full rounded-md border border-[var(--reader-border-strong)] bg-transparent px-3 text-sm text-[var(--reader-fg)] placeholder:text-[var(--reader-muted)] focus:border-[var(--reader-focus)] focus:outline-none disabled:opacity-40";

/** A list row inside a section, separated by a hairline. */
export const settingsRow =
  "flex flex-wrap items-center justify-between gap-3 border-b border-[var(--reader-border)] py-3";
