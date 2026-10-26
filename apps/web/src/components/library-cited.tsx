"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { MatchRow } from "@/components/library-matches";
import { citedIds } from "@/lib/cited-ids";
import { formatReadTime } from "@/lib/utils";

/**
 * The articles an answer links, as shelf-style rows. They wait until the
 * answer has finished so a half-written link is never looked up.
 */
export function CitedRows({ answer }: { answer: string }) {
  const ids = citedIds(answer);
  const rows = useQuery(api.citedArticles.byIds, ids.length ? { ids } : "skip");
  if (!rows?.length) return null;
  return (
    <ul
      aria-label="Articles in this answer"
      className="mt-6 max-w-2xl border-t border-[var(--reader-border)]"
    >
      {rows.map((row) => (
        <MatchRow
          key={row.articleId}
          articleId={row.articleId}
          title={row.title}
          meta={[row.source, row.minutes ? formatReadTime(row.minutes) : null]
            .filter(Boolean)
            .join(" · ")}
        />
      ))}
    </ul>
  );
}
