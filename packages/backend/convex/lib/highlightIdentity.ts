import { getDocumentSize } from "convex/values";
import type { Trigger } from "convex-helpers/server/triggers";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";
import { sha256Hex } from "./tokens";

export function normalizeHighlightText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** Register on highlights in the existing wrapped writer boundary, using innerDb.
 * No source writes: in particular, colours/baselines and embeddings are untouched. */
export async function syncHighlightIdentity(
  ctx: MutationCtx,
  before: Doc<"highlights"> | null,
  after: Doc<"highlights"> | null,
) {
  if (
    before &&
    after &&
    before.userId === after.userId &&
    before.articleId === after.articleId &&
    before.text === after.text
  )
    return;
  const source = after ?? before;
  if (!source) return;
  const old = await ctx.db
    .query("highlightIdentities")
    .withIndex("by_highlightId", (q) => q.eq("highlightId", source._id))
    .unique();
  if (!after || !(await metadataLibraryRetained(ctx, after.userId))) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  const normalizedText = normalizeHighlightText(after.text);
  // The digest only selects candidates. Equality below always reads and compares
  // the complete source; the index itself never duplicates giant legacy text.
  const fields = {
    userId: after.userId,
    articleId: after.articleId,
    highlightId: after._id,
    textHash: await sha256Hex(normalizedText),
  };
  if (old) await ctx.db.replace(old._id, fields);
  else await ctx.db.insert("highlightIdentities", fields);
}

export const highlightIdentityTrigger: Trigger<
  MutationCtx,
  DataModel,
  "highlights"
> = (ctx, change) =>
  syncHighlightIdentity(
    { ...ctx, db: ctx.innerDb },
    change.oldDoc,
    change.newDoc,
  );

/** Readiness belongs to the current article owner, not the lifetime of its ID.
 * Invalidate it atomically with transfer/delete; retained child marks remain
 * private to their original owners and are not rewritten or relabelled. */
export const highlightArticleIdentityTrigger: Trigger<
  MutationCtx,
  DataModel,
  "articles"
> = async (ctx, change) => {
  const before = change.oldDoc;
  if (!before || change.newDoc?.userId === before.userId) return;
  const state = await highlightIdentityState({ db: ctx.innerDb }, before._id);
  if (state) await ctx.innerDb.delete(state._id);
};

export function highlightIdentityState(
  ctx: Pick<QueryCtx, "db">,
  articleId: Id<"articles">,
) {
  return ctx.db
    .query("highlightIdentityState")
    .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
    .unique();
}

export async function hasHighlightText(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  articleId: Id<"articles">,
  normalizedText: string,
) {
  const hash = await sha256Hex(normalizedText);
  const bucket = await ctx.db
    .query("highlightIdentities")
    .withIndex("by_userId_and_articleId_and_textHash", (q) =>
      q.eq("userId", userId).eq("articleId", articleId).eq("textHash", hash),
    )
    .paginate({
      cursor: null,
      numItems: 32,
      maximumBytesRead: 2 * 1024 * 1024,
    });
  let sourceBytes = 0;
  for (const identity of bucket.page) {
    // Reserve a full maximum-sized source before reading it. Pathological hash
    // collisions stop safely within 2 MiB, never insert after a truncated scan.
    if (sourceBytes + 1024 * 1024 > 2 * 1024 * 1024)
      throw new Error("Highlight identity sources exceed budget");
    const source = await ctx.db.get("highlights", identity.highlightId);
    sourceBytes += source ? getDocumentSize(source) : 0;
    if (
      source?.userId === userId &&
      source.articleId === articleId &&
      normalizeHighlightText(source.text) === normalizedText
    )
      return true;
  }
  // A hash is only a lookup accelerator, never equality. A pathological bucket
  // must stop safely rather than truncate candidates and insert a duplicate.
  if (!bucket.isDone)
    throw new Error("Highlight identity bucket exceeds budget");
  return false;
}

/** Account purge: call until zero, in fresh transactions, before advancing the
 * existing metadata cleanup step. No numeric changes or retained-data purge. */
export async function purgeHighlightIdentities(
  ctx: MutationCtx,
  userId: string,
) {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge identities from a retained library");
  // Only Convex IDs, a server-issued library ID and a 64-hex digest live here;
  // source passages/vectors are never copied. These compact take batches leave
  // the account step's single paginate available to vault cleanup, even empty.
  const rows = await ctx.db
    .query("highlightIdentities")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(32);
  for (const row of rows) await ctx.db.delete(row._id);
  if (rows.length) return rows.length;
  // State adds only the server cursor over the fixed-size source identity key.
  // Physical fixture: both batches stay below 128 KiB despite 990 KB sources.
  const states = await ctx.db
    .query("highlightIdentityState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(64);
  for (const row of states) await ctx.db.delete(row._id);
  return states.length;
}
