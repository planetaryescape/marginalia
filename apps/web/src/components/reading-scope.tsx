"use client";
import type { ReadingScope } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation } from "convex/react";
import { Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { InlineError } from "@/components/in-place";

const OPTIONS = [
  { value: "articles", label: "Articles only" },
  { value: "mixed", label: "Articles + Bible" },
  { value: "bible", label: "Bible only" },
] as const satisfies readonly { value: ReadingScope; label: string }[];

export function ReadingScopeControl({ scope }: { scope: ReadingScope }) {
  const setPreferences = useMutation(api.bible.setPreferences);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [failedScope, setFailedScope] = useState<ReadingScope | null>(null);
  const selectedLabel = OPTIONS.find((option) => option.value === scope)?.label;

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

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--reader-fg-soft)]">
      <span>Look in</span>
      <DropdownMenu.Root
        modal={false}
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen && busyRef.current) return;
          setOpen(nextOpen);
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-disabled={busy}
            aria-busy={busy}
            aria-label={`Look in, ${selectedLabel}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] px-3 text-sm text-[var(--reader-fg)] outline-none transition-colors hover:bg-[var(--reader-chip)] focus-visible:ring-2 focus-visible:ring-[var(--reader-focus)] aria-disabled:cursor-wait aria-disabled:opacity-60"
          >
            {selectedLabel}
            <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Reading sources"
            onCloseAutoFocus={(event) => {
              if (document.activeElement !== document.body)
                event.preventDefault();
            }}
            className="reader-menu z-50 w-64 max-w-[calc(100vw-24px)] p-1.5 outline-none"
          >
            <DropdownMenu.RadioGroup
              value={scope}
              aria-label="Reading sources"
              onValueChange={(value) => {
                const option = OPTIONS.find((item) => item.value === value);
                if (option && option.value !== scope) void save(option.value);
              }}
            >
              {OPTIONS.map((option) => (
                <DropdownMenu.RadioItem
                  key={option.value}
                  value={option.value}
                  disabled={busy}
                  className="flex min-h-11 cursor-default items-center justify-between gap-6 rounded-md px-2.5 py-2 font-sans text-sm text-[var(--ink)] outline-none data-[highlighted]:bg-[var(--reader-chip)] data-[disabled]:opacity-60"
                >
                  {option.label}
                  <DropdownMenu.ItemIndicator>
                    <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
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
