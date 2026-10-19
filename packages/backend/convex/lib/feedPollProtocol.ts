import { defineTable } from "convex/server";
import { v } from "convex/values";

export const FEED_FETCH_SLOTS = 4;
export const FEED_LEASE_MS = 90_000;
export const FEED_RUN_MS = 15 * 60_000;
export const FEED_BODY_BYTES = 1_048_576;
export const FEED_ITEMS = 200;
// Existing URL/GUID alias reconciliation can read a near-1MiB article several
// times. Two entries leave room under Convex's transaction read-byte ceiling.
export const FEED_ITEM_BATCH = 2;
export const FEED_BATCH_BYTES = 64 * 1024;
export const OPML_BATCH_COUNT = 10;
export const OPML_BATCH_BYTES = 32 * 1024;

export const pollClaim = {
  stateId: v.id("feedPollStates"),
  generation: v.number(),
};
const slot = v.object({ ...pollClaim, leaseUntil: v.number() });

// Main wires this additive schema into schema.ts. One row/library, one row/feed,
// and one global four-slot row; no history or unbounded payload is retained.
export const feedPollTables = {
  feedPollRuns: defineTable({
    userId: v.string(),
    run: v.number(),
    active: v.boolean(),
    cursor: v.optional(v.string()),
    scanned: v.number(),
    exhausted: v.boolean(),
    deadline: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_active", ["active"]),
  feedPollStates: defineTable({
    userId: v.string(),
    feedId: v.id("feeds"),
    url: v.string(),
    run: v.number(),
    generation: v.number(),
    attempts: v.number(),
    nextBatch: v.number(),
    started: v.boolean(),
    leaseUntil: v.optional(v.number()),
    etag: v.optional(v.string()),
    modified: v.optional(v.string()),
    representationUrl: v.optional(v.string()),
  })
    .index("by_feedId", ["feedId"])
    .index("by_userId", ["userId"]),
  feedPollPool: defineTable({
    key: v.literal("global"),
    slots: v.array(slot),
  }).index("by_key", ["key"]),
};

export const feedEntry = v.object({
  url: v.string(),
  title: v.string(),
  siteUrl: v.optional(v.string()),
  description: v.optional(v.string()),
});

export function utf8Bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function validFeedEntry(entry: typeof feedEntry.type): string | null {
  if (utf8Bytes(entry) > 8 * 1024) return "Feed details exceed 8 KiB";
  if (entry.url.length > 4096 || entry.title.length > 2048)
    return "Feed URL or title is too long";
  try {
    const url = new URL(entry.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "Feed URL must be HTTP or HTTPS without credentials";
  } catch {
    return "Feed URL must be HTTP or HTTPS";
  }
  return null;
}

// URL serialization normalizes host casing/default ports without changing a
// path, query or trailing slash that may select a different representation.
export function feedUrl(url: string) {
  const parsed = new URL(url.trim());
  parsed.hash = "";
  return parsed.href;
}
