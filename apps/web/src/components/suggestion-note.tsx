import type { ReactNode } from "react";

/**
 * A suggestion in pencil: one sentence behind a hairline rule, then the
 * choices. It is never a badge, count or toast; the reader decides.
 */
export function SuggestionNote({
  sentence,
  children,
}: {
  sentence: string;
  children: ReactNode;
}) {
  return (
    <div className="my-2 border-l border-[var(--pencil-rule)] py-0.5 pl-3.5 text-sm leading-relaxed text-[var(--pencil)]">
      <p>{sentence}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-[18px]">
        {children}
      </div>
    </div>
  );
}
