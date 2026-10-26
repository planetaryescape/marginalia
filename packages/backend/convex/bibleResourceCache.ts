import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";

export const get = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("bibleResourceCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row && row.expiresAt > Date.now() ? row.body : null;
  },
});
export const put = internalMutation({
  args: { key: v.string(), body: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    if (
      args.key.length > 300 ||
      new TextEncoder().encode(args.body).byteLength > 750_000 ||
      args.expiresAt <= Date.now() ||
      args.expiresAt > Date.now() + 30 * 86400_000
    )
      return;
    const row = await ctx.db
      .query("bibleResourceCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (row) await ctx.db.replace(row._id, args);
    else await ctx.db.insert("bibleResourceCache", args);
  },
});
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("bibleResourceCache")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now()))
      .take(10);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 10)
      await ctx.scheduler.runAfter(0, internal.bibleResourceCache.prune, {});
  },
});
