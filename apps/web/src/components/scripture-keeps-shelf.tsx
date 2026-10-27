"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation, usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InlineError, Skeleton, SkeletonBar } from "./in-place";
import { ConfirmAction } from "./settings-confirm";

export function ScriptureKeepsShelf() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.scriptureKeeps.page,
    {},
    { initialNumItems: 12 },
  );
  const open = useAction(api.actions.bible.openReading);
  const remove = useMutation(api.scriptureKeeps.remove);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<{
    keepId: Id<"scriptureKeeps">;
    action: "open" | "remove";
  } | null>(null);
  async function act(keepId: Id<"scriptureKeeps">, action: "open" | "remove") {
    if (busy) return;
    const row = results.find((item) => item._id === keepId);
    if (!row) return;
    setBusy(keepId);
    setError(null);
    try {
      if (action === "remove") {
        await remove({ keepId });
        setConfirming(null);
      } else {
        const articleId = await open({ reference: row.reference });
        router.push(`/read/${articleId}`);
      }
    } catch {
      setError({ keepId, action });
    } finally {
      setBusy(null);
    }
  }
  if (status === "LoadingFirstPage")
    return (
      <Skeleton label="Loading kept Bible passages" className="mt-6">
        <SkeletonBar className="h-5 w-1/3" />
      </Skeleton>
    );
  if (!results.length) return null;
  return (
    <section aria-label="Kept Bible passages" className="mt-8">
      <h2 className="mb-3 font-serif text-[22px]">Kept Bible passages</h2>
      <ul className="border-t border-[var(--reader-border)]">
        {results.map((item) => (
          <li
            key={item._id}
            data-nav-row
            className="flex items-start gap-4 border-b border-[var(--reader-border)] py-4"
          >
            <div className="min-w-0 flex-1">
              <button
                type="button"
                data-nav-item
                disabled={busy !== null}
                onClick={() => void act(item._id, "open")}
                className="min-h-11 text-left font-serif text-[18px] leading-snug"
              >
                {item.reference}
              </button>
              <p className="text-[12px] text-[var(--ink-muted)]">
                About {item.estimatedReadMinutes} min · Opens as ordinary
                reading in your chosen edition
              </p>
              {item.origins.map((origin, index) => (
                <p
                  key={`${origin.sourceReference}:${index}`}
                  className="mt-2 text-[14px] leading-relaxed text-[var(--ink-soft)]"
                >
                  Kept while reading{" "}
                  {origin.sourceArticleId ? (
                    <Link
                      href={`/read/${origin.sourceArticleId}`}
                      className="underline underline-offset-4"
                    >
                      {origin.sourceReference}
                    </Link>
                  ) : (
                    origin.sourceReference
                  )}
                  : {origin.reason}
                </p>
              ))}
              {busy === item._id && (
                <p role="status" className="mt-2 text-[13px]">
                  {confirming === item._id ? "Removing…" : "Opening…"}
                </p>
              )}
              {error?.keepId === item._id && (
                <InlineError
                  message={
                    error.action === "open"
                      ? "This passage could not open. Your chosen edition has not been replaced."
                      : "This passage could not be removed."
                  }
                  onRetry={() => void act(item._id, error.action)}
                  busy={busy !== null}
                />
              )}
            </div>
            <ConfirmAction
              label="Remove"
              ariaLabel={`Remove ${item.reference} from kept passages`}
              question="Remove this passage?"
              confirmLabel="Remove"
              open={confirming === item._id}
              onOpenChange={(value) => setConfirming(value ? item._id : null)}
              onConfirm={() => void act(item._id, "remove")}
            />
          </li>
        ))}
      </ul>
      {status !== "Exhausted" && (
        <button
          type="button"
          data-nav-item
          disabled={status !== "CanLoadMore"}
          onClick={() => loadMore(12)}
          className="min-h-11 text-[13px] text-[var(--ink-muted)] underline"
        >
          {status === "LoadingMore"
            ? "Loading more passages…"
            : "More passages"}
        </button>
      )}
    </section>
  );
}
