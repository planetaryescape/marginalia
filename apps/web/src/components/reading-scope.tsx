"use client";
import type { ReadingScope } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { toast } from "sonner";

export function ReadingScopeControl({ scope }: { scope: ReadingScope }) {
  const id = useId();
  const setPreferences = useMutation(api.bible.setPreferences);
  const [busy, setBusy] = useState(false);
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--reader-fg-soft)]"
    >
      Look in
      <select
        id={id}
        className="min-h-11 max-w-full rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)] px-3 text-sm text-[var(--reader-fg)]"
        value={scope}
        disabled={busy}
        onChange={async (event) => {
          const next = event.target.value;
          if (next !== "articles" && next !== "mixed" && next !== "bible")
            return;
          setBusy(true);
          try {
            await setPreferences({ scope: next });
          } catch {
            toast.error("Couldn't change reading sources. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="articles">Articles only</option>
        <option value="mixed">Articles + Bible</option>
        <option value="bible">Bible only</option>
      </select>
    </label>
  );
}
