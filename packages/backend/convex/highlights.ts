import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { ownedArticle, requireArticle } from "./access";
import { internalMutation, internalQuery, mutation, query } from "./functions";

export const listByArticle = query({
  args: {
    articleId: v.id("articles"),
    // For a book: only the marks in this part
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return [];
    const unitIndex = args.unitIndex;
    // The part is part of the index, so the cap applies within it
    return unitIndex === undefined
      ? ctx.db
          .query("highlights")
          .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
          .take(500)
      : ctx.db
          .query("highlights")
          .withIndex("by_article_and_unitIndex", (q) =>
            q.eq("articleId", args.articleId).eq("unitIndex", unitIndex),
          )
          .take(500);
  },
});

/**
 * The reader's marks across every article, newest inserted first (index order), one page at a time.
 * Each row carries a 1536-number embedding, so the projection below is what
 * keeps the vector off the wire, though each read still loads the whole document, so keep pages at 50 or fewer.
 */
const MAX_PAGE = 50;

export const listMine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("highlights")
      .withIndex("by_userId", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      // Each document is read whole, embedding and all, so the server caps the page
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, MAX_PAGE),
      });
    return {
      ...page,
      page: page.page.map((row) => ({
        _id: row._id,
        articleId: row.articleId,
        kind: row.kind,
        text: row.text,
        paragraphIndex: row.paragraphIndex,
        unitIndex: row.unitIndex,
        createdAt: row.createdAt,
      })),
    };
  },
});

export const listByArticleInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) =>
    ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(500),
});

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    text: v.string(),
    paragraphIndex: v.optional(v.number()),
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    const highlightId = await ctx.db.insert("highlights", {
      ...args,
      userId: ctx.readerId,
      source: "marginalia",
      createdAt: Date.now(),
    });
    // Mirrors the mark to Readwise Reader when the article came from there
    await ctx.scheduler.runAfter(
      0,
      internal.actions.readwiseSync.pushHighlight,
      {
        highlightId,
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.actions.embedReaderActivity.embedHighlight,
      {
        highlightId,
      },
    );
    return highlightId;
  },
});

export const remove = mutation({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row?.userId !== ctx.readerId) throw new Error("Highlight not found");
    await ctx.db.delete("highlights", args.highlightId);
    // Only marks that started in Marginalia are removed from Reader; deleting an
    // imported Reader highlight here never deletes it there
    if (row.readerHighlightId && row.source !== "reader") {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.readwiseSync.deleteHighlight,
        {
          userId: row.userId,
          readerHighlightId: row.readerHighlightId,
        },
      );
    }
  },
});

export const getByIdInternal = internalQuery({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args) => ctx.db.get("highlights", args.highlightId),
});

export const setEmbedding = internalMutation({
  args: { highlightId: v.id("highlights"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row)
      await ctx.db.patch("highlights", args.highlightId, {
        embedding: args.embedding,
      });
  },
});

/** One library's rows still without an embedding, from its 500 oldest. */
export const listUnembedded = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("highlights")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(500);
    return rows.filter((r) => !r.embedding).map((r) => r._id);
  },
});
