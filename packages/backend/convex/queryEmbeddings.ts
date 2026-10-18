import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";
import {
  QUERY_EMBEDDING_CAP,
  QUERY_EMBEDDING_TTL_MS,
} from "./lib/queryEmbeddingCache";

// Expired rows are removed a few at a time, on the insert that finds them
const EVICT_BATCH = 64;

/** Read in the publishing transaction, so deletion also fences an in-flight embed. */
async function cacheLibraryIsActive(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
) {
  if (userId === DEFAULT_USER_ID) return true;
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
    .unique();
  return reader?.status === "active" && reader.deletingAt === undefined;
}

/** Publish before find returns; expiration/overflow work stays in a durable job. */
export const publish = internalMutation({
  args: {
    userId: v.string(),
    key: v.string(),
    model: v.string(),
    embedding: v.array(v.float64()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await cacheLibraryIsActive(ctx, args.userId))) return;
    const row = await ctx.db
      .query("queryEmbeddings")
      .withIndex("by_userId_and_key", (q) =>
        q.eq("userId", args.userId).eq("key", args.key),
      )
      .first();
    if (row) {
      if (row.createdAt <= args.now)
        await ctx.db.patch(row._id, {
          embedding: args.embedding,
          model: args.model,
          createdAt: args.now,
        });
    } else {
      await ctx.db.insert("queryEmbeddings", {
        userId: args.userId,
        key: args.key,
        model: args.model,
        embedding: args.embedding,
        createdAt: args.now,
      });
      const counter = await ctx.db
        .query("queryEmbeddingCounts")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .unique();
      if (counter)
        await ctx.db.patch(counter._id, { count: counter.count + 1 });
      else
        await ctx.db.insert("queryEmbeddingCounts", {
          userId: args.userId,
          count: 1,
        });
    }
    await ctx.scheduler.runAfter(0, internal.queryEmbeddings.cleanup, {
      userId: args.userId,
      now: args.now,
    });
  },
});

/** Housekeeping never republishes a historical vector over a newer model. */
export const cleanup = internalMutation({
  args: { userId: v.string(), now: v.number() },
  handler: async (ctx, { userId, now }) => {
    if (!(await cacheLibraryIsActive(ctx, userId))) return;
    const counter = await ctx.db
      .query("queryEmbeddingCounts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!counter) return;
    const expired = await ctx.db
      .query("queryEmbeddings")
      .withIndex("by_userId_and_createdAt", (q) =>
        q.eq("userId", userId).lt("createdAt", now - QUERY_EMBEDDING_TTL_MS),
      )
      .take(EVICT_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    let count = counter.count - expired.length;
    const overflow = Math.max(0, count - QUERY_EMBEDDING_CAP);
    if (overflow) {
      const oldest = await ctx.db
        .query("queryEmbeddings")
        .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
        .take(Math.min(EVICT_BATCH, overflow));
      for (const row of oldest) await ctx.db.delete(row._id);
      count -= oldest.length;
    }
    await ctx.db.patch(counter._id, { count });
    if (expired.length === EVICT_BATCH || count > QUERY_EMBEDDING_CAP)
      await ctx.scheduler.runAfter(0, internal.queryEmbeddings.cleanup, {
        userId,
        now,
      });
  },
});

/** The cached vector for a reader's query, or null on a miss, stale model or expiry. */
export const lookup = internalQuery({
  args: {
    userId: v.string(),
    key: v.string(),
    model: v.string(),
    now: v.number(),
  },
  returns: v.union(v.null(), v.array(v.float64())),
  handler: async (ctx, { userId, key, model, now }) => {
    const row = await ctx.db
      .query("queryEmbeddings")
      .withIndex("by_userId_and_key", (q) =>
        q.eq("userId", userId).eq("key", key),
      )
      .first();
    if (!row || row.model !== model) return null;
    if (row.createdAt <= now - QUERY_EMBEDDING_TTL_MS) return null;
    return row.embedding;
  },
});

/**
 * Stores a vector for a reader's query, then trims the reader's cache: expired
 * rows first, then the oldest rows beyond the cap. The count row is what makes
 * the cap cheap to check.
 */
export const store = internalMutation({
  args: {
    userId: v.string(),
    key: v.string(),
    model: v.string(),
    embedding: v.array(v.float64()),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, key, model, embedding, now }) => {
    if (!(await cacheLibraryIsActive(ctx, userId))) return null;
    const existing = await ctx.db
      .query("queryEmbeddings")
      .withIndex("by_userId_and_key", (q) =>
        q.eq("userId", userId).eq("key", key),
      )
      .first();
    const counter = await ctx.db
      .query("queryEmbeddingCounts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    let count = counter?.count ?? 0;

    if (existing) {
      if (existing.createdAt <= now)
        await ctx.db.patch(existing._id, { embedding, model, createdAt: now });
    } else {
      await ctx.db.insert("queryEmbeddings", {
        userId,
        key,
        embedding,
        model,
        createdAt: now,
      });
      count += 1;
    }

    const expired = await ctx.db
      .query("queryEmbeddings")
      .withIndex("by_userId_and_createdAt", (q) =>
        q.eq("userId", userId).lt("createdAt", now - QUERY_EMBEDDING_TTL_MS),
      )
      .take(EVICT_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    count -= expired.length;

    const overflow = count - QUERY_EMBEDDING_CAP;
    if (overflow > 0) {
      const oldest = await ctx.db
        .query("queryEmbeddings")
        .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
        .order("asc")
        .take(overflow);
      for (const row of oldest) await ctx.db.delete(row._id);
      count -= oldest.length;
    }

    if (counter) await ctx.db.patch(counter._id, { count });
    else await ctx.db.insert("queryEmbeddingCounts", { userId, count });
    return null;
  },
});
