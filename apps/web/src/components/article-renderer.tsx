"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { ArticleRenderer as SharedArticleRenderer } from "@planetaryescape/reader";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { sanitizeHtml } from "@/lib/sanitize";

// Marginalia's trust policy for article HTML: DOMPurify with the annotation
// markup allowed through. The reader package trusts whatever this returns.
// Module-level so the function identity is stable across renders.
function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    ADD_TAGS: ["mark", "sup"],
    ADD_ATTR: ["data-annotation-id", "data-type", "style", "class", "target"],
  });
}

type SharedProps = React.ComponentProps<typeof SharedArticleRenderer>;

export function ArticleRenderer({
  annotations,
  ...props
}: Omit<SharedProps, "sanitize" | "onViewed" | "className" | "annotations"> & {
  // The reader package types `type` as the four original kinds; the margin has ten.
  annotations: (Omit<SharedProps["annotations"][number], "type"> & {
    type: string;
  })[];
}) {
  const markViewed = useMutation(api.annotations.markViewed);
  const onViewed = useCallback(
    (annotationId: string) =>
      // SAFETY: the id is the `_id` of an annotation the page loaded from api.annotations, so it is a valid Id<"annotations">.
      markViewed({ annotationId: annotationId as Id<"annotations"> }),
    [markViewed],
  );

  return (
    <SharedArticleRenderer
      {...props}
      // SAFETY: the package only reads `type` as a string (a colour and label lookup with a fallback) and writes it to data-type, so a kind it doesn't list renders as a generic mark.
      annotations={annotations as SharedProps["annotations"]}
      sanitize={sanitizeArticleHtml}
      onViewed={onViewed}
      className="prose prose-lg md:prose-xl dark:prose-invert max-w-none
          prose-headings:font-serif prose-headings:font-medium prose-headings:tracking-tight
          prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4
          prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
          prose-p:leading-[1.8] prose-p:mb-6
          prose-a:text-[var(--ink)] prose-a:underline prose-a:decoration-[var(--pencil-rule)] prose-a:underline-offset-[3px] hover:prose-a:decoration-[var(--ink)]
          prose-strong:text-ink-950 dark:prose-strong:text-parchment-100
          prose-blockquote:border-l-[3px] prose-blockquote:border-ink-300 dark:prose-blockquote:border-ink-600
          prose-blockquote:italic prose-blockquote:pl-4
          prose-code:text-sm prose-code:bg-ink-100 dark:prose-code:bg-ink-800
          prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
          prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-ink-900 dark:prose-pre:bg-ink-950 prose-pre:rounded-xl prose-pre:overflow-x-auto
          prose-pre:border prose-pre:border-ink-800
          prose-img:rounded-lg prose-img:my-8
          prose-li:leading-[1.7]"
    />
  );
}
