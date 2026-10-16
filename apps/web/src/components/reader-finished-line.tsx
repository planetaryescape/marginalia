"use client";

/**
 * Says an article is finished, with Mark unread beside it. The reader doesn't
 * record whether the end was reached on its own or by Done, so both show it.
 */
export function FinishedLine({
  finished,
  onMarkUnread,
}: {
  finished: boolean;
  onMarkUnread: () => void;
}) {
  if (!finished) return null;
  return (
    <p className="mt-4 text-center font-sans text-[13px] text-[var(--ink-muted)]">
      Finished ·{" "}
      <button
        type="button"
        onClick={onMarkUnread}
        className="text-[var(--ink)] underline decoration-[var(--pencil-rule)] underline-offset-[3px] hover:decoration-[var(--ink)]"
      >
        Mark unread
      </button>
    </p>
  );
}
