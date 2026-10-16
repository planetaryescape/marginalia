"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { DeskPage } from "@/components/desk-page";
import { ReadwiseCard } from "@/components/readwise-card";
import { formatDate } from "@/lib/utils";

export default function FeedsPage() {
  const feeds = useQuery(api.feeds.list);
  const addFeed = useMutation(api.feeds.add);
  const removeFeed = useMutation(api.feeds.remove);
  const toggleActive = useMutation(api.feeds.toggleActive);
  const pollNow = useAction(api.feeds.pollNow);
  const [polling, setPolling] = useState(false);

  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setAdding(true);
    try {
      // Use the URL as both title and URL for now — pollFeeds will update title
      await addFeed({
        url: url.trim(),
        title: new URL(url.trim()).hostname,
      });
      setUrl("");
      toast.success("Feed added. Articles will appear shortly.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add feed",
      );
    }
    setAdding(false);
  };

  const handleRemove = async (feedId: Id<"feeds">) => {
    try {
      await removeFeed({ feedId });
      toast.success("Feed removed");
    } catch {
      toast.error("Couldn't remove the feed. Try again.");
    }
  };

  return (
    <DeskPage
      title="Sources"
      action={
        <button
          type="button"
          onClick={async () => {
            setPolling(true);
            try {
              await pollNow({});
              toast.success("Polling feeds... articles will appear shortly.");
            } catch {
              toast.error("Failed to poll");
            }
            setPolling(false);
          }}
          disabled={polling || !feeds?.length}
          className="shrink-0 text-[var(--ink-soft)] hover:text-[var(--ink)] hover:underline text-sm disabled:opacity-40"
        >
          {polling ? "Polling..." : "Poll now"}
        </button>
      }
    >
      <ReadwiseCard />

      {/* Add feed */}
      <form onSubmit={handleAdd} className="mb-10">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            aria-label="Feed URL"
            className="min-w-0 flex-1 px-4 py-3 rounded-xl border border-[var(--reader-border)] bg-[var(--reader-surface)] text-[var(--reader-fg)] text-sm placeholder:text-[var(--reader-muted)] focus:outline-none focus:border-[var(--reader-focus)]"
          />
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className="px-5 py-3 bg-[var(--reader-fg)] text-[var(--reader-bg)] rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      {/* OPML Import */}
      <div className="mb-10">
        <label className="relative flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-[var(--reader-border-strong)] cursor-pointer hover:border-[var(--ink-muted)] focus-within:outline focus-within:outline-1 focus-within:outline-[var(--reader-focus)] focus-within:outline-offset-2 transition-colors">
          <span className="text-xs text-[var(--reader-muted)]">
            {importing ? "Importing feeds…" : "Import OPML file"}
          </span>
          <input
            type="file"
            accept=".opml,.xml"
            className="sr-only"
            disabled={importing}
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              setImporting(true);
              try {
                const text = await file.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, "text/xml");
                if (doc.querySelector("parsererror"))
                  throw new Error("This OPML file isn't valid XML.");
                const outlines = doc.querySelectorAll("outline[xmlUrl]");
                if (!outlines.length)
                  throw new Error("No feed URLs found in this OPML file.");
                let added = 0;
                let skipped = 0;
                for (const outline of outlines) {
                  const feedUrl = outline.getAttribute("xmlUrl");
                  const title =
                    outline.getAttribute("title") ||
                    outline.getAttribute("text") ||
                    "";
                  if (!feedUrl) continue;
                  try {
                    await addFeed({
                      url: feedUrl,
                      title: title || new URL(feedUrl).hostname,
                    });
                    added++;
                  } catch {
                    skipped++;
                  }
                }
                toast.success(
                  `Imported ${added} feeds${skipped ? `; ${skipped} couldn't be added` : ""}`,
                );
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Couldn't read the OPML file.",
                );
              } finally {
                input.value = "";
                setImporting(false);
              }
            }}
          />
        </label>
      </div>

      {/* Feed list */}
      {feeds === undefined && (
        <p role="status" className="py-8 text-sm text-[var(--reader-muted)]">
          Loading sources…
        </p>
      )}
      {feeds && feeds.length === 0 ? (
        <p className="text-center text-[var(--reader-muted)] text-sm py-12">
          No feeds yet. Add one above.
        </p>
      ) : (
        <div className="space-y-3">
          {feeds?.map((feed) => (
            <div
              key={feed._id}
              className="flex flex-wrap sm:flex-nowrap items-center gap-4 p-4 rounded-xl border border-[var(--reader-border)] bg-[var(--reader-surface)]"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--reader-fg)] truncate">
                  {feed.title}
                </p>
                <p className="text-xs text-[var(--reader-muted)] truncate">
                  {feed.url}
                </p>
                <div className="flex gap-3 mt-1 text-xs text-[var(--reader-muted)]">
                  {feed.lastFetchedAt && (
                    <span>Fetched {formatDate(feed.lastFetchedAt)}</span>
                  )}
                  {feed.lastError && (
                    <span className="text-annotation-tension">
                      Error: {feed.lastError}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={feed.isActive}
                  aria-label={`${feed.isActive ? "Pause" : "Resume"} ${feed.title}`}
                  onClick={() =>
                    toggleActive({ feedId: feed._id }).catch(() =>
                      toast.error("Couldn't update the feed. Try again."),
                    )
                  }
                  className={`px-3 py-1 rounded-full text-xs font-sans font-medium transition-colors ${
                    feed.isActive
                      ? "bg-annotation-context/10 text-annotation-context"
                      : "bg-[var(--reader-chip)] text-[var(--reader-muted)]"
                  }`}
                >
                  {feed.isActive ? "Active" : "Paused"}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${feed.title}`}
                  onClick={() => handleRemove(feed._id)}
                  className="text-[var(--reader-muted)] hover:text-[var(--reader-fg)] text-sm transition-colors"
                  title="Remove feed"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </DeskPage>
  );
}
