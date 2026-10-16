import { ConvexError, v } from "convex/values";
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
import { annotatesAtImport, LOOKAHEAD_COUNT } from "./lib/annotationPolicy";
import { articleUrlVariants } from "./lib/articleUrl";
import { EXTRACT_PAGE } from "./lib/constants";
import { unreadQueue } from "./lib/unreadQueue";
import { READER_LIMITS, spendReaderLimit } from "./limits";
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
    return unreadQueue(ctx, 100);
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
      .take(EXTRACT_PAGE);
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
  // Whether the caller should schedule annotation: long articles are deferred
  // here, in the same transaction that records their length.
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { articleId, ...updates } = args;
    const before = await ctx.db.get(articleId);
    const annotateNow = annotatesAtImport(args.estimatedReadMinutes);
    await ctx.db.patch(articleId, {
      ...updates,
      extractionStatus: "extracted" as const,
    });
    // Only a fresh import waits; an article already annotated keeps its status
    if (!annotateNow && before?.annotationStatus === "pending")
      await ctx.db.patch(articleId, { annotationStatus: "deferred" });
    const after = await ctx.db.get(articleId);
    if (after) await updateQueueStats(ctx, before, after);
    return annotateNow;
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

/**
 * The reader's own copy of a web address, if it is in the library. The link menu
 * reads its title and length, and whether it is already saved, without fetching
 * the page. A copy is found by its URL or by the GUID an import stored (feeds
 * store their own GUID, which is often not the URL).
 */
export const findByUrl = query({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const variants = articleUrlVariants(args.url);
    const [byUrl, byGuid] = await Promise.all([
      Promise.all(
        variants.map((url) =>
          ctx.db
            .query("articles")
            .withIndex("by_user_url", (q) =>
              q.eq("userId", ctx.readerId).eq("url", url),
            )
            .first(),
        ),
      ),
      Promise.all(
        variants.map((guid) =>
          ctx.db
            .query("articles")
            .withIndex("by_user_guid", (q) =>
              q.eq("userId", ctx.readerId).eq("guid", guid),
            )
            .first(),
        ),
      ),
    ]);
    const article = [...byUrl, ...byGuid].find((a) => a !== null);
    if (!article) return null;
    const saved = await ctx.db
      .query("savedArticles")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", ctx.readerId).eq("articleId", article._id),
      )
      .first();
    return {
      _id: article._id,
      title: article.title,
      estimatedReadMinutes: article.estimatedReadMinutes ?? null,
      saved: saved !== null,
    };
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
    const annotateNow = annotatesAtImport(args.estimatedReadMinutes);
    const id = await ctx.db.insert("articles", {
      ...article,
      extractionStatus: "extracted",
      annotationStatus: annotateNow ? "pending" : "deferred",
      createdAt: Date.now(),
    });
    const inserted = await ctx.db.get(id);
    if (inserted) await updateQueueStats(ctx, null, inserted);
    if (annotateNow) {
      await ctx.scheduler.runAfter(
        annotateAfterMs ?? 500,
        internal.actions.generateAnnotations.generateForArticle,
        { articleId: id },
      );
    }
    return id;
  },
});

/**
 * Starts marginalia for the deferred articles the desk is about to offer.
 * Only a deferred article of this reader moves to pending, and the status
 * change and the schedule share one transaction, so concurrent calls can't
 * start the same article twice. Anything else is left alone.
 */
export const annotateAhead = mutation({
  args: { articleIds: v.array(v.id("articles")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const ids = [...new Set(args.articleIds)].slice(0, LOOKAHEAD_COUNT);
    const deferred: Doc<"articles">[] = [];
    for (const id of ids) {
      const article = await ownedArticle(ctx, id, ctx.readerId);
      if (article?.annotationStatus === "deferred") deferred.push(article);
    }
    if (!deferred.length) return 0;
    if (!(await spendReaderLimit(ctx, ctx.readerId, "annotateAhead")))
      throw new ConvexError(READER_LIMITS.annotateAhead.message);
    for (const article of deferred) {
      await setAnnotationStatus(ctx, article._id, "pending");
      await ctx.scheduler.runAfter(
        0,
        internal.actions.generateAnnotations.generateForArticle,
        { articleId: article._id },
      );
    }
    return deferred.length;
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
