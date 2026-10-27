"use client";
import type { ReadingScope } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { InlineError } from "@/components/in-place";
import { useShortcuts } from "@/lib/shortcuts";

const OPTIONS = [
  { value: "articles", label: "Articles only" },
  { value: "mixed", label: "Articles + Bible" },
  { value: "bible", label: "Bible only" },
] as const satisfies readonly { value: ReadingScope; label: string }[];

export function ReadingScopeControl({ scope }: { scope: ReadingScope }) {
  const setPreferences = useMutation(api.bible.setPreferences);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failedScope, setFailedScope] = useState<ReadingScope | null>(null);
  const selectedIndex = OPTIONS.findIndex((option) => option.value === scope);

  async function save(next: ReadingScope) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailedScope(null);
    try {
      await setPreferences({ scope: next });
    } catch {
      setFailedScope(next);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  useShortcuts(
    {
      f: () => {
        if (busyRef.current) return;
        const next = OPTIONS[(selectedIndex + 1) % OPTIONS.length];
        if (next) void save(next.value);
      },
    },
    true,
    { help: { group: "Desk", keys: [["F", "Cycle reading source"]] } },
  );

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--reader-fg-soft)]">
      <span id="reading-source-label">Look in</span>
      <div
        role="radiogroup"
        aria-labelledby="reading-source-label"
        aria-busy={busy}
        className="inline-flex rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] p-1"
      >
        {OPTIONS.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={scope === option.value}
            aria-label={option.label}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            tabIndex={scope === option.value ? 0 : -1}
            onClick={() => {
              if (scope !== option.value) void save(option.value);
            }}
            onKeyDown={(event) => {
              if (
                event.key !== "ArrowLeft" &&
                event.key !== "ArrowRight" &&
                event.key !== "ArrowUp" &&
                event.key !== "ArrowDown"
              )
                return;
              event.preventDefault();
              const direction =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : -1;
              const next =
                OPTIONS[(index + direction + OPTIONS.length) % OPTIONS.length];
              if (next) void save(next.value);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLElement>("[role=radio]")
                [
                  (index + direction + OPTIONS.length) % OPTIONS.length
                ]?.focus();
            }}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-[13px] text-[var(--reader-fg-soft)] outline-none hover:bg-[var(--reader-chip)] focus-visible:ring-2 focus-visible:ring-[var(--reader-focus)] aria-checked:bg-[var(--reader-chip)] aria-checked:text-[var(--reader-fg)] disabled:opacity-50"
          >
            {option.label}
            {scope === option.value && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>
      {failedScope && (
        <InlineError
          message="Couldn't change reading sources."
          onRetry={() => void save(failedScope)}
          busy={busy}
        />
      )}
    </div>
  );
}
