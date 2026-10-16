"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RATINGS } from "@/components/impression-panel";
import { InlineError } from "@/components/in-place";
import { ConfirmAction } from "@/components/settings-confirm";
import { navItems, useListKeys } from "@/lib/list-nav";
import { cn, formatReadTime } from "@/lib/utils";

export type ShelfId = "saved" | "loved" | "finished";

/** Ratings are stars, filled in the reader's pen colour: the rating is their mark (D-DES-032). */
export function StarRating({ rating }: { rating: number }) {
  return (
    <span
      role="img"
      aria-label={RATINGS[rating - 1]}
      className="inline-flex gap-[2px] leading-none"
    >
      {RATINGS.map((label, i) => {
        const filled = i < rating;
        return (
          <Star
            key={label}
            size={13}
            strokeWidth={1.5}
            aria-hidden
            fill={filled ? "currentColor" : "none"}
            className={filled ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"}
          />
        );
      })}
    </span>
  );
}

const shelfEmpty = "py-10 text-center text-[13px] text-[var(--reader-muted)]";
const rowClass =
  "flex items-start gap-4 border-b border-[var(--reader-border)] py-3.5";
const titleClass =
  "block font-serif text-[17px] sm:text-[18px] leading-snug hover:underline hover:decoration-[var(--pencil-rule)] underline-offset-4";

/** Author and length, plus "annotating" while the margin notes are still being written. */
function shelfMeta(article: {
  author?: string;
  estimatedReadMinutes?: number;
  annotationStatus?: string;
}) {
  return [
    article.author,
    formatReadTime(article.estimatedReadMinutes),
    article.annotationStatus === "pending" ? "annotating" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Loading() {
  return (
    <p role="status" className="py-8 text-sm text-[var(--reader-muted)]">
      Loading…
    </p>
  );
}

// The server ends a page at 12 articles, so asking for more gains nothing
const PAGE = 12;

/** Loads the next page as the end of the list nears; "More" is the fallback. */
function LoadMore({
  status,
  loadMore,
  loaded,
}: {
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (numItems: number) => void;
  loaded: number;
}) {
  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page re-observes the end, so a still-visible end loads the next page
  useEffect(() => {
    const target = end.current;
    if (status !== "CanLoadMore" || !target) return;
    if (typeof IntersectionObserver === "undefined") return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore(PAGE);
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    watcher.observe(target);
    return () => watcher.disconnect();
  }, [status, loadMore, loaded]);

  if (status === "Exhausted") return null;
  return (
    <div ref={end} className="py-3">
      <button
        type="button"
        data-nav-item
        onClick={() => loadMore(PAGE)}
        disabled={status !== "CanLoadMore"}
        className="py-2 text-[13px] text-[var(--reader-muted)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] hover:text-[var(--reader-fg)] disabled:no-underline"
      >
        {status === "LoadingMore" ? "Loading more" : "More"}
      </button>
    </div>
  );
}

const rowFor = (id: string) =>
  document.querySelector<HTMLElement>(`[data-saved-row="${id}"]`);

/** Saved shelf: the list that used to be `/saved`, with Remove confirmed in place. */
export function SavedShelf() {
  const {
    results: saved,
    status,
    loadMore,
  } = usePaginatedQuery(api.savedArticles.page, {}, { initialNumItems: PAGE });
  const unsave = useMutation(api.savedArticles.unsave);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: Id<"articles">; title: string }>();
  const [retrying, setRetrying] = useState(false);

  // Opening the question puts focus on its Remove, so the keyboard can answer it
  useEffect(() => {
    if (confirming)
      rowFor(confirming)
        ?.querySelector<HTMLElement>('[role="group"] button')
        ?.focus();
  }, [confirming]);

  const remove = async (id: Id<"articles">, title: string) => {
    // Focus moves to the neighbour first so it never falls to <body>
    const items = navItems();
    const at = items.findIndex((el) => rowFor(id)?.contains(el));
    (items[at + 1] ?? items[at - 1])?.focus({ preventScroll: true });
    try {
      await unsave({ articleId: id });
      setFailed(undefined);
    } catch {
      setFailed({ id, title });
      rowFor(id)?.querySelector<HTMLElement>("[data-nav-item]")?.focus();
    }
  };

  // `s` asks the question for the focused row; Enter on Remove answers it
  useListKeys(
    {
      s: () => {
        const id = (
          document.activeElement as HTMLElement | null
        )?.closest<HTMLElement>("[data-saved-row]")?.dataset.savedRow;
        if (!id) return false;
        setConfirming(id);
        return true;
      },
    },
    [["s", "Remove from saved"]],
  );
  if (status === "LoadingFirstPage") return <Loading />;
  if (saved.length === 0 && status === "Exhausted")
    return <p className={shelfEmpty}>No saved articles yet.</p>;
  return (
    <>
      {failed && (
        <div className="mt-4">
          <InlineError
            message={`Couldn't remove “${failed.title}” from saved articles.`}
            busy={retrying}
            onRetry={async () => {
              setRetrying(true);
              await remove(failed.id, failed.title);
              setRetrying(false);
            }}
          />
        </div>
      )}
      <ul className="border-t border-[var(--reader-border)]">
        {saved.map((item) => {
          const { article } = item;
          return (
            <li
              key={item._id}
              data-nav-row
              data-saved-row={article._id}
              className={rowClass}
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/read/${article._id}`}
                  data-nav-item
                  className={cn(titleClass, "line-clamp-2")}
                >
                  {article.title}
                </Link>
                <span className="mt-0.5 block text-[12px] text-[var(--reader-muted)]">
                  {shelfMeta(article)}
                </span>
              </div>
              <ConfirmAction
                label="Remove"
                ariaLabel={`Remove ${article.title} from saved articles`}
                question="Remove from saved?"
                confirmLabel="Remove"
                open={confirming === article._id}
                onOpenChange={(open) => {
                  setConfirming(open ? article._id : null);
                  if (!open)
                    rowFor(article._id)
                      ?.querySelector<HTMLElement>("[data-nav-item]")
                      ?.focus();
                }}
                onConfirm={() => void remove(article._id, article.title)}
              />
            </li>
          );
        })}
      </ul>
      <LoadMore status={status} loadMore={loadMore} loaded={saved.length} />
    </>
  );
}

/** Loved shelf: articles you hearted, newest first as the query returns them. */
export function LovedShelf() {
  const {
    results: loved,
    status,
    loadMore,
  } = usePaginatedQuery(api.lovedArticles.page, {}, { initialNumItems: PAGE });
  useListKeys();
  if (status === "LoadingFirstPage") return <Loading />;
  if (loved.length === 0 && status === "Exhausted")
    return <p className={shelfEmpty}>No loved articles yet.</p>;
  return (
    <>
      <ul className="border-t border-[var(--reader-border)]">
        {loved.map((item) => (
          <li key={item._id} className={rowClass}>
            <div className="min-w-0 flex-1">
              <Link
                href={`/read/${item.article._id}`}
                data-nav-item
                className={titleClass}
              >
                {item.article.title}
              </Link>
              <span className="mt-0.5 block text-[12px] text-[var(--reader-muted)]">
                {shelfMeta(item.article)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <LoadMore status={status} loadMore={loadMore} loaded={loved.length} />
    </>
  );
}

/** Finished shelf: your impressions, each with its stars, tags and what stayed with you. */
export function FinishedShelf() {
  const impressions = useQuery(api.impressions.listRecent, {});
  useListKeys();
  if (impressions === undefined) return <Loading />;
  if (impressions.length === 0)
    return (
      <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-[var(--reader-muted)]">
        Rate articles at the end of each read, or with the star at the top. Your
        ratings and what stayed with you gather here, and the librarian uses
        them.
      </p>
    );
  return (
    <ul className="border-t border-[var(--reader-border)]">
      {impressions.map((item) => (
        <li key={item._id} className={cn(rowClass, "flex-col gap-1.5")}>
          <Link
            href={`/read/${item.articleId}`}
            data-nav-item
            className={titleClass}
          >
            {item.title}
          </Link>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--reader-muted)]">
            {item.rating ? <StarRating rating={item.rating} /> : null}
            {item.tags.length > 0 && <span>{item.tags.join(", ")}</span>}
          </p>
          {item.note && (
            <p className="font-serif italic text-[14px] leading-snug text-[var(--pencil)] line-clamp-2">
              “{item.note}”
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
