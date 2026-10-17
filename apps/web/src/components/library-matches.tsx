"use client";
import Link from "next/link";
import { useState } from "react";
import { InlineError } from "@/components/in-place";
import { useListKeys } from "@/lib/list-nav";
import { useTopicSearch } from "@/lib/use-topic-search";
import { cn, formatReadTime } from "@/lib/utils";

export const matchRowClass = "border-b border-[var(--reader-border)] py-3.5";
const rowClass = matchRowClass;

/** A shelf-style row: serif title over one meta line. */
export function MatchRow({
  articleId,
  title,
  meta,
}: {
  articleId: string;
  title: string;
  meta: string;
}) {
  return (
    <li className={cn(rowClass, "list-row-surface -mx-2 px-2")}>
      <Link
        href={`/read/${articleId}`}
        data-nav-item
        className="line-clamp-2 block font-serif text-[17px] leading-snug sm:text-[18px]"
      >
        {title}
      </Link>
      <span className="mt-0.5 block text-[12px] text-[var(--reader-muted)]">
        {meta}
      </span>
    </li>
  );
}

/**
 * Every article that fits a topic, as plain rows like the shelves. It is the
 * "See every match" destination from the desk's topic search; the librarian's
 * answer is a separate thing the reader asks for in the field above.
 */
export function LibraryMatches({ query }: { query: string }) {
  const [retry, setRetry] = useState(0);
  const result = useTopicSearch(query, true, retry);
  useListKeys();
  const current = result.query === query;

  return (
    <section aria-label={`Matches for ${query}`} className="mt-10">
      <p className="flex flex-wrap items-baseline gap-x-3 text-[14.5px] text-[var(--reader-fg)]">
        <span>Matches for “{query}”</span>
        <Link
          href="/library"
          scroll={false}
          className="py-1 text-[13px] text-[var(--reader-muted)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px] hover:text-[var(--reader-fg)]"
        >
          Back to shelves
        </Link>
      </p>
      {(!current || result.status === "loading") && (
        <div
          role="status"
          aria-busy="true"
          aria-label="Finding matches"
          className="mt-4 border-t border-[var(--reader-border)]"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className={rowClass}>
              <div className="h-5 w-[60%] rounded bg-[var(--reader-chip)]" />
              <div className="mt-2 h-3 w-[25%] rounded bg-[var(--reader-chip)]" />
            </div>
          ))}
        </div>
      )}
      {current && result.status === "error" && (
        <div className="mt-4">
          {result.error ? (
            <p role="alert" className="text-[13px] text-[var(--danger)]">
              {result.error}{" "}
              <Link href="/account" className="underline underline-offset-2">
                Open Your account
              </Link>
            </p>
          ) : (
            <InlineError
              message="Couldn't search your library."
              onRetry={() => setRetry((n) => n + 1)}
            />
          )}
        </div>
      )}
      {current && result.status === "ready" && result.matches.length === 0 && (
        <p
          role="status"
          className="py-6 text-[13px] text-[var(--reader-muted)]"
        >
          Nothing in your library fits that yet.
        </p>
      )}
      {current && result.status === "ready" && result.matches.length > 0 && (
        <>
          <ul className="mt-4 border-t border-[var(--reader-border)]">
            {result.matches.map((match) => (
              <MatchRow
                key={match.articleId}
                articleId={match.articleId}
                title={match.title}
                meta={[
                  match.source ?? match.author,
                  match.minutes ? formatReadTime(match.minutes) : null,
                  match.status,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </ul>
          {result.more && (
            <p className="py-3 text-[12.5px] text-[var(--reader-muted)]">
              These are the closest matches. Ask the librarian above to narrow
              them down.
            </p>
          )}
        </>
      )}
    </section>
  );
}
