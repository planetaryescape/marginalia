import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ownedArticle, requireArticle } from "./access";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { colorFitsKind, markColor } from "./lib/markColours";
import { assertBytes, markPresentation } from "./lib/readerBodies";

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
        color: row.color,
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

export const listPresentationByArticle = query({
  args: {
    articleId: v.id("articles"),
    unitIndex: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId)))
      return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("highlights")
      .withIndex("by_article_and_unitIndex", (q) =>
        q.eq("articleId", args.articleId).eq("unitIndex", args.unitIndex),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(50, args.paginationOpts.numItems)),
        maximumBytesRead: 2_000_000,
      });
    return {
      ...page,
      page: page.page
        .filter((row) => row.userId === ctx.readerId)
        .map(markPresentation),
    };
  },
});

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    // Left out, the mark follows the reader's current highlighter or pen setting
    color: v.optional(markColor),
    text: v.string(),
    paragraphIndex: v.optional(v.number()),
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    assertBytes(args.text, 32_000, "Marked passage");
    if (args.color && !colorFitsKind(args.kind, args.color))
      throw new Error("That colour is not for this kind of mark");
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

export const setColor = mutation({
  args: { highlightId: v.id("highlights"), color: markColor },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row?.userId !== ctx.readerId) throw new Error("Highlight not found");
    if (!colorFitsKind(row.kind, args.color))
      throw new Error("That colour is not for this kind of mark");
    await ctx.db.patch("highlights", args.highlightId, { color: args.color });
  },
});

// Highlight rows carry an embedding, so a page stays small
const STAMP_BATCH = 100;

/**
 * Before the reader's default colour for a tool changes, gives every mark of
 * that kind without a stored colour the colour it shows now. Marks saved
 * before colours were stored follow the default, so without this, changing
 * the default would repaint them.
 */
export const stampUncoloured = mutation({
  args: {
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    color: markColor,
  },
  handler: async (ctx, args) => {
    if (!colorFitsKind(args.kind, args.color))
      throw new Error("That colour is not for this kind of mark");
    await stampPage(ctx, ctx.readerId, args.kind, args.color, null);
  },
});

export const stampUncolouredPage = internalMutation({
  args: {
    userId: v.string(),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    color: markColor,
    cursor: v.string(),
  },
  handler: (ctx, args) =>
    stampPage(ctx, args.userId, args.kind, args.color, args.cursor),
});

async function stampPage(
  ctx: MutationCtx,
  userId: string,
  kind: "highlight" | "underline",
  color: Doc<"highlights">["color"] & string,
  cursor: string | null,
) {
  const page = await ctx.db
    .query("highlights")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .paginate({ numItems: STAMP_BATCH, cursor });
  for (const row of page.page)
    if (row.kind === kind && row.color === undefined)
      await ctx.db.patch("highlights", row._id, { color });
  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.highlights.stampUncolouredPage, {
      userId,
      kind,
      color,
      cursor: page.continueCursor,
    });
}

/**
 * Repair: clears a stored colour so the mark follows the reader's default
 * again. Used once on 2026-10-16 to undo marks stamped from a test browser
 * whose default was not the reader's own.
 */
export const clearStoredColour = internalMutation({
  args: { userId: v.string(), ids: v.array(v.id("highlights")) },
  handler: async (ctx, args) => {
    let cleared = 0;
    for (const id of args.ids.slice(0, 200)) {
      const row = await ctx.db.get("highlights", id);
      if (row?.userId !== args.userId || row.color === undefined) continue;
      await ctx.db.patch("highlights", id, { color: undefined });
      cleared++;
    }
    return cleared;
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
    if (row) {
      await ctx.db.patch("highlights", args.highlightId, {
        embedding: args.embedding,
        embeddedAt: Date.now(),
      });
    }
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
