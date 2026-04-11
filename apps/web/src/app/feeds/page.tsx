"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";

export default function FeedsPage() {
  const feeds = useQuery(api.feeds.list);
  const addFeed = useMutation(api.feeds.add);
  const removeFeed = useMutation(api.feeds.remove);
  const toggleActive = useMutation(api.feeds.toggleActive);
  const pollNow = useAction(api.feeds.pollNow);
  const [polling, setPolling] = useState(false);

  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

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

  const handleRemove = async (feedId: string) => {
    await removeFeed({ feedId: feedId as any });
    toast.success("Feed removed");
  };

  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <Link
          href="/"
          className="text-ink-400 hover:text-ink-600 font-sans text-sm transition-colors"
        >
          &larr; Back
        </Link>
        <h1 className="text-xl font-serif font-medium text-ink-950 dark:text-parchment-100">
          Your Feeds
        </h1>
        <button
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
          className="text-annotation-crossref hover:underline font-sans text-sm disabled:opacity-40"
        >
          {polling ? "Polling..." : "Poll now"}
        </button>
      </div>

      {/* Add feed */}
      <form onSubmit={handleAdd} className="mb-10">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="flex-1 px-4 py-3 rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 text-ink-800 dark:text-parchment-300 font-sans text-sm placeholder:text-ink-300 dark:placeholder:text-ink-600 focus:outline-none focus:border-annotation-crossref"
          />
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className="px-5 py-3 bg-ink-950 dark:bg-parchment-100 text-parchment-50 dark:text-ink-950 rounded-xl font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {adding ? "..." : "Add"}
          </button>
        </div>
      </form>

      {/* Feed list */}
      {feeds && feeds.length === 0 ? (
        <p className="text-center text-ink-400 dark:text-ink-500 font-sans text-sm py-12">
          No feeds yet. Add one above.
        </p>
      ) : (
        <div className="space-y-3">
          {feeds?.map((feed) => (
            <div
              key={feed._id}
              className="flex items-center gap-4 p-4 rounded-xl border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900"
            >
              <div className="flex-1 min-w-0">
                <p className="font-sans text-sm font-medium text-ink-800 dark:text-parchment-200 truncate">
                  {feed.title}
                </p>
                <p className="text-xs font-sans text-ink-400 dark:text-ink-500 truncate">
                  {feed.url}
                </p>
                <div className="flex gap-3 mt-1 text-xs font-sans text-ink-400">
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
                  onClick={() => toggleActive({ feedId: feed._id })}
                  className={`px-3 py-1 rounded-full text-xs font-sans font-medium transition-colors ${
                    feed.isActive
                      ? "bg-annotation-context/10 text-annotation-context"
                      : "bg-ink-100 dark:bg-ink-800 text-ink-400"
                  }`}
                >
                  {feed.isActive ? "Active" : "Paused"}
                </button>
                <button
                  onClick={() => handleRemove(feed._id)}
                  className="text-ink-300 hover:text-annotation-tension text-sm transition-colors"
                  title="Remove feed"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
