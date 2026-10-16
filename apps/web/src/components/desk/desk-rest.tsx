"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useShortcuts } from "@/lib/shortcuts";

const LABEL =
  "text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]";
const QUIET_BUTTON =
  "rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)] hover:text-[var(--ink)]";

function lovedAgo(days: number) {
  if (days < 1) return "today";
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

/** `c` opens the article in progress, even while a chosen time covers its card. */
export function ContinueShortcut() {
  const router = useRouter();
  const inProgress = useQuery(api.sessions.getInProgress);
  useShortcuts(
    {
      c: () => {
        if (inProgress) router.push(`/read/${inProgress.article._id}`);
      },
    },
    Boolean(inProgress),
    { help: { group: "Desk", keys: [["c", "Continue reading"]] } },
  );
  return null;
}

/** What the slot holds when no time is chosen. Never a count of the pile. */
export function DeskRest({ showKeys }: { showKeys: boolean }) {
  const reduced = useReducedMotion();
  const overview = useQuery(api.home.overview, {});
  const inProgress = useQuery(api.sessions.getInProgress);
  const dueForReview = useQuery(api.lovedArticles.getDueForReview);
  const feeds = useQuery(api.feeds.list);
  const readwise = useQuery(api.readwise.status, {});
  const advanceReview = useMutation(api.lovedArticles.advanceReview);
  const snoozeReview = useMutation(api.lovedArticles.snooze);

  if (overview === undefined || inProgress === undefined) return null;
  if (dueForReview === undefined) return null;
  const revisit = dueForReview.filter((entry) => entry !== null)[0] ?? null;

  let content: ReactNode = null;
  if (inProgress) {
    const left = inProgress.remainingMinutes;
    content = (
      <Link
        href={`/read/${inProgress.article._id}`}
        aria-keyshortcuts="c"
        className="group block max-w-[620px]"
      >
        <p className={LABEL}>
          Continue
          {showKeys && (
            <kbd aria-hidden className="reader-kbd ml-2 normal-case">
              c
            </kbd>
          )}
        </p>
        <span className="mt-2 flex items-baseline justify-between gap-6">
          <span className="min-w-0 font-serif text-[24px] lg:text-[30px] leading-tight group-hover:underline group-hover:decoration-[var(--pencil-rule)] underline-offset-4">
            {inProgress.article.title}
          </span>
          <span className="shrink-0 text-[13.5px] text-[var(--ink-muted)]">
            {left ? `${left} min left` : `${inProgress.scrollPercent}% read`}
          </span>
        </span>
        {/* Progress, not the reader's mark, so it is ink and never pen-coloured */}
        <span
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={inProgress.scrollPercent}
          className="mt-3 block h-[3px] overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink-muted)_30%,transparent)]"
        >
          <span
            className="block h-full rounded-full bg-[var(--ink)]"
            style={{ width: `${Math.max(4, inProgress.scrollPercent)}%` }}
          />
        </span>
      </Link>
    );
  } else if (revisit) {
    content = (
      <div className="max-w-[620px]">
        <p className={LABEL}>
          Worth revisiting · loved {lovedAgo(revisit.daysSinceLastRead)}
        </p>
        <p className="mt-2 font-serif text-[24px] lg:text-[30px] leading-tight">
          {revisit.article.title}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Link
            href={`/read/${revisit.articleId}`}
            onClick={() =>
              // SAFETY: the query row's articleId is an articles id; the validator is typed v.id("articles").
              void advanceReview({
                articleId: revisit.articleId as Id<"articles">,
              })
            }
            className={QUIET_BUTTON}
          >
            Read again
          </Link>
          <button
            type="button"
            onClick={() =>
              // SAFETY: as above.
              void snoozeReview({
                articleId: revisit.articleId as Id<"articles">,
              })
            }
            className="text-[14.5px] text-[var(--ink-muted)] underline decoration-[var(--pencil-rule)] underline-offset-[3px] hover:text-[var(--ink)]"
          >
            Not now
          </button>
        </div>
      </div>
    );
  } else if (overview.annotatedTotal === 0) {
    if (feeds === undefined || readwise === undefined) return null;
    const hasSources = feeds.length > 0 || Boolean(readwise.connected);
    content = hasSources ? (
      <p className="max-w-[620px] text-[15px] text-[var(--ink-soft)]">
        Your first articles are on their way. Each one is annotated before it
        appears here, which takes a minute or two.
      </p>
    ) : (
      <div className="max-w-[620px]">
        <p className="text-[15px] text-[var(--ink-soft)]">
          Nothing to read yet. Add a source, or paste a link with{" "}
          <span className="font-mono text-[13px]">/</span>
        </p>
        <Link
          href="/feeds"
          className="mt-5 inline-block rounded-md bg-[var(--ink)] px-[18px] py-[9px] text-[14.5px] text-[var(--reader-bg)]"
        >
          Add a source
        </Link>
      </div>
    );
  } else if (overview.waiting === 0) {
    content = (
      <p className="max-w-[620px] text-[15px] text-[var(--ink-soft)]">
        You've read everything waiting. New articles arrive as your sources
        update.
      </p>
    );
  }
  if (!content) return null;

  // The first open: the slot fades up 8 px and nothing else moves
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {content}
    </motion.div>
  );
}
