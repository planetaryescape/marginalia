"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface OutlineUnit {
  title: string;
  minutes: number;
  chapter?: string;
}

const LINK =
  "text-[var(--ink-soft)] underline decoration-[var(--pencil-rule)] underline-offset-[3px] hover:text-[var(--ink)]";

/**
 * The foot of a book's part: the way to the next one, and every part by name.
 * Navigating changes only `?unit=`, so the page keeps its toolbar and settings.
 */
export function BookUnitNav({
  articleId,
  unitIndex,
  outline,
}: {
  articleId: string;
  unitIndex: number;
  outline: readonly OutlineUnit[];
}) {
  const href = (index: number) => `/read/${articleId}?unit=${index}`;
  const next = outline[unitIndex + 1];
  const previous = outline[unitIndex - 1];
  return (
    <nav
      aria-label="Parts of this book"
      className="mt-16 border-t border-[var(--reader-border)] pt-6 font-sans"
    >
      <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">
        Part {unitIndex + 1} of {outline.length}
      </p>
      {next ? (
        <Link
          href={href(unitIndex + 1)}
          className="group mt-3 block rounded-xl bg-[var(--reader-surface)] px-5 py-4 ring-1 ring-[var(--reader-border)] hover:ring-[var(--reader-border-strong)]"
        >
          <span className="block text-[12.5px] text-[var(--ink-muted)]">
            Next part · {next.minutes} min
          </span>
          <span className="mt-0.5 block font-serif text-[22px] leading-tight group-hover:underline group-hover:decoration-[var(--pencil-rule)] underline-offset-4">
            {next.title}
          </span>
        </Link>
      ) : (
        <p className="mt-3 text-[15px] text-[var(--ink-soft)]">
          That's the end of the book.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14.5px]">
        {previous && (
          <Link href={href(unitIndex - 1)} className={LINK}>
            Previous part
          </Link>
        )}
        <details className="group/parts open:w-full">
          <summary className={cn("cursor-pointer list-none", LINK)}>
            All {outline.length} parts
          </summary>
          <ol className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto pr-2">
            {outline.map((unit, index) => (
              <li key={`${index}:${unit.title}`}>
                <Link
                  href={href(index)}
                  aria-current={index === unitIndex ? "page" : undefined}
                  className="flex items-baseline justify-between gap-4 py-1.5 text-[var(--ink-soft)] hover:text-[var(--ink)] aria-[current=page]:font-medium aria-[current=page]:text-[var(--ink)]"
                >
                  <span className="min-w-0">
                    <span className="tabular-nums text-[var(--ink-muted)]">
                      {index + 1}.{" "}
                    </span>
                    {unit.title}
                  </span>
                  <span className="shrink-0 text-[12.5px] tabular-nums text-[var(--ink-muted)]">
                    {unit.minutes} min
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </nav>
  );
}
