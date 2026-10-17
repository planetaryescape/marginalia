"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { MatchRow, matchRowClass } from "@/components/library-matches";
import { useListKeys } from "@/lib/list-nav";
import { formatReadTime } from "@/lib/utils";

const PAGE = 12;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * The articles that carry one topic, opened from the topic map in Your
 * reading. A page at a time, because each row is a whole article on the server.
 */
export function LibraryTopic({ topic }: { topic: string }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tags.articlesForTopic,
    { topic },
    { initialNumItems: PAGE },
  );
  useListKeys();

  return (
    <section aria-label={`Articles about ${topic}`} className="mt-10">
      <p className="flex flex-wrap items-baseline gap-x-3 text-[14.5px] text-[var(--reader-fg)]">
        <span>Articles about {topic}</span>
        <Link
          href="/library"
          scroll={false}
          className="py-1 text-[13px] text-[var(--reader-muted)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] hover:text-[var(--reader-fg)]"
        >
          Back to shelves
        </Link>
      </p>
      {status === "LoadingFirstPage" && (
        <div
          role="status"
          aria-busy="true"
          aria-label="Finding articles"
          className="mt-4 border-t border-[var(--reader-border)]"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className={matchRowClass}>
              <div className="h-5 w-[60%] rounded bg-[var(--reader-chip)]" />
              <div className="mt-2 h-3 w-[25%] rounded bg-[var(--reader-chip)]" />
            </div>
          ))}
        </div>
      )}
      {status === "Exhausted" && results.length === 0 && (
        <p
          role="status"
          className="py-6 text-[13px] text-[var(--reader-muted)]"
        >
          No articles carry that topic.
        </p>
      )}
      {results.length > 0 && (
        <ul className="mt-4 border-t border-[var(--reader-border)]">
          {results.map((article) => (
            <MatchRow
              key={article._id}
              articleId={article._id}
              title={article.title}
              meta={[
                article.uploaded ? "PDF" : hostOf(article.url),
                article.minutes ? formatReadTime(article.minutes) : null,
                article.finished ? "Finished" : null,
                article.annotating ? "annotating" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </ul>
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <div className="py-3">
          <button
            type="button"
            data-nav-item
            onClick={() => loadMore(PAGE)}
            disabled={status === "LoadingMore"}
            className="py-2 text-[13px] text-[var(--reader-muted)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] hover:text-[var(--reader-fg)] disabled:no-underline"
          >
            {status === "LoadingMore" ? "Loading more" : "More"}
          </button>
        </div>
      )}
    </section>
  );
}
