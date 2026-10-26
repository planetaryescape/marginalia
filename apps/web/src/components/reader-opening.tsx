"use client";
import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { articleTitleName, rememberedTitle } from "@/lib/title-handoff";
import { Skeleton, SkeletonBar } from "./in-place";
import { ViewTransition } from "./view-transition";

export const READER_COLUMN =
  "article-column mx-auto px-6 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))]";
export const READER_HEADING =
  "text-3xl sm:text-4xl font-medium text-[var(--reader-fg)] leading-tight mb-4";

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
        className={READER_HEADING}
        style={{ fontFamily: "var(--reader-font)" }}
      >
        {title}
      </h1>
    </ViewTransition>
  );
}

/**
 * What the reader shows before the article has loaded: the heading, drawn from
 * the title the desk held when the pick was pressed, or a placeholder on reload.
 * `columnStyle` is the article column's own style, so the heading does not
 * jump when the real article replaces this.
 */
export function ReaderOpening({
  articleId,
  columnStyle,
  title: knownTitle,
  showSummary = true,
  meta,
  label = "Loading article",
  bibleTools = false,
}: {
  articleId: string;
  columnStyle: CSSProperties;
  title?: string;
  showSummary?: boolean;
  meta?: string;
  label?: string;
  bibleTools?: boolean;
}) {
  const title = knownTitle ?? rememberedTitle(articleId);
  return (
    <div className="pr-[var(--notes-inset)]">
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 right-[var(--notes-inset)] pt-[env(safe-area-inset-top)] bg-[var(--reader-bg)]"
      >
        <div
          className="mx-auto px-4 sm:px-6 py-2 sm:py-3 flex items-center justify-between"
          style={{ maxWidth: `max(${columnStyle.maxWidth ?? "65ch"}, 42rem)` }}
        >
          <div className="flex h-11 sm:h-5 items-center">
            <SkeletonBar className="h-3 w-12" />
          </div>
          <div className="flex gap-0.5">
            {Array.from({ length: bibleTools ? 4 : 2 }, (_, index) => (
              <div
                key={index}
                className="h-11 w-11 sm:h-9 sm:w-9 flex items-center justify-center"
              >
                <SkeletonBar className="h-4 w-4" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <article className={READER_COLUMN} style={columnStyle}>
        <header className="mb-10">
          {title ? (
            <ReaderTitle articleId={articleId} title={title} />
          ) : (
            <div className={READER_HEADING} aria-hidden="true">
              <SkeletonBar className="h-[1.25em] w-3/4" />
            </div>
          )}
          <div className="text-sm font-sans text-[var(--ink-muted)]">
            {meta ?? (
              <div className="flex h-5 items-center" aria-hidden="true">
                <SkeletonBar className="h-3 w-40" />
              </div>
            )}
          </div>
        </header>
        <Skeleton label={label}>
          {showSummary && (
            <div className="mb-10 font-sans">
              <div className="py-1 text-[14px] leading-[1.55] text-[var(--pencil)]">
                Summary, key claims and a map, before you start
                <ArrowRight size={14} aria-hidden className="ml-1.5 inline align-[-2px]" />
              </div>
            </div>
          )}
          <div
            data-testid="reader-body-skeleton"
            style={{
              fontSize: "var(--reader-size)",
              lineHeight: "var(--reader-leading)",
            }}
          >
            {[0, 1, 2].map((paragraph) => (
              <div key={paragraph} className="mb-[1.25em]">
                {["100%", "100%", "85%", "100%", "60%"].map((width, line) => (
                  <div
                    key={`${paragraph}-${line}`}
                    className="flex items-center"
                    style={{ height: "calc(1em * var(--reader-leading))" }}
                  >
                    <span
                      className="rounded bg-[var(--reader-chip)] h-[0.65em]"
                      style={{ width }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Skeleton>
      </article>
    </div>
  );
}
