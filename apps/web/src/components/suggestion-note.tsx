import type { ReactNode } from "react";
import { InlineError } from "./in-place";

/**
 * A suggestion in pencil: one sentence behind a hairline rule, then the
 * choices. It is never a badge, count or toast; the reader decides.
 */
export function SuggestionNote({
  sentence,
  failure,
  children,
}: {
  sentence: string;
  /** A choice that failed, shown under the choices with Retry. */
  failure?: { message: string; onRetry: () => void; busy: boolean } | null;
  children: ReactNode;
}) {
  return (
    <div className="my-2 border-l border-[var(--pencil-rule)] py-0.5 pl-3.5 text-sm leading-relaxed text-[var(--pencil)]">
      <p>{sentence}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-[18px]">
        {children}
      </div>
      {failure && (
        <InlineError
          message={failure.message}
          onRetry={failure.onRetry}
          busy={failure.busy}
        />
      )}
    </div>
  );
}
