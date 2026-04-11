"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { formatReadTime, formatDate } from "@/lib/utils";
import Link from "next/link";

export default function SavedPage() {
  const saved = useQuery(api.savedArticles.list);
  const unsave = useMutation(api.savedArticles.unsave);

  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <Link
          href="/"
          className="text-ink-400 hover:text-ink-600 font-sans text-sm transition-colors"
        >
          &larr; Back
        </Link>
        <h1 className="text-xl font-serif font-medium text-ink-950 dark:text-parchment-100">
          Saved Articles
        </h1>
        <div className="w-10" />
      </div>

      {saved && saved.length === 0 ? (
        <p className="text-center text-ink-400 dark:text-ink-500 font-sans text-sm py-12">
          No saved articles yet.
        </p>
      ) : (
        <div className="space-y-3">
          {saved?.map((item: any) => {
            if (!item?.article) return null;
            return (
              <div
                key={item._id}
                className="flex items-start gap-4 p-4 rounded-xl border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900"
              >
                <Link
                  href={`/read/${item.article._id}`}
                  className="flex-1 min-w-0 group"
                >
                  <p className="font-serif text-base font-medium text-ink-800 dark:text-parchment-200 group-hover:text-annotation-crossref transition-colors line-clamp-2">
                    {item.article.title}
                  </p>
                  <div className="flex gap-3 mt-1 text-xs font-sans text-ink-400">
                    {item.article.author && (
                      <span>{item.article.author}</span>
                    )}
                    <span>
                      {formatReadTime(item.article.estimatedReadMinutes)}
                    </span>
                  </div>
                </Link>
                <button
                  onClick={() => unsave({ articleId: item.article._id })}
                  className="text-ink-300 hover:text-annotation-tension text-sm flex-shrink-0 transition-colors"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
