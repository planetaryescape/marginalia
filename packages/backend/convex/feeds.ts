import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import {
  articleUse,
  deleteArticle,
  feedArticlesChoice,
  removes,
} from "./lib/feedRemoval";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
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
        q.eq("userId", ctx.readerId).eq("url", args.url),
      )
      .first();

    if (existing) {
      throw new Error("Feed already exists");
    }

    return ctx.db.insert("feeds", {
      userId: ctx.readerId,
      url: args.url,
      title: args.title,
      siteUrl: args.siteUrl,
      description: args.description,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

// Bounds the work behind one dialog; a feed polls at most a few posts at a time
const PREVIEW_LIMIT = 300;
const REMOVAL_PAGE = 20;
// Reader allows 20 deletes a minute per token
const READER_DELETE_SPACING_MS = 3_500;

/** How many of a feed's articles each removal choice would delete. */
export const removalPreview = query({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (feed?.userId !== ctx.readerId) return null;
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      .take(PREVIEW_LIMIT + 1);
    const counted = articles
      .slice(0, PREVIEW_LIMIT)
      .filter((a) => a.userId === ctx.readerId);
    const uses = await Promise.all(counted.map((a) => articleUse(ctx, a)));
    const removed = (choice: "unread" | "all") =>
      counted.filter((_, i) => removes(choice, uses[i]));
    const unread = removed("unread");
    const all = removed("all");
    const inReader = (rows: typeof counted) =>
      rows.filter((a) => a.readerDocumentId).length;
    return {
      total: counted.length,
      unread: unread.length,
      unreadInReader: inReader(unread),
      all: all.length,
      allInReader: inReader(all),
      partial: articles.length > PREVIEW_LIMIT,
    };
  },
});

export const remove = mutation({
  args: {
    feedId: v.id("feeds"),
    // Optional so a page loaded before this release keeps its old behaviour
    articles: v.optional(feedArticlesChoice),
  },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (feed?.userId !== ctx.readerId) throw new Error("Feed not found");
    await ctx.db.delete(args.feedId);
    const choice = args.articles ?? "keep";
    if (choice !== "keep")
      await ctx.scheduler.runAfter(0, internal.feeds.removeArticles, {
        userId: ctx.readerId,
        feedId: args.feedId,
        choice,
      });
  },
});

export const toggleActive = mutation({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (feed?.userId !== ctx.readerId) throw new Error("Feed not found");
    await ctx.db.patch(args.feedId, { isActive: !feed.isActive });
  },
});

// --- Internal ---

export const listActive = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const feeds = await ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return feeds.filter((f) => f.isActive);
  },
});

/** Deletes an unsubscribed feed's articles a page at a time, per the reader's choice. */
export const removeArticles = internalMutation({
  args: {
    userId: v.string(),
    feedId: v.id("feeds"),
    choice: feedArticlesChoice,
    cursor: v.optional(v.string()),
    // Reader deletes scheduled so far, to keep spacing them across pages
    readerDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let readerDeletes = args.readerDeletes ?? 0;
    const page = await ctx.db
      .query("articles")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      .paginate({ cursor: args.cursor ?? null, numItems: REMOVAL_PAGE });
    for (const article of page.page) {
      if (article.userId !== args.userId) continue;
      if (!removes(args.choice, await articleUse(ctx, article))) continue;
      await deleteArticle(ctx, article);
      if (article.readerDocumentId)
        await ctx.scheduler.runAfter(
          readerDeletes++ * READER_DELETE_SPACING_MS,
          internal.actions.readwiseSync.deleteReaderDocument,
          { userId: args.userId, readerDocumentId: article.readerDocumentId },
        );
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.feeds.removeArticles, {
        ...args,
        cursor: page.continueCursor,
        readerDeletes,
      });
  },
});

export const updateLastFetched = internalMutation({
  args: { feedId: v.id("feeds"), importAfter: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedId, {
      lastFetchedAt: Date.now(),
      lastError: undefined,
      importAfter: args.importAfter,
    });
  },
});

export const pollNow = action({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.actions.pollFeeds.pollAllFeeds, {
      userId: ctx.readerId,
    });
  },
});

export const updateError = internalMutation({
  args: { feedId: v.id("feeds"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedId, { lastError: args.error });
  },
});
