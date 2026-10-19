import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { readLegacyDocument } from "./articleMetadata";
import { fingerprintState } from "./fingerprintMetadata";

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
  // Newest embedding set or cleared on a note, highlight, thread or library
  // article. An embedding lands after its row, and a library article carries
  // no edit time, so neither would move a timestamp above.
  embeddedMax: v.optional(v.number()),
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
  if ((await fingerprintState(ctx, userId))?.phase !== "done")
    return computeLegacyFingerprint(ctx, userId, now);
  const newest = (kind: "userNotes" | "companionThreads") =>
    ctx.db
      .query("marginaliaSourceStamps")
      .withIndex("by_userId_and_kind_and_updatedAt", (q) =>
        q.eq("userId", userId).eq("kind", kind),
      )
      .order("desc")
      .first();
  const [note, thread, chunk, highlights, embedded] = await Promise.all([
    newest("userNotes"),
    newest("companionThreads"),
    ctx.db
      .query("marginaliaSourceStamps")
      .withIndex("by_userId_and_kind_and_indexedAt", (q) =>
        q.eq("userId", userId).eq("kind", "noteChunks"),
      )
      .order("desc")
      .first(),
    ctx.db
      .query("marginaliaSourceStamps")
      .withIndex("by_userId_and_kind_and_sourceCreationTime", (q) =>
        q.eq("userId", userId).eq("kind", "highlights"),
      )
      .order("desc")
      .take(COUNT_CAP),
    Promise.all(
      (
        ["userNotes", "highlights", "companionThreads", "articles"] as const
      ).map(
        async (kind) =>
          (
            await ctx.db
              .query("marginaliaSourceStamps")
              .withIndex("by_userId_and_kind_and_embeddedAt", (q) =>
                q.eq("userId", userId).eq("kind", kind),
              )
              .order("desc")
              .first()
          )?.embeddedAt ?? 0,
      ),
    ),
  ]);
  return {
    notesMax: note?.updatedAt ?? 0,
    threadsMax: thread?.updatedAt ?? 0,
    highlightsMax: highlights[0]?.sourceCreationTime ?? 0,
    highlightsCount: highlights.length,
    vaultIndexedMax: chunk?.indexedAt ?? 0,
    embeddedMax: Math.max(...embedded),
    passAt: now,
  };
}

/** Mixed-version compatibility: never expose a partial metadata baseline.
 * Legacy source reads share the existing cumulative 10 MiB body budget and
 * reserve one whole document before each read. Oversize libraries fail closed
 * until explicit migration, rather than guessing an unchanged/paid decision. */
export async function computeLegacyFingerprint(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  now = Date.now(),
): Promise<MarginaliaFingerprint> {
  // Each table's newest embedding stamp, read from its own index so
  // independent writes never touch a shared row. (The library-article read
  // returns one whole article row, about 900 KB at worst; no lighter source
  // carries the stamp.)
  const newestEmbedded = async (
    table: "userNotes" | "highlights" | "companionThreads" | "articles",
  ) =>
    (
      await readLegacyDocument(ctx, () =>
        ctx.db
          .query(table)
          .withIndex("by_user_embeddedAt", (q) => q.eq("userId", userId))
          .order("desc")
          .first(),
      )
    )?.embeddedAt ?? 0;
  // Legacy body reads already share a serial byte-reservation queue. Await
  // each one before starting another so a failed budget cannot leave queued
  // database reads running after this query returns its error.
  const note = await readLegacyDocument(ctx, () =>
    ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", userId))
      .order("desc")
      .first(),
  );
  const thread = await readLegacyDocument(ctx, () =>
    ctx.db
      .query("companionThreads")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first(),
  );
  const chunk = await readLegacyDocument(ctx, () =>
    ctx.db
      .query("noteChunks")
      .withIndex("by_user_indexedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first(),
  );
  const highlights = [];
  const iterator = ctx.db
    .query("highlights")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    [Symbol.asyncIterator]();
  while (highlights.length < COUNT_CAP) {
    const row = await readLegacyDocument(ctx, async () => {
      const next = await iterator.next();
      return next.done ? null : next.value;
    });
    if (!row) break;
    highlights.push(row);
  }
  const embedded: number[] = [];
  for (const table of [
    "userNotes",
    "highlights",
    "companionThreads",
    "articles",
  ] as const)
    embedded.push(await newestEmbedded(table));
  return {
    notesMax: note?.updatedAt ?? 0,
    threadsMax: thread?.updatedAt ?? 0,
    highlightsMax: highlights[0]?._creationTime ?? 0,
    highlightsCount: highlights.length,
    vaultIndexedMax: chunk?.indexedAt ?? 0,
    embeddedMax: Math.max(...embedded),
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
    a.vaultIndexedMax === b.vaultIndexedMax &&
    (a.embeddedMax ?? 0) === (b.embeddedMax ?? 0)
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
