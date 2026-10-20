"use node";
import { v } from "convex/values";
import Parser from "rss-parser";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  FEED_BATCH_BYTES,
  FEED_BODY_BYTES,
  FEED_ITEM_BATCH,
  FEED_ITEMS,
  pollClaim,
  utf8Bytes,
  validFeedEntry,
} from "../lib/feedPollProtocol";

// Old queued cron/manual payloads remain valid; no foreground network wait.
export const pollAllFeeds = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.feedPolling.begin, args);
  },
});

export const FIRST_POLL_POSTS = 3;
const IMPORT_MAX_AGE_MS = 30 * 86_400_000;
export const FEED_NETWORK_MS = 10_000;
const POLL_ACTION_MS = 45_000;

/** The same deadline covers headers AND the streaming body, not just fetch(). */
export async function readFeedBody(response: Response, signal: AbortSignal) {
  if (Number(response.headers.get("content-length")) > FEED_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error("Feed exceeds 1 MiB");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const body = new Uint8Array(FEED_BODY_BYTES);
  let bytes = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (bytes + value.byteLength > FEED_BODY_BYTES)
        throw new Error("Feed exceeds 1 MiB");
      body.set(value, bytes);
      bytes += value.byteLength;
    }
    const xml = new TextDecoder().decode(body.subarray(0, bytes));
    // A plain DOCTYPE is accepted by the existing parser without resolving an
    // external DTD. Keep valid legacy feeds; reject custom entity declarations.
    if (/<!\s*ENTITY\b/i.test(xml))
      throw new Error("Feed XML entity declarations are not supported");
    return xml;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type FeedValidators = {
  etag?: string;
  modified?: string;
  representationUrl?: string;
};
async function fetchFeed(
  url: string,
  validators: FeedValidators,
  signal: AbortSignal,
  reservationUntil: number,
) {
  let representationUrl = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    if (Date.now() >= reservationUntil)
      throw new Error("Feed network reservation expired");
    const headers: Record<string, string> = { "User-Agent": "Marginalia/1.0" };
    // Redirects are not the representation whose validators were committed.
    if (representationUrl === (validators.representationUrl ?? url)) {
      if (validators.etag) headers["If-None-Match"] = validators.etag;
      if (validators.modified)
        headers["If-Modified-Since"] = validators.modified;
    }
    const response = await fetch(representationUrl, {
      headers,
      signal,
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3)
        throw new Error(
          "Feed exceeds three redirects or has no redirect target",
        );
      const next = new URL(location, representationUrl).href;
      if (validFeedEntry({ url: next, title: "" }))
        throw new Error("Feed redirect URL is invalid");
      representationUrl = next;
      continue;
    }
    return { response, representationUrl };
  }
  throw new Error("Feed redirect limit reached");
}

type FeedPosition = { lastFetchedAt?: number; importAfter?: number };
export function selectFeedItems(
  items: Array<Parser.Item & { author?: string }>,
  feed: FeedPosition,
  now: number,
) {
  // The body-byte limit bounds parsing. The item limit bounds imports, not
  // the publisher's archive: recent posts may appear anywhere in the XML.
  const datedItems = items.map((item) => ({
    item,
    publishedAt: item.pubDate ? Date.parse(item.pubDate) : undefined,
  }));
  const cutoff = Math.max(now - IMPORT_MAX_AGE_MS, feed.importAfter ?? 0);
  const dated = datedItems.filter(
    (i): i is typeof i & { publishedAt: number } =>
      Number.isFinite(i.publishedAt),
  );
  const recent = dated
    .filter((i) => i.publishedAt >= cutoff)
    .sort((a, b) => b.publishedAt - a.publishedAt);
  // Undated/invalid dates cannot establish recency. Keep only the first few
  // on EVERY poll, rather than pulling the whole archive on the second one.
  const undated = datedItems
    .filter((i) => !Number.isFinite(i.publishedAt))
    .slice(0, FIRST_POLL_POSTS);
  let candidates = [...recent, ...undated].slice(0, FEED_ITEMS);
  let importAfter = cutoff;
  if (feed.lastFetchedAt === undefined) {
    if (dated.length) {
      const initial = recent.slice(0, FIRST_POLL_POSTS);
      candidates = initial;
      importAfter = initial.at(-1)?.publishedAt ?? cutoff;
    } else {
      candidates = undated;
    }
  }
  const entries = candidates.flatMap(({ item, publishedAt }) => {
    const guid = item.guid || item.link || item.title || "";
    if (!guid) return [];
    const entry = {
      guid,
      url: item.link || "",
      title: item.title || "Untitled",
      author: item.creator || item.author,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
      excerpt: item.contentSnippet?.slice(0, 500),
      imageUrl: item.enclosure?.url,
    };
    if (utf8Bytes(entry) > 8 * 1024) throw new Error("Feed item exceeds 8 KiB");
    return [entry];
  });
  return { entries, importAfter };
}

export const pollClaimedFeed = internalAction({
  args: pollClaim,
  handler: async (ctx, claim) => {
    const feed = await ctx.runMutation(internal.feedPolling.takePayload, claim);
    if (!feed) return;
    const deadline = Date.now() + POLL_ACTION_MS;
    try {
      const remaining = feed.reservationUntil - Date.now();
      if (remaining <= 0) throw new Error("Feed network reservation expired");
      // A queued action may start late. Its network cannot outlive the durable
      // reservation even when fewer than ten seconds remain on that lease.
      const signal = AbortSignal.timeout(Math.min(FEED_NETWORK_MS, remaining));
      const { response, representationUrl } = await fetchFeed(
        feed.url,
        feed,
        signal,
        feed.reservationUntil,
      );
      if (response.status === 304) {
        await response.body?.cancel();
        await ctx.runMutation(internal.feedPolling.finish, {
          ...claim,
          unchanged: true,
          representationUrl,
        });
        return;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Feed returned ${response.status}`);
      }
      const xml = await readFeedBody(response, signal);
      const parsed = await new Parser().parseString(xml);
      const { entries, importAfter } = selectFeedItems(
        parsed.items ?? [],
        feed,
        Date.now(),
      );
      let batches = 0;
      for (let offset = 0; offset < entries.length; ) {
        if (Date.now() >= deadline)
          throw new Error("Feed check exceeded its commit deadline");
        const items: typeof entries = [];
        for (const entry of entries.slice(offset, offset + FEED_ITEM_BATCH)) {
          if (utf8Bytes([...items, entry]) > FEED_BATCH_BYTES) break;
          items.push(entry);
        }
        if (
          !(await ctx.runMutation(internal.feedPolling.commitItems, {
            ...claim,
            batch: batches,
            items,
          }))
        )
          return;
        batches++;
        offset += items.length;
      }
      await ctx.runMutation(internal.feedPolling.finish, {
        ...claim,
        batches,
        importAfter,
        etag: response.headers.get("etag") ?? undefined,
        modified: response.headers.get("last-modified") ?? undefined,
        representationUrl,
      });
    } catch (error) {
      // Store a bounded classification, not a private URL/provider response body.
      const message =
        error instanceof Error ? error.message : "Feed check failed";
      await ctx.runMutation(internal.feedPolling.finish, {
        ...claim,
        error: message,
      });
    } finally {
      await ctx.runMutation(internal.feedPolling.settle, claim);
    }
  },
});
