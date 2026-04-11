import { internalMutation, internalQuery, mutation, query, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { DEFAULT_USER_ID } from "./lib/constants";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .collect();
  },
});

export const add = mutation({
  args: {
    url: v.string(),
    title: v.string(),
    siteUrl: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for duplicate
    const existing = await ctx.db
      .query("feeds")
      .withIndex("by_user_url", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("url", args.url),
      )
      .first();

    if (existing) {
      throw new Error("Feed already exists");
    }

    return ctx.db.insert("feeds", {
      userId: DEFAULT_USER_ID,
      url: args.url,
      title: args.title,
      siteUrl: args.siteUrl,
      description: args.description,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.feedId);
  },
});

export const toggleActive = mutation({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (!feed) throw new Error("Feed not found");
    await ctx.db.patch(args.feedId, { isActive: !feed.isActive });
  },
});

// --- Internal ---

export const listActive = internalQuery({
  args: {},
  handler: async (ctx) => {
    const feeds = await ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .collect();
    return feeds.filter((f) => f.isActive);
  },
});

export const updateLastFetched = internalMutation({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedId, {
      lastFetchedAt: Date.now(),
      lastError: undefined,
    });
  },
});

export const pollNow = action({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.actions.pollFeeds.pollAllFeeds, {});
  },
});

export const updateError = internalMutation({
  args: { feedId: v.id("feeds"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedId, { lastError: args.error });
  },
});
