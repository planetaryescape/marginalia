"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useModalDialog } from "@/lib/use-modal-dialog";

type Choice = "keep" | "unread" | "all";

const plural = (n: number, partial: boolean) =>
  `${n}${partial ? "+" : ""} article${n === 1 && !partial ? "" : "s"}`;

const alsoInReader = (n: number) =>
  n ? `, ${n} of them also from Readwise Reader` : "";

/** Asks what happens to a feed's articles before unsubscribing from it. */
export function RemoveFeedDialog({
  feed,
  onClose,
}: {
  feed: { _id: Id<"feeds">; title: string };
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const preview = useQuery(api.feeds.removalPreview, { feedId: feed._id });
  const removeFeed = useMutation(api.feeds.remove);
  const [choice, setChoice] = useState<Choice>("keep");
  const [removing, setRemoving] = useState(false);
  useModalDialog(dialogRef, true);

  const partial = preview?.partial ?? false;
  const options: { value: Choice; label: string; detail: string }[] = [
    {
      value: "keep",
      label: "Keep its articles",
      detail: preview
        ? `${plural(preview.total, partial)} stay in your library.`
        : "Everything already imported stays in your library.",
    },
    {
      value: "unread",
      label: "Remove the ones I haven't opened",
      detail: preview
        ? `Removes ${plural(preview.unread, partial)}${alsoInReader(preview.unreadInReader)}. Anything you've opened, saved, loved or marked stays.`
        : "Anything you've opened, saved, loved or marked stays.",
    },
    {
      value: "all",
      label: "Remove all its articles",
      detail: preview
        ? `Removes ${plural(preview.all, partial)}${alsoInReader(preview.allInReader)}. Articles with your highlights or notes stay.`
        : "Articles with your highlights or notes stay.",
    },
  ];

  const confirm = async () => {
    setRemoving(true);
    try {
      await removeFeed({ feedId: feed._id, articles: choice });
      toast.success(
        choice === "keep"
          ? `Unsubscribed from ${feed.title}`
          : `Unsubscribed from ${feed.title}. Removing its articles…`,
      );
      onClose();
    } catch {
      toast.error("Couldn't remove the feed. Try again.");
      setRemoving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="remove-feed-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!removing) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-[520px] rounded-2xl p-6 font-sans bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border)] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] backdrop:bg-black/40"
    >
      <h2
        id="remove-feed-title"
        className="font-serif text-[22px] tracking-tight"
      >
        Remove {feed.title}?
      </h2>
      <p className="mt-1 text-sm text-[var(--reader-muted)]">
        No new posts will arrive. What should happen to the ones already here?
      </p>

      <fieldset className="mt-5 space-y-2">
        <legend className="sr-only">Its articles</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              choice === option.value
                ? "border-[var(--reader-focus)]"
                : "border-[var(--reader-border)] hover:border-[var(--reader-border-strong)]"
            }`}
          >
            <input
              type="radio"
              name="feed-articles"
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
              className="mt-1 accent-[var(--reader-fg)]"
            />
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-[var(--reader-muted)]">
                {option.detail}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={removing}
          className="px-4 py-2 rounded-xl text-sm text-[var(--reader-muted)] hover:text-[var(--reader-fg)] disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={removing}
          className="px-4 py-2 bg-[var(--reader-fg)] text-[var(--reader-bg)] rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {removing ? "Removing…" : "Remove feed"}
        </button>
      </div>
    </dialog>
  );
}
