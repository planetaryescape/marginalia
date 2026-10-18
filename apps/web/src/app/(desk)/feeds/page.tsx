"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { ApiTokens } from "@/components/api-tokens";
import { FeedSuggestion } from "@/components/feed-suggestion";
import { FileDrop } from "@/components/file-drop";
import {
  ChangeWash,
  InlineError,
  SavedMark,
  Skeleton,
  SkeletonBar,
} from "@/components/in-place";
import { ReadwiseCard } from "@/components/readwise-card";
import { RemoveFeedConfirm } from "@/components/remove-feed-confirm";
import {
  destructiveControl,
  fieldControl,
  primaryControl,
  quietControl,
  textControl,
} from "@/components/settings-controls";
import { SettingsPage, SettingsSection } from "@/components/settings-section";
import { useListKeys } from "@/lib/list-nav";
import { formatDate } from "@/lib/utils";

const CHECK_FLAG_TTL_MS = 10 * 60_000;
const OPML_NAME = /\.(opml|xml)$/i;

export default function FeedsPage() {
  const feeds = useQuery(api.feeds.list);
  const suggestions = useQuery(api.feedSuggestions.list);
  const suggestionsByFeed = useMemo(() => {
    const grouped = new Map<Id<"feeds">, NonNullable<typeof suggestions>>();
    for (const suggestion of suggestions ?? []) {
      const group = grouped.get(suggestion.feedId);
      if (group) group.push(suggestion);
      else grouped.set(suggestion.feedId, [suggestion]);
    }
    return grouped;
  }, [suggestions]);
  const addFeed = useMutation(api.feeds.add);
  const toggleActive = useMutation(api.feeds.toggleActive);
  const pollNow = useAction(api.feeds.pollNow);
  const [polling, setPolling] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  // The server flags feeds while they are checked, so a scheduled check and a
  // reload show it too. A check that died leaves the flag behind: ignore it
  // once it is this old.
  const [, expire] = useState(0);
  const checkingSince = Math.max(
    0,
    ...(feeds ?? []).map((f) => f.checkingSince ?? 0),
  );
  const serverChecking =
    checkingSince > 0 && Date.now() - checkingSince < CHECK_FLAG_TTL_MS;
  useEffect(() => {
    if (!serverChecking) return;
    const timer = setTimeout(
      () => expire((n) => n + 1),
      checkingSince + CHECK_FLAG_TTL_MS - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [serverChecking, checkingSince]);
  const checking = polling || serverChecking;

  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // Foreground failures stay beside the control that failed, with Retry where
  // trying again can change the result
  const [addFailure, setAddFailure] = useState<string | null>(null);
  const [importFailure, setImportFailure] = useState<{
    message: string;
    retry?: () => void;
  } | null>(null);
  const [rowFailure, setRowFailure] = useState<{
    feedId: Id<"feeds">;
    retry: () => void;
  } | null>(null);
  // One feed's removal is open at a time; touching another row closes it.
  const [removingId, setRemovingId] = useState<Id<"feeds"> | null>(null);
  // Results of the reader's own add and import, shown where they acted
  const [added, setAdded] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  useListKeys(
    {
      p: { action: "toggle" },
      x: { action: "remove" },
    },
    [
      ["p", "Pause or resume the source"],
      ["x", "Remove the source"],
    ],
    true,
    "Sources",
  );

  // A successful check shows itself: each feed it updated takes the change wash
  const checkNow = async () => {
    setRemovingId(null);
    setPolling(true);
    setPollFailed(false);
    try {
      await pollNow({});
    } catch {
      setPollFailed(true);
    }
    setPolling(false);
  };

  const importOpml = async (file: File) => {
    setRemovingId(null);
    setImporting(true);
    setImportFailure(null);
    setImportResult(null);
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
          outline.getAttribute("title") || outline.getAttribute("text") || "";
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
      setImportResult(
        `Imported ${added} feeds${skipped ? `; ${skipped} couldn't be added` : ""}`,
      );
    } catch (error) {
      setImportFailure({
        message:
          error instanceof Error
            ? error.message
            : "Couldn't read the OPML file.",
        retry: () => void importOpml(file),
      });
    } finally {
      setImporting(false);
    }
  };

  // A drop is refused the same way a pick is: in one sentence, without importing
  const dropOpml = (files: File[]) => {
    if (importing) return;
    const file = files.find((f) => OPML_NAME.test(f.name));
    if (file) void importOpml(file);
    else
      setImportFailure({
        message: "Marginalia imports OPML files, which end in .opml or .xml.",
      });
  };

  const toggle = async (feedId: Id<"feeds">) => {
    setRowFailure(null);
    try {
      await toggleActive({ feedId });
    } catch {
      setRowFailure({ feedId, retry: () => void toggle(feedId) });
    }
  };

  const handleAdd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim()) return;
    setRemovingId(null);

    setAdding(true);
    setAddFailure(null);
    setAdded(false);
    try {
      // Use the URL as both title and URL for now — pollFeeds will update title
      await addFeed({
        url: url.trim(),
        title: new URL(url.trim()).hostname,
      });
      setUrl("");
      setAdded(true);
    } catch (error) {
      setAddFailure(
        error instanceof Error ? error.message : "Couldn't add that feed.",
      );
    }
    setAdding(false);
  };

  return (
    <SettingsPage title="Sources">
      <ReadwiseCard />

      <SettingsSection
        title="Feeds"
        syncing={checking}
        description="Add a feed URL, or import an OPML file from another reader. New posts arrive in your library."
        action={
          <button
            type="button"
            onClick={checkNow}
            disabled={checking || !feeds?.length}
            className={quietControl}
          >
            {checking ? "Checking…" : "Check now"}
          </button>
        }
      >
        {pollFailed && (
          <InlineError
            message="Couldn't check your feeds."
            onRetry={() => void checkNow()}
            busy={checking}
          />
        )}
        <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            aria-label="Feed URL"
            className={`${fieldControl} max-w-sm flex-1`}
          />
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className={primaryControl}
          >
            {adding ? "Adding…" : "Add"}
          </button>
          <SavedMark visible={added}>Added</SavedMark>
        </form>
        {addFailure && (
          <InlineError
            message={addFailure}
            busy={adding}
            onRetry={() => void handleAdd()}
          />
        )}

        <p className="text-sm text-[var(--reader-muted)]">
          or{" "}
          <label
            className={`${textControl} cursor-pointer focus-within:outline focus-within:outline-1 focus-within:outline-[var(--reader-focus)] focus-within:outline-offset-2`}
          >
            {importing ? "Importing feeds…" : "import an OPML file"}
            <input
              type="file"
              accept=".opml,.xml"
              className="sr-only"
              disabled={importing}
              onChange={(e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (file)
                  void importOpml(file).finally(() => {
                    input.value = "";
                  });
              }}
            />
          </label>
          {importResult && (
            <SavedMark visible hold>
              {importResult}
            </SavedMark>
          )}
        </p>

        {importFailure &&
          (importFailure.retry ? (
            <InlineError
              message={importFailure.message}
              busy={importing}
              onRetry={importFailure.retry}
            />
          ) : (
            // A refused file is not retried; the reader picks another
            <p role="alert" className="inline-error">
              <span className="inline-error-dot" aria-hidden="true" />
              <span>{importFailure.message}</span>
            </p>
          ))}

        {feeds === undefined && (
          <Skeleton label="Loading sources">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="border-b border-[var(--reader-border)] py-3"
              >
                <SkeletonBar className="h-4 w-[40%]" />
                <SkeletonBar className="mt-2 h-3.5 w-[60%]" />
              </div>
            ))}
          </Skeleton>
        )}
        {feeds && feeds.length === 0 && (
          <p className="text-sm text-[var(--reader-muted)]">
            No feeds yet. Add one above.
          </p>
        )}
        <div>
          {feeds?.map((feed) => (
            <div key={feed._id} data-nav-row>
              <ChangeWash
                value={feed.lastFetchedAt}
                className="change-wash group flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-[var(--reader-border)] py-3"
              >
                <div
                  className="min-w-0 flex-1 text-sm"
                  data-nav-item
                  tabIndex={-1}
                >
                  <p className="truncate font-medium">{feed.title}</p>
                  <p className="truncate text-[13px] text-[var(--reader-muted)]">
                    {feed.url}
                  </p>
                  {(feed.lastFetchedAt || feed.articleCount !== undefined) && (
                    <p className="text-[13px] text-[var(--reader-muted)]">
                      {[
                        feed.lastFetchedAt &&
                          `Fetched ${formatDate(feed.lastFetchedAt)}`,
                        feed.articleCount !== undefined &&
                          `${feed.articleCount} in your library`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {!feed.isActive && (
                    <p className="text-[13px] text-[var(--reader-muted)]">
                      Paused
                    </p>
                  )}
                  {feed.lastError && (
                    <p className="text-[13px] text-[var(--danger)]">
                      Error: {feed.lastError}
                    </p>
                  )}
                </div>
                {/* Shown on hover and focus, and always on touch screens */}
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <button
                    type="button"
                    data-nav-action="toggle"
                    aria-pressed={feed.isActive}
                    aria-label={`${feed.isActive ? "Pause" : "Resume"} ${feed.title}`}
                    onClick={() => {
                      setRemovingId(null);
                      void toggle(feed._id);
                    }}
                    className={textControl}
                  >
                    {feed.isActive ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    data-nav-action="remove"
                    aria-label={`Remove ${feed.title}`}
                    onClick={() => setRemovingId(feed._id)}
                    className={destructiveControl}
                  >
                    Remove
                  </button>
                </div>
              </ChangeWash>
              {rowFailure?.feedId === feed._id && (
                <InlineError
                  message="Couldn't update the feed."
                  onRetry={rowFailure.retry}
                />
              )}
              {removingId === feed._id && (
                <RemoveFeedConfirm
                  feed={feed}
                  onClose={() => setRemovingId(null)}
                />
              )}
              {removingId !== feed._id &&
                suggestionsByFeed
                  .get(feed._id)
                  ?.map((s) => (
                    <FeedSuggestion
                      key={s.feedId}
                      feed={feed}
                      offered={s.offered}
                      opened={s.opened}
                    />
                  ))}
            </div>
          ))}
        </div>
      </SettingsSection>

      <ApiTokens />
      <FileDrop
        onFiles={dropOpml}
        title="Drop to import your feeds"
        hint="An OPML file from another reader"
      />
    </SettingsPage>
  );
}
