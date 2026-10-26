"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { FAILURE_COPY } from "@/lib/failure-copy";
import { SuggestionNote } from "./suggestion-note";

/**
 * One quiet sentence under a feed the reader almost never opens. Unsubscribe is
 * the confirmation, so it asks once; Keep silences the sentence for 90 days.
 * Nothing happens until one is pressed.
 */
export function FeedSuggestion({
  feed,
  offered,
  opened,
}: {
  feed: { _id: Id<"feeds">; title: string };
  offered: number;
  opened: number;
}) {
  const removeFeed = useMutation(api.feeds.remove);
  const keepFeed = useMutation(api.feedSuggestions.keep);
  const [busy, setBusy] = useState(false);

  const [failure, setFailure] = useState<{
    message: string;
    retry: () => void;
  } | null>(null);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch {
      setFailure({ message, retry: () => void run(action, message) });
      setBusy(false);
    }
  };

  return (
    <SuggestionNote
      sentence={`You've opened ${opened} of the ${offered} from this feed. Unsubscribe?`}
      failure={
        failure && {
          message: failure.message,
          onRetry: failure.retry,
          busy,
        }
      }
    >
      <button
        type="button"
        disabled={busy}
        aria-label={`Unsubscribe from ${feed.title}`}
        onClick={() =>
          run(async () => {
            // Its articles stay; the reader can still clear them from Remove
            await removeFeed({ feedId: feed._id, articles: "keep" });
            toast.success(`Unsubscribed from ${feed.title}`);
          }, "Couldn't unsubscribe. Try again.")
        }
        className="inline-flex min-h-11 items-center text-sm text-[var(--danger)] disabled:opacity-40"
      >
        Unsubscribe
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label={`Keep ${feed.title}`}
        onClick={() =>
          run(() => keepFeed({ feedId: feed._id }), FAILURE_COPY.save)
        }
        className="inline-flex min-h-11 items-center text-sm text-[var(--reader-fg-soft)] disabled:opacity-40"
      >
        Keep
      </button>
    </SuggestionNote>
  );
}
