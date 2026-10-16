import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";

/**
 * The cheap gate of reading alongside (D-DES-046): a handful of numbers read
 * from indexes that move when the material the margin draws on moves. Equal
 * fingerprints mean no retrieval and no model call.
 */
export const marginaliaFingerprint = v.object({
  notesMax: v.number(),
  threadsMax: v.number(),
  highlightsMax: v.number(),
  // Highlights carry no edit time, so a count catches deletions that a
  // maximum can't see
  highlightsCount: v.number(),
  vaultIndexedMax: v.number(),
  // When it was taken
  passAt: v.number(),
});

export type MarginaliaFingerprint = typeof marginaliaFingerprint.type;

// Convex can't count without reading rows, and a highlight row carries a
// 1,536-float embedding (about 12 KB), so the count stops here to stay far
// inside the 16 MiB read limit. Past it, additions still move the maximum and
// only a lone deletion goes unseen, which adds no material to read anyway.
const COUNT_CAP = 250;

export async function computeFingerprint(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  now = Date.now(),
): Promise<MarginaliaFingerprint> {
  const [note, thread, chunk, highlights] = await Promise.all([
    ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", userId))
      .order("desc")
      .first(),
    ctx.db
      .query("companionThreads")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first(),
    ctx.db
      .query("noteChunks")
      .withIndex("by_user_indexedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first(),
    ctx.db
      .query("highlights")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(COUNT_CAP),
  ]);
  return {
    notesMax: note?.updatedAt ?? 0,
    threadsMax: thread?.updatedAt ?? 0,
    highlightsMax: highlights[0]?._creationTime ?? 0,
    highlightsCount: highlights.length,
    vaultIndexedMax: chunk?.indexedAt ?? 0,
    passAt: now,
  };
}

/** Whether nothing the margin draws on has moved. `passAt` is when it was taken, not a signal. */
export function sameFingerprint(
  a: MarginaliaFingerprint,
  b: MarginaliaFingerprint,
): boolean {
  return (
    a.notesMax === b.notesMax &&
    a.threadsMax === b.threadsMax &&
    a.highlightsMax === b.highlightsMax &&
    a.highlightsCount === b.highlightsCount &&
    a.vaultIndexedMax === b.vaultIndexedMax
  );
}

/** The precise gate's key: the same set of stored items hashes the same. */
export async function hashSources(sources: readonly string[]): Promise<string> {
  const text = [...new Set(sources)].sort().join("\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
