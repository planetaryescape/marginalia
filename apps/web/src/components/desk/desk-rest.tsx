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

function continueHref(item: {
  article: { _id: string };
  unitIndex?: number;
  paragraphIndex?: number;
}) {
  const params = new URLSearchParams();
  if (item.unitIndex !== undefined) params.set("unit", String(item.unitIndex));
  if (item.paragraphIndex !== undefined)
    params.set("p", String(item.paragraphIndex));
  const query = params.toString();
  return `/read/${item.article._id}${query ? `?${query}` : ""}`;
}

/** `c` opens the article in progress, even while a chosen time covers its card. */
export function ContinueShortcut() {
  const router = useRouter();
  const resume = useQuery(api.sessions.getContinue);
  const inProgress = resume?.ready ? resume.item : undefined;
  useShortcuts(
    {
      c: () => {
        if (inProgress) router.push(continueHref(inProgress));
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
  const resume = useQuery(api.sessions.getContinue);
  const inProgress = resume?.ready ? resume.item : undefined;
  const overview = useQuery(api.home.counts, inProgress === null ? {} : "skip");
  const dueForReview = useQuery(
    api.lovedArticles.getDueForReview,
    inProgress === null ? {} : "skip",
  );
  const onboarding =
    inProgress === null &&
    dueForReview?.length === 0 &&
    overview?.annotatedTotal === 0;
  const feeds = useQuery(api.feeds.list, onboarding ? {} : "skip");
  const readwise = useQuery(api.readwise.status, onboarding ? {} : "skip");
  const advanceReview = useMutation(api.lovedArticles.advanceReview);
  const snoozeReview = useMutation(api.lovedArticles.snooze);

  if (resume && !resume.ready)
    return (
      <p className="text-[15px] text-[var(--ink-soft)]">
        Preparing your saved reading place…
      </p>
    );
  if (inProgress === undefined) return null;
  if (!inProgress && dueForReview === undefined) return null;
  const revisit = dueForReview?.find((entry) => entry !== null) ?? null;

  let content: ReactNode = null;
  if (inProgress) {
    const left = inProgress.remainingMinutes;
    content = (
      <Link
        href={continueHref(inProgress)}
        aria-keyshortcuts="c"
        className="list-row-surface -mx-2 block max-w-[620px] px-2"
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
          <span className="min-w-0">
            <span className="block font-serif text-[24px] lg:text-[30px] leading-tight">
              {inProgress.article.title}
            </span>
            {/* A book continues in a part, so name it */}
            {inProgress.part && (
              <span className="mt-1 block text-[13.5px] text-[var(--ink-muted)]">
                Part {inProgress.part.number} of {inProgress.part.count} ·{" "}
                {inProgress.part.title}
              </span>
            )}
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
  } else if (overview?.annotatedTotal === 0) {
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
  } else if (overview?.waiting === 0) {
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
