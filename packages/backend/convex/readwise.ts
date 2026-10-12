import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireArticle } from "./access";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./functions";
import { readwiseTokenFor } from "./lib/readwise";

async function settingsRow(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function patchSettings(
  ctx: MutationCtx,
  userId: string,
  patch: Partial<Doc<"userSettings">>,
) {
  const row = await settingsRow(ctx, userId);
  const next = { ...patch, updatedAt: Date.now() };
  if (row) await ctx.db.patch("userSettings", row._id, next);
  else await ctx.db.insert("userSettings", { ...next, userId });
}

export const status = query({
  args: {},
  handler: async (ctx) => {
    const row = await settingsRow(ctx, ctx.readerId);
    const sync = await ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .unique();
    const queue = await ctx.db
      .query("readingQueueStats")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .unique();
    return {
      connected: Boolean(readwiseTokenFor(ctx.readerId)),
      syncedAt: row?.readwiseSyncedAt ?? null,
      checkedAt: row?.readwiseCheckedAt ?? null,
      error: sync ? (sync.error ?? null) : (row?.readwiseError ?? null),
      progress: sync
        ? {
            active: sync.active,
            backfilling: !sync.backfilledAt,
            phase:
              ["Inbox", "Later", "Shortlist", "Highlights"][sync.phase] ??
              "Complete",
            scanned: sync.scanned,
            imported: sync.imported,
            linked: sync.linked,
            skipped: sync.skipped,
            highlights: sync.highlights,
          }
        : null,
      pendingAnnotations: queue?.ready ? queue.pending : null,
    };
  },
});

export const syncNow = action({
  args: {},
  handler: async (ctx) => {
    const userId = ctx.readerId;
    if (!readwiseTokenFor(userId)) throw new Error("Readwise isn't connected");
    await ctx.scheduler.runAfter(0, internal.readingQueue.initialize, {
      userId,
    });
    const state: { syncedAt: number | null; nextRunAt: number } =
      await ctx.runQuery(internal.readwise.getSyncState, { userId });
    await ctx.scheduler.runAfter(
      Math.max(0, state.nextRunAt - Date.now()),
      internal.actions.readwiseSync.sync,
      { userId },
    );
  },
});

export const getSyncState = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const row = await settingsRow(ctx, args.userId);
    const sync = await ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    return {
      syncedAt: row?.readwiseSyncedAt ?? null,
      nextRunAt: sync?.nextRunAt ?? 0,
    };
  },
});

export const recordSync = internalMutation({
  args: {
    userId: v.string(),
    syncedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await patchSettings(ctx, args.userId, {
      readwiseCheckedAt: Date.now(),
      readwiseError: args.error,
      ...(args.syncedAt ? { readwiseSyncedAt: args.syncedAt } : {}),
    });
  },
});

export const findArticle = internalQuery({
  args: {
    userId: v.string(),
    readerDocumentId: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const linked = await ctx.db
      .query("articles")
      .withIndex("by_userId_and_readerDocumentId", (q) =>
        q
          .eq("userId", args.userId)
          .eq("readerDocumentId", args.readerDocumentId),
      )
      .first();
    if (linked || !args.url) return linked;
    // Already in Marginalia from a feed or a pasted URL
    const url = args.url;
    return ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", args.userId).eq("guid", url),
      )
      .first();
  },
});

export const linkArticle = internalMutation({
  args: { articleId: v.id("articles"), readerDocumentId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("articles", args.articleId, {
      readerDocumentId: args.readerDocumentId,
    });
  },
});

export const getArticleReaderId = internalQuery({
  args: { articleId: v.id("articles"), userId: v.string() },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (article?.userId !== args.userId) return null;
    return article.readerDocumentId ?? null;
  },
});

/** Imports a Reader highlight unless it (or the same passage) is already marked. */
export const importHighlight = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    readerHighlightId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, args.userId);
    const byId = await ctx.db
      .query("highlights")
      .withIndex("by_userId_and_readerHighlightId", (q) =>
        q
          .eq("userId", args.userId)
          .eq("readerHighlightId", args.readerHighlightId),
      )
      .first();
    if (byId) return false;
    const normalized = args.text.replace(/\s+/g, " ").trim();
    const onArticle = await ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(500);
    // A highlight pushed from Marginalia comes back from Reader on the next
    // sync, possibly before its Reader id was stored
    if (
      onArticle.some((h) => h.text.replace(/\s+/g, " ").trim() === normalized)
    ) {
      return false;
    }
    const highlightId = await ctx.db.insert("highlights", {
      userId: args.userId,
      articleId: args.articleId,
      kind: "highlight",
      text: normalized,
      source: "reader",
      readerHighlightId: args.readerHighlightId,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.embedReaderActivity.embedHighlight,
      {
        highlightId,
      },
    );
    return true;
  },
});

export const setHighlightReaderId = internalMutation({
  args: { highlightId: v.id("highlights"), readerHighlightId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row) {
      await ctx.db.patch("highlights", args.highlightId, {
        readerHighlightId: args.readerHighlightId,
      });
    }
  },
});
