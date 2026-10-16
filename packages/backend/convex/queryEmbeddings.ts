import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  QUERY_EMBEDDING_CAP,
  QUERY_EMBEDDING_TTL_MS,
} from "./lib/queryEmbeddingCache";

// Expired rows are removed a few at a time, on the insert that finds them
const EVICT_BATCH = 64;

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
