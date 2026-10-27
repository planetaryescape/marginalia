"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { ArticleRenderer as SharedArticleRenderer } from "@planetaryescape/reader";
import { useMutation } from "convex/react";
import { memo, useCallback } from "react";
import { sanitizeHtml } from "@/lib/sanitize";

// Marginalia's trust policy for article HTML: DOMPurify with the annotation
// markup allowed through. The reader package trusts whatever this returns.
// Module-level so the function identity is stable across renders.
function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    ADD_TAGS: ["mark", "sup"],
    // YouVersion's inert `v` marker identifies containing verses for Study.
    ADD_ATTR: [
      "data-annotation-id",
      "data-type",
      "style",
      "class",
      "target",
      "v",
    ],
  });
}

type SharedProps = React.ComponentProps<typeof SharedArticleRenderer>;

type ArticleProps = Omit<
  SharedProps,
  "sanitize" | "onViewed" | "className" | "annotations"
> & {
  // The reader package types `type` as the four original kinds; the margin has ten.
  annotations: (Omit<SharedProps["annotations"][number], "type"> & {
    type: string;
  })[];
};

export const ArticleRenderer = memo(
  function ArticleRenderer({ annotations, ...props }: ArticleProps) {
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
          prose-blockquote:border-l-[3px] prose-blockquote:border-[var(--reader-border-strong)]
          prose-blockquote:italic prose-blockquote:pl-4
          prose-code:text-sm prose-code:bg-[var(--reader-chip)]
          prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
          prose-code:before:content-none prose-code:after:content-none
          prose-pre:rounded-lg prose-pre:overflow-x-auto
          prose-pre:border prose-pre:border-[var(--reader-border)]
          prose-img:rounded-lg prose-img:my-8
          prose-li:leading-[1.7]"
      />
    );
  },
  (before, after) =>
    before.content === after.content &&
    before.contentHtml === after.contentHtml &&
    before.activeAnnotationId === after.activeAnnotationId &&
    before.onAnnotationSelect === after.onAnnotationSelect &&
    before.wrapperClassName === after.wrapperClassName &&
    before.annotations.length === after.annotations.length &&
    before.annotations.every((annotation, index) => {
      const next = after.annotations[index];
      // Render inputs only: cached clients can still pass full storage records.
      return (
        annotation._id === next._id &&
        annotation.type === next.type &&
        annotation.anchorText === next.anchorText &&
        annotation.anchorStartOffset === next.anchorStartOffset &&
        annotation.anchorEndOffset === next.anchorEndOffset &&
        annotation.relevanceScore === next.relevanceScore &&
        annotation.content === next.content &&
        annotation.notePath === next.notePath &&
        annotation.noteExcerpt === next.noteExcerpt
      );
    }),
);
