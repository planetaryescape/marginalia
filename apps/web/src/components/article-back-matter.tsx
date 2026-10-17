"use client";
import type { MutableRefObject, ReactNode, RefObject } from "react";
import { ImpressionPanel } from "@/components/impression-panel";
import { ReflectionBox } from "@/components/reflection-box";

type Reflection = Parameters<typeof ReflectionBox>[0]["reflection"];

/**
 * What closes an article: "Before you go", then the impression, then Done.
 * Nothing here is boxed; the sections are separated by space and hairlines.
 */
export function ArticleBackMatter({
  articleId,
  reflection,
  impressionRef,
  reflectionFlush,
  onDone,
  doneError,
  finished,
  onMarkUnread,
}: {
  articleId: string;
  reflection: Reflection | null | undefined;
  impressionRef: RefObject<HTMLElement | null>;
  reflectionFlush: MutableRefObject<(() => Promise<boolean>) | null>;
  onDone: () => void;
  doneError?: ReactNode;
  /** A finished article can be put back in Up next from here. */
  finished: boolean;
  onMarkUnread: () => void;
}) {
  return (
    <>
      {reflection && (
        <div className="mt-16">
          <ReflectionBox reflection={reflection} flushRef={reflectionFlush} />
        </div>
      )}

      <section
        ref={impressionRef}
        aria-label="Your impression"
        className="mt-12"
      >
        {/* SAFETY: the route segment is an article id */}
        <ImpressionPanel articleId={articleId as any} />
      </section>

      <div className="mt-10 text-center">
        {finished && (
          <p className="mb-4 font-sans text-[13px] text-[var(--ink-muted)]">
            Finished
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onDone}
            className="px-8 py-3 rounded-md bg-[var(--ink)] text-[var(--reader-bg)] font-sans text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Done
          </button>
          {finished && (
            <button
              type="button"
              onClick={onMarkUnread}
              className="px-6 py-3 rounded-md bg-[var(--reader-chip)] text-[var(--ink)] font-sans text-sm font-medium hover:bg-[var(--reader-border)] transition-colors"
            >
              Mark unread
            </button>
          )}
        </div>
        {doneError && <div className="mt-4">{doneError}</div>}
      </div>
    </>
  );
}
