"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { DeskPage } from "@/components/desk-page";
import { formatReadTime } from "@/lib/utils";

export default function SavedPage() {
  const saved = useQuery(api.savedArticles.list);
  const unsave = useMutation(api.savedArticles.unsave);

  return (
    <DeskPage title="Saved articles">
      {saved && saved.length === 0 ? (
        <p className="text-center text-[var(--reader-muted)] text-sm py-12">
          No saved articles yet.
        </p>
      ) : (
        <div className="space-y-3">
          {saved?.map((item) => {
            if (!item?.article) return null;
            return (
              <div
                key={item._id}
                className="flex items-start gap-4 p-4 rounded-xl border border-[var(--reader-border)] bg-[var(--reader-surface)]"
              >
                <Link
                  href={`/read/${item.article._id}`}
                  className="flex-1 min-w-0 group"
                >
                  <p className="font-serif text-xl text-[var(--reader-fg)] group-hover:text-[var(--pen)] transition-colors line-clamp-2">
                    {item.article.title}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-[var(--reader-muted)]">
                    {item.article.author && <span>{item.article.author}</span>}
                    <span>
                      {formatReadTime(item.article.estimatedReadMinutes)}
                    </span>
                  </div>
                </Link>
                <button
                  type="button"
                  aria-label={`Remove ${item.article.title} from saved articles`}
                  onClick={() => unsave({ articleId: item.article._id })}
                  className="text-[var(--reader-muted)] hover:text-[var(--reader-fg)] text-sm flex-shrink-0 transition-colors"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}
    </DeskPage>
  );
}
