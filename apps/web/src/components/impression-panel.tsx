"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
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
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<number | null>(null);
  const loadedFor = useRef<string | null>(null);

  // Seed the note once per article, so typing isn't overwritten by live updates
  useEffect(() => {
    if (impression === undefined || loadedFor.current === articleId) return;
    loadedFor.current = articleId;
    setNote(impression?.note ?? "");
  }, [impression, articleId]);

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
      setStatus("idle");
    }
  };

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
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
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
      </div>

      {/* Five steps that fill up to the chosen one; choosing it again clears */}
      <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Rating">
        {RATINGS.map((label, i) => {
          const value = i + 1;
          const filled = rating !== null && value <= rating;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={label}
              title={label}
              onClick={() =>
                persist({ rating: rating === value ? null : value })
              }
              className={cn(
                "group flex-1 h-9 rounded-lg ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--pen)]",
                filled
                  ? "bg-[var(--pen)] ring-[var(--pen)]"
                  : "bg-[var(--reader-chip)] ring-[var(--reader-border)] hover:ring-[var(--pen)]",
              )}
              style={
                filled ? { opacity: 0.45 + (value / 5) * 0.55 } : undefined
              }
            />
          );
        })}
      </div>
      <p className="mt-1.5 h-4 text-[12px] text-[var(--reader-muted)]">
        {rating ? (
          <span className="font-medium text-[var(--pen)]">
            {RATINGS[rating - 1]}
          </span>
        ) : (
          "Rate it from Not for me to Loved it"
        )}
      </p>

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
                "h-7 px-2.5 rounded-full text-[12px] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[var(--pen)]",
                active
                  ? "bg-[var(--pen-soft)] text-[var(--pen)] ring-1 ring-[var(--pen)]"
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
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(
            () => persist({ note: value }),
            NOTE_SAVE_DELAY_MS,
          );
        }}
        placeholder="What stayed with you?"
        aria-label="What stayed with you?"
        className="mt-3 w-full resize-none rounded-lg bg-[var(--reader-chip)] px-3 py-2 font-serif text-[15px] leading-snug text-[var(--reader-fg)] outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-[var(--reader-muted)] focus:ring-1 focus:ring-[var(--pen)]"
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
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--pen)]">
            <span className="flex gap-[3px]" aria-hidden>
              {RATINGS.map((label, i) => (
                <span
                  key={label}
                  className="w-[7px] h-[7px] rounded-[2px]"
                  style={{
                    background:
                      i < (impression.rating ?? 0)
                        ? "var(--pen)"
                        : "var(--reader-border-strong)",
                  }}
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
