"use client";
import type { CSSProperties } from "react";
import { articleTitleName, rememberedTitle } from "@/lib/title-handoff";
import { ViewTransition } from "./view-transition";

/** The reader heading, named so the desk title can travel into it. */
export function ReaderTitle({
  articleId,
  title,
}: {
  articleId: string;
  title: string;
}) {
  return (
    <ViewTransition
      name={articleTitleName(articleId)}
      share="article-title"
      default="none"
    >
      <h1
        className="text-3xl sm:text-4xl font-medium text-[var(--reader-fg)] leading-tight mb-4"
        style={{ fontFamily: "var(--reader-font)" }}
      >
        {title}
      </h1>
    </ViewTransition>
  );
}

/**
 * What the reader shows before the article has loaded: the heading, drawn from
 * the title the desk held when the pick was pressed. Null when the desk never
 * held it (a deep link or a reload), where the caller shows its loading state.
 * `columnStyle` is the article column's own style, so the heading does not
 * jump when the real article replaces this.
 */
export function ReaderOpening({
  articleId,
  columnStyle,
}: {
  articleId: string;
  columnStyle: CSSProperties;
}) {
  const title = rememberedTitle(articleId);
  if (!title) return null;
  return (
    <div className="pr-[var(--notes-inset)]">
      <article
        className="article-column mx-auto px-6 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))]"
        style={columnStyle}
      >
        <header className="mb-10">
          <ReaderTitle articleId={articleId} title={title} />
        </header>
        <p role="status" className="sr-only">
          Loading article
        </p>
      </article>
    </div>
  );
}
