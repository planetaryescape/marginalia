import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ownedArticle, requireArticle } from "./access";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  query,
} from "./functions";
import { updateQueueStats } from "./readingQueue";

export const getById = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ownedArticle(ctx, args.articleId, ctx.readerId);
  },
});

export const listByFeed = query({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get("feeds", args.feedId);
    if (feed?.userId !== ctx.readerId) return [];
    return ctx.db
      .query("articles")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      .order("desc")
      .take(50);
  },
});

export const listAnnotated = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("articles")
      .withIndex("by_annotation_status", (q) =>
        q.eq("userId", ctx.readerId).eq("annotationStatus", "annotated"),
      )
      .order("desc")
      .take(50);
  },
});

// Finished or archived articles stay out of every suggestion
export const listUnread = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("articles")
      .withIndex("by_user_annotationStatus_finishedAt", (q) =>
        q
          .eq("userId", ctx.readerId)
          .eq("annotationStatus", "annotated")
          .eq("finishedAt", undefined),
      )
      .order("desc")
      .take(100);
  },
});

/** Takes an article out of the queue without counting it as read. */
export const archive = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const before = await requireArticle(ctx, args.articleId, ctx.readerId);
    if (before.finishedAt !== undefined) return;
    await ctx.db.patch(before._id, { finishedAt: Date.now() });
    const after = await ctx.db.get(before._id);
    if (after) await updateQueueStats(ctx, before, after);
    await ctx.scheduler.runAfter(
      0,
      internal.actions.readwiseSync.archiveArticle,
      { userId: ctx.readerId, articleId: before._id },
    );
  },
});

/** Puts a finished or archived article back in the queue. Reading history stays. */
export const restore = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const before = await requireArticle(ctx, args.articleId, ctx.readerId);
    if (before.finishedAt === undefined) return;
    await ctx.db.patch(before._id, { finishedAt: undefined });
    const after = await ctx.db.get(before._id);
    if (after) await updateQueueStats(ctx, before, after);
    await ctx.scheduler.runAfter(
      0,
      internal.actions.readwiseSync.unarchiveArticle,
      { userId: ctx.readerId, articleId: before._id },
    );
  },
});

export const listPendingExtraction = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("articles")
      .withIndex("by_extraction_status", (q) =>
        q.eq("userId", ctx.readerId).eq("extractionStatus", "pending"),
      )
      .take(20);
  },
});

// --- Internal ---

export const getByGuid = internalQuery({
  args: { userId: v.string(), guid: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", args.userId).eq("guid", args.guid),
      )
      .first();
  },
});

export const getByIdInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.articleId);
  },
});

/** The article only when it belongs to the given library. */
export const getForReaderInternal = internalQuery({
  args: { articleId: v.id("articles"), userId: v.string() },
  handler: async (ctx, args) => ownedArticle(ctx, args.articleId, args.userId),
});

export const insert = internalMutation({
  args: {
    feedId: v.id("feeds"),
    userId: v.string(),
    guid: v.string(),
    url: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    excerpt: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracted"),
      v.literal("failed"),
    ),
    annotationStatus: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("articles", args);
    const article = await ctx.db.get(id);
    if (article) await updateQueueStats(ctx, null, article);
    return id;
  },
});

export const listPendingExtractionInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("articles")
      .withIndex("by_extraction_status", (q) =>
        q.eq("userId", args.userId).eq("extractionStatus", "pending"),
      )
      .take(10);
  },
});

export const updateExtractionStatus = internalMutation({
  args: {
    articleId: v.id("articles"),
    status: v.union(
      v.literal("pending"),
      v.literal("extracted"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.articleId, { extractionStatus: args.status });
  },
});

export const updateExtracted = internalMutation({
  args: {
    articleId: v.id("articles"),
    content: v.string(),
    contentHtml: v.string(),
    excerpt: v.string(),
    wordCount: v.number(),
    estimatedReadMinutes: v.number(),
    imageUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    author: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const { articleId, ...updates } = args;
    const before = await ctx.db.get(articleId);
    await ctx.db.patch(articleId, {
      ...updates,
      extractionStatus: "extracted" as const,
    });
    const after = await ctx.db.get(articleId);
    if (after) await updateQueueStats(ctx, before, after);
  },
});

export const getByUrl = internalQuery({
  args: { userId: v.string(), url: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", args.userId).eq("guid", args.url),
      )
      .first();
  },
});

export const requestReannotate = action({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article: Doc<"articles"> | null = await ctx.runQuery(
      internal.articles.getForReaderInternal,
      { articleId: args.articleId, userId: ctx.readerId },
    );
    if (!article) throw new Error("Article not found");
    // Delete existing annotations and reflection
    await ctx.runMutation(internal.annotations.deleteByArticle, {
      articleId: args.articleId,
    });
    await ctx.runMutation(internal.reflections.deleteByArticle, {
      articleId: args.articleId,
    });
    // Reset annotation status
    await ctx.runMutation(internal.articles.updateAnnotationStatus, {
      articleId: args.articleId,
      status: "pending",
    });
    // Schedule re-annotation
    await ctx.scheduler.runAfter(
      500,
      internal.actions.generateAnnotations.generateForArticle,
      { articleId: args.articleId },
    );
  },
});

export const insertExtracted = internalMutation({
  args: {
    userId: v.string(),
    guid: v.string(),
    url: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    content: v.string(),
    contentHtml: v.string(),
    excerpt: v.string(),
    wordCount: v.number(),
    estimatedReadMinutes: v.number(),
    imageUrl: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    readerDocumentId: v.optional(v.string()),
    annotateAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", args.userId).eq("guid", args.guid),
      )
      .first();
    if (existing) {
      if (args.readerDocumentId && !existing.readerDocumentId) {
        await ctx.db.patch(existing._id, {
          readerDocumentId: args.readerDocumentId,
        });
      }
      return existing._id;
    }
    const { annotateAfterMs, ...article } = args;
    const id = await ctx.db.insert("articles", {
      ...article,
      extractionStatus: "extracted",
      annotationStatus: "pending",
      createdAt: Date.now(),
    });
    const inserted = await ctx.db.get(id);
    if (inserted) await updateQueueStats(ctx, null, inserted);
    await ctx.scheduler.runAfter(
      annotateAfterMs ?? 500,
      internal.actions.generateAnnotations.generateForArticle,
      { articleId: id },
    );
    return id;
  },
});

export const updateAnnotationStatus = internalMutation({
  args: {
    articleId: v.id("articles"),
    status: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    skipReason: v.optional(v.literal("no_provider")),
  },
  handler: (ctx, args) =>
    setAnnotationStatus(ctx, args.articleId, args.status, args.skipReason),
});

/** Changes an article's annotation status and keeps the queue counters in step. */
export async function setAnnotationStatus(
  ctx: MutationCtx,
  articleId: Id<"articles">,
  status: Doc<"articles">["annotationStatus"],
  skipReason?: "no_provider",
) {
  const before = await ctx.db.get("articles", articleId);
  if (!before) return;
  await ctx.db.patch("articles", articleId, {
    annotationStatus: status,
    skipReason: status === "skipped" ? skipReason : undefined,
  });
  const after = await ctx.db.get("articles", articleId);
  if (after) await updateQueueStats(ctx, before, after);
}

export const setEmbedding = internalMutation({
  args: { articleId: v.id("articles"), embedding: v.array(v.float64()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("articles", args.articleId);
    if (row && !row.embedding)
      await ctx.db.patch("articles", args.articleId, {
        embedding: args.embedding,
      });
    return null;
  },
});
