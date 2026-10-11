import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

export const create = mutation({
  args: { requestedMinutes: v.number() },
  handler: async (ctx, args) => {
    return ctx.db.insert("sessions", {
      userId: DEFAULT_USER_ID,
      requestedMinutes: args.requestedMinutes,
      startedAt: Date.now(),
      readingStatus: "selecting",
    });
  },
});

export const getById = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.sessionId);
  },
});

export const updateStatus = mutation({
  args: {
    sessionId: v.id("sessions"),
    readingStatus: v.union(
      v.literal("selecting"),
      v.literal("reading"),
      v.literal("reflecting"),
      v.literal("completed"),
      v.literal("abandoned"),
    ),
    articleId: v.optional(v.id("articles")),
    scrollPercentage: v.optional(v.number()),
    annotationsViewed: v.optional(v.number()),
    timeSpentMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { sessionId, ...updates } = args;
    const patch: any = { ...updates };
    if (
      updates.readingStatus === "completed" ||
      updates.readingStatus === "abandoned"
    ) {
      patch.endedAt = Date.now();
    }
    await ctx.db.patch(sessionId, patch);
  },
});

export const recordInteraction = mutation({
  args: {
    articleId: v.id("articles"),
    sessionId: v.optional(v.id("sessions")),
    action: v.union(
      v.literal("presented"),
      v.literal("opened"),
      v.literal("finished"),
      v.literal("abandoned"),
      v.literal("skipped"),
      v.literal("saved"),
    ),
    scrollPercentage: v.optional(v.number()),
    timeSpentMs: v.optional(v.number()),
    activeTimeMs: v.optional(v.number()),
    maxScrollPercent: v.optional(v.number()),
    annotationsOpened: v.optional(v.array(v.string())),
    totalScrollEvents: v.optional(v.number()),
    tabHiddenCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("articleInteractions", {
      userId: DEFAULT_USER_ID,
      articleId: args.articleId,
      sessionId: args.sessionId,
      action: args.action,
      scrollPercentage: args.scrollPercentage,
      timeSpentMs: args.timeSpentMs,
      activeTimeMs: args.activeTimeMs,
      maxScrollPercent: args.maxScrollPercent,
      annotationsOpened: args.annotationsOpened,
      totalScrollEvents: args.totalScrollEvents,
      tabHiddenCount: args.tabHiddenCount,
      createdAt: Date.now(),
    });
    // Finishing an article that came from Readwise Reader archives it there
    if (args.action === "finished") {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.readwiseSync.archiveArticle,
        {
          articleId: args.articleId,
        },
      );
    }
  },
});

// Get the most recent article the user opened but didn't finish
export const getInProgress = query({
  args: {},
  handler: async (ctx) => {
    // Get recent interactions, newest first
    const interactions = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(200);

    // Find articles that were opened but never finished
    const openedArticles = new Map<
      string,
      { maxScroll: number; activeTime: number }
    >();
    const finishedArticles = new Set<string>();

    for (const i of interactions) {
      if (i.action === "finished") {
        finishedArticles.add(i.articleId);
      }
      if (i.action === "opened" || i.action === "abandoned") {
        if (
          !finishedArticles.has(i.articleId) &&
          !openedArticles.has(i.articleId)
        ) {
          openedArticles.set(i.articleId, {
            maxScroll: i.maxScrollPercent ?? i.scrollPercentage ?? 0,
            activeTime: i.activeTimeMs ?? i.timeSpentMs ?? 0,
          });
        }
      }
    }

    // Find the most recent unfinished article with scroll < 90%
    for (const [articleId, data] of openedArticles) {
      if (data.maxScroll >= 90) continue;

      const article = await ctx.db
        .query("articles")
        .filter((q) => q.eq(q.field("_id"), articleId as any))
        .first();
      if (!article) continue;

      const remainingMin = article.estimatedReadMinutes
        ? Math.max(
            1,
            Math.round(
              article.estimatedReadMinutes * (1 - data.maxScroll / 100),
            ),
          )
        : null;

      return {
        article,
        scrollPercent: data.maxScroll,
        remainingMinutes: remainingMin,
      };
    }

    return null;
  },
});

// Used by selectArticle action
export const listRecentInteractions = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .take(200);
  },
});
