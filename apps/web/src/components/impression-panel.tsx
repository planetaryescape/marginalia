"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Star } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const RATINGS = [
  "Not for me",
  "Meh",
  "Fine",
  "Good",
  "Loved it",
] as const;

export const IMPRESSION_TAGS = [
  "Changed my mind",
  "Learned a lot",
  "Made me think",
  "Beautifully written",
  "Useful",
  "Disagree",
  "Too long",
  "Want to reread",
] as const;

const NOTE_SAVE_DELAY_MS = 700;

/** Rating, tags and a line on what stayed with you. Every change saves itself. */
export function ImpressionPanel({
  articleId,
  heading = "How did it land?",
}: {
  articleId: Id<"articles">;
  heading?: string;
}) {
  const impression = useQuery(api.impressions.getByArticle, { articleId });
  const save = useMutation(api.impressions.save);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const timer = useRef<number | null>(null);
  const ratingName = useId();
  const pendingNote = useRef<{
    articleId: Id<"articles">;
    note: string;
  } | null>(null);

  // Keep the two panels in sync, without replacing a locally edited draft.
  useEffect(() => {
    if (impression === undefined || pendingNote.current) return;
    setNote(impression?.note ?? "");
  }, [impression]);

  const persist = async (patch: {
    rating?: number | null;
    tags?: string[];
    note?: string;
  }) => {
    setStatus("saving");
    try {
      await save({ articleId, ...patch });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  const flushNote = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const pending = pendingNote.current;
    if (!pending) return;
    pendingNote.current = null;
    setStatus("saving");
    void save(pending).then(
      () => setStatus("saved"),
      () => {
        if (!pendingNote.current) pendingNote.current = pending;
        setStatus("error");
      },
    );
  };
  const flushRef = useRef(flushNote);
  flushRef.current = flushNote;

  useEffect(
    () => () => {
      flushRef.current();
    },
    [],
  );

  const rating = impression?.rating ?? null;
  const tags = impression?.tags ?? [];

  return (
    <div className="font-sans">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12.5px] font-medium text-[var(--reader-fg)]">
          {heading}
        </p>
        <span
          className="text-[11px] text-[var(--reader-muted)]"
          aria-live="polite"
        >
          {status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Saved"
              : status === "error"
                ? "Couldn't save. Try again."
                : ""}
        </span>
      </div>

      <fieldset className="mt-3 grid grid-cols-5 gap-1.5">
        <legend className="sr-only">Rating</legend>
        {RATINGS.map((label, i) => {
          const value = i + 1;
          const filled = rating !== null && value <= rating;
          return (
            <label
              key={label}
              className={cn(
                "relative flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-2 ring-1 transition-colors focus-within:ring-[var(--reader-focus)]",
                rating === value
                  ? "bg-[var(--pen-soft)] text-[var(--pen)] ring-[var(--pen)]"
                  : "bg-[var(--reader-chip)] text-[var(--reader-fg-soft)] ring-[var(--reader-border)] hover:ring-[var(--reader-border-strong)]",
              )}
            >
              <input
                type="radio"
                name={ratingName}
                value={value}
                checked={rating === value}
                onChange={() => persist({ rating: value })}
                className="sr-only"
              />
              <Star
                size={19}
                aria-hidden
                fill={filled ? "currentColor" : "none"}
              />
              <span className="min-h-7 text-center text-[11px] leading-[14px]">
                {label}
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--reader-muted)]">
        {rating ? (
          <span className="font-medium text-[var(--pen)]">
            {RATINGS[rating - 1]}
          </span>
        ) : (
          "Choose a rating · arrow keys to change"
        )}
        {rating && (
          <button
            type="button"
            onClick={() => persist({ rating: null })}
            className="underline underline-offset-2"
          >
            Clear rating
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {IMPRESSION_TAGS.map((tag) => {
          const active = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={active}
              onClick={() =>
                persist({
                  tags: active ? tags.filter((t) => t !== tag) : [...tags, tag],
                })
              }
              className={cn(
                "h-7 px-2.5 rounded-full text-[12px] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[var(--reader-focus)]",
                active
                  ? "bg-[var(--reader-chip)] text-[var(--ink)] ring-1 ring-[var(--ink-muted)]"
                  : "bg-[var(--reader-chip)] text-[var(--reader-fg-soft)] hover:text-[var(--reader-fg)]",
              )}
            >
              {tag}
            </button>
          );
        })}
      </div>

      <textarea
        value={note}
        rows={2}
        onChange={(e) => {
          const value = e.target.value;
          setNote(value);
          pendingNote.current = { articleId, note: value };
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(
            () => flushRef.current(),
            NOTE_SAVE_DELAY_MS,
          );
        }}
        onBlur={() => flushRef.current()}
        placeholder="What stayed with you?"
        aria-label="What stayed with you?"
        className="mt-3 w-full resize-none rounded-lg bg-[var(--reader-chip)] px-3 py-2 font-serif text-[15px] leading-snug text-[var(--reader-fg)] outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-[var(--reader-muted)] focus:ring-1 focus:ring-[var(--reader-focus)]"
      />
    </div>
  );
}

/** One-line summary of an impression, shown above the title when you come back. */
export function ImpressionSummary({
  impression,
}: {
  impression: Doc<"impressions">;
}) {
  if (!impression.rating && !impression.tags.length && !impression.note)
    return null;
  return (
    <div className="mt-4 font-sans text-[13px] text-[var(--reader-muted)]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {impression.rating && (
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ink)]">
            {/* Stars in ink: the chrome echoes the rating, the pen stays for the reader's marks */}
            <span
              data-testid="summary-stars"
              className="inline-flex gap-[2px] leading-none"
              aria-hidden
            >
              {RATINGS.map((label, i) => (
                <Star
                  key={label}
                  size={13}
                  strokeWidth={1.5}
                  fill={i < (impression.rating ?? 0) ? "currentColor" : "none"}
                  className={
                    i < (impression.rating ?? 0)
                      ? "text-[var(--ink)]"
                      : "text-[var(--ink-muted)]"
                  }
                />
              ))}
            </span>
            You rated this {RATINGS[impression.rating - 1]}
          </span>
        )}
        {impression.tags.length > 0 && (
          <span>· {impression.tags.join(", ")}</span>
        )}
      </p>
      {impression.note && (
        <p className="mt-1 font-serif italic text-[15px] text-[var(--reader-fg-soft)]">
          “{impression.note}”
        </p>
      )}
    </div>
  );
}
