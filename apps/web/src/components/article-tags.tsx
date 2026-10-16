"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";

/**
 * The topics Marginalia gave the article, small and in pencil under the title
 * (blueprint 02, Tags). They are Marginalia's labels, so they are not links
 * and carry none of the reader's pen. Nothing shows until there is one.
 */
export function ArticleTags({ articleId }: { articleId: Id<"articles"> }) {
  const tags = useQuery(api.tags.forArticle, { articleId });
  if (!tags?.length) return null;
  return (
    <ul aria-label="Topics" className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag._id}
          className="rounded-full border border-[var(--reader-border)] px-2.5 py-px font-sans text-[12px] text-[var(--pencil)]"
        >
          {tag.name}
        </li>
      ))}
    </ul>
  );
}
