"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { quietControl, textControl } from "@/components/settings-controls";
import { SuggestionNote } from "@/components/suggestion-note";

type Pending = {
  suggestionId: Id<"tagMergeSuggestions">;
  into: string;
  from: string;
  merging: boolean;
};

/**
 * Two tags that look like one topic, under the topics. Merge moves the
 * articles onto the first; Keep both is remembered and never asked again.
 */
export function TagMergeSuggestion({ suggestion }: { suggestion: Pending }) {
  const accept = useMutation(api.tagMerge.accept);
  const keepBoth = useMutation(api.tagMerge.keepBoth);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(failure);
    }
    setBusy(false);
  };

  return (
    <SuggestionNote
      sentence={`${suggestion.into} and ${suggestion.from} look like the same topic.`}
    >
      {suggestion.merging ? (
        <span role="status" className="min-h-11 py-3 text-sm">
          Merging…
        </span>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => accept({ suggestionId: suggestion.suggestionId }),
                "Couldn't merge those. Try again.",
              )
            }
            className={quietControl}
          >
            Merge into {suggestion.into}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => keepBoth({ suggestionId: suggestion.suggestionId }),
                "Couldn't save that. Try again.",
              )
            }
            className={textControl}
          >
            Keep both
          </button>
        </>
      )}
    </SuggestionNote>
  );
}
