import { ConvexError, type ObjectType, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ownedArticle, requireArticle } from "./access";
import { wakeExtraction } from "./articleExtraction";
import { syncBookFinished } from "./books";
import { liveImport, markImportReady } from "./documentImports";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  query,
} from "./functions";
import {
  annotatesAtImport,
  LOOKAHEAD_COUNT,
  needsAnnotationStart,
} from "./lib/annotationPolicy";
import {
  findImportArticle,
  rememberImportIdentity,
} from "./lib/articleIdentity";
import { EXTRACT_PAGE } from "./lib/constants";
import { bumpFeedArticleCount } from "./lib/feedArticleCount";
import { validateArticleSize } from "./lib/importContent";
import { importLibraryActive } from "./lib/importJobs";
import {
  annotationGeneration,
  annotationPublicationAllowed,
} from "./lib/manualAnnotations";
import { unreadQueue } from "./lib/unreadQueue";
import { queueLibraryIndex } from "./libraryIndex";
import { READER_LIMITS, spendReaderLimit } from "./limits";
import { updateQueueStats } from "./readingQueue";
import { CLAIM_TTL_MS } from "./reannotateBackfill";

export const getById = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ownedArticle(ctx, args.articleId, ctx.readerId);
  },
});

/** Notes headings only; missing and foreign articles are indistinguishable. */
export const headers = query({
  args: { articleIds: v.array(v.id("articles")) },
  handler: async (ctx, { articleIds }) => {
    // Article rows can approach 1 MiB even though the response is tiny.
    if (articleIds.length > 8) throw new Error("Too many article headers");
    return Promise.all(
      [...new Set(articleIds)].map(async (articleId) => {
        const article = await ownedArticle(ctx, articleId, ctx.readerId);
        return {
          articleId,
          article: article ? { title: article.title, url: article.url } : null,
        };
      }),
    );
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
    if (before.bookUnitCount !== undefined)
      await syncBookFinished(ctx, ctx.readerId, before._id, true);
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
    if (before.bookUnitCount !== undefined)
      await syncBookFinished(ctx, ctx.readerId, before._id, false);
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
    return findImportArticle(ctx, args.userId, "", args.guid);
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

const feedInsertArgs = {
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
};

async function upsertFeedArticle(
  ctx: MutationCtx,
  args: ObjectType<typeof feedInsertArgs>,
) {
  const feed = await ctx.db.get("feeds", args.feedId);
  if (
    feed?.userId !== args.userId ||
    !(await importLibraryActive(ctx, args.userId))
  )
    throw new Error("Feed not found");
  const existing = await findImportArticle(
    ctx,
    args.userId,
    args.url,
    args.guid,
  );
  if (existing) {
    await rememberImportIdentity(ctx, existing, args.guid, args.url);
    // A manually/API/Reader-imported copy gains its first feed association;
    // never move an article from a different source or replace its GUID.
    if (!existing.feedId) {
      await ctx.db.patch(existing._id, { feedId: args.feedId });
      await bumpFeedArticleCount(ctx, args.feedId, args.userId, 1);
    }
    return { articleId: existing._id, created: false };
  }
  validateArticleSize(args);
  const id = await ctx.db.insert("articles", args);
  await bumpFeedArticleCount(ctx, args.feedId, args.userId, 1);
  const article = await ctx.db.get(id);
  if (article) {
    await updateQueueStats(ctx, null, article);
    await rememberImportIdentity(ctx, article, args.guid, args.url);
  }
  if (args.extractionStatus === "pending")
    await ctx.scheduler.runAfter(0, internal.articleExtraction.start, {
      articleId: id,
    });
  return { articleId: id, created: true };
}

export const insert = internalMutation({
  args: feedInsertArgs,
  handler: async (ctx, args) => (await upsertFeedArticle(ctx, args)).articleId,
});

export const upsertFeed = internalMutation({
  args: feedInsertArgs,
  handler: upsertFeedArticle,
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
    const article = await ctx.db.get("articles", args.articleId);
    if (
      !article ||
      article.extractionLeaseUntil !== undefined ||
      article.extractionStatus === "extracted"
    )
      return;
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
    extractionRun: v.optional(v.number()),
    userId: v.optional(v.string()),
  },
  // Legacy result: whether this was a first extraction eligible for annotation.
  // Its schedule now commits here with the readable text. Long articles are deferred.
  // Only the first
  // extraction to finish decides: a second, overlapping one finds the article
  // already extracted and must not touch an annotation status that has moved on
  // (pending here can mean annotation is underway).
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { articleId, extractionRun, userId, ...updates } = args;
    const before = await ctx.db.get(articleId);
    if (!before || !(await importLibraryActive(ctx, before.userId))) {
      if (userId) await wakeExtraction(ctx, userId);
      return false;
    }
    if (
      extractionRun !== undefined
        ? before.extractionStatus !== "pending" ||
          before.userId !== userId ||
          before.extractionRun !== extractionRun ||
          (before.extractionLeaseUntil ?? 0) <= Date.now()
        : before.extractionLeaseUntil !== undefined
    ) {
      await wakeExtraction(ctx, before.userId);
      return false;
    }
    validateArticleSize({ ...before, ...updates });
    const firstExtraction = before?.extractionStatus === "pending";
    const annotateNow =
      firstExtraction && annotatesAtImport(args.estimatedReadMinutes);
    await ctx.db.patch(articleId, {
      ...updates,
      ...(before.content !== updates.content && !updates.embedding
        ? { embedding: undefined, embeddedAt: undefined }
        : {}),
      ...(updates.embedding ? { embeddedAt: Date.now() } : {}),
      extractionStatus: "extracted" as const,
      extractionLeaseUntil: undefined,
      extractionRetryAt: undefined,
      extractionFailure: undefined,
    });
    if (
      firstExtraction &&
      !annotateNow &&
      before?.annotationStatus === "pending"
    )
      await ctx.db.patch(articleId, { annotationStatus: "deferred" });
    const after = await ctx.db.get(articleId);
    if (after) await updateQueueStats(ctx, before, after);
    await queueLibraryIndex(ctx, articleId);
    await wakeExtraction(ctx, before.userId);
    if (annotateNow)
      await ctx.scheduler.runAfter(
        1000,
        internal.actions.generateAnnotations.generateForArticle,
        { articleId },
      );
    return annotateNow;
  },
});

export const getByUrl = internalQuery({
  args: { userId: v.string(), url: v.string() },
  handler: async (ctx, args) => {
    return findImportArticle(ctx, args.userId, args.url);
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
    const article = await findImportArticle(ctx, ctx.readerId, args.url);
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
    await ctx.runMutation(internal.manualAnnotations.request, {
      articleId: args.articleId,
      userId: ctx.readerId,
    });
  },
});

const insertExtractedArgs = {
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
  uploadedFileName: v.optional(v.string()),
  pageCount: v.optional(v.number()),
  annotateAfterMs: v.optional(v.number()),
};

export const insertExtracted = internalMutation({
  args: insertExtractedArgs,
  handler: async (ctx, args) => (await upsertExtractedRow(ctx, args)).articleId,
});

/** Same writer, with a transactionally accurate create/reuse result for the API. */
export const upsertExtracted = internalMutation({
  args: insertExtractedArgs,
  handler: upsertExtractedRow,
});

/**
 * The article of an uploaded PDF, written only while its import is still live:
 * the row exists and the library is active, checked in this transaction.
 */
export const insertImported = internalMutation({
  args: { ...insertExtractedArgs, importId: v.id("documentImports") },
  handler: async (ctx, { importId, ...args }) => {
    const row = await liveImport(ctx, importId);
    if (!row || row.userId !== args.userId) return null;
    const { articleId } = await upsertExtractedRow(ctx, args);
    // Published and ready in one commit
    await markImportReady(ctx, row, {
      articleId,
      title: args.title,
      pages: args.pageCount ?? 0,
    });
    return articleId;
  },
});

async function upsertExtractedRow(
  ctx: MutationCtx,
  args: ObjectType<typeof insertExtractedArgs>,
): Promise<{ articleId: Id<"articles">; created: boolean }> {
  if (!(await importLibraryActive(ctx, args.userId)))
    throw new Error("Library is not active");
  const existing = await findImportArticle(
    ctx,
    args.userId,
    args.url,
    args.guid,
  );
  if (existing) {
    await rememberImportIdentity(ctx, existing, args.guid, args.url);
    if (args.readerDocumentId && !existing.readerDocumentId) {
      await ctx.db.patch(existing._id, {
        readerDocumentId: args.readerDocumentId,
      });
    }
    // An RSS placeholder can be completed by an API/Reader/manual import.
    // This invalidates any outstanding extractor's run without losing source IDs.
    if (
      existing.extractionStatus !== "extracted" &&
      existing.bookUnitCount === undefined
    ) {
      const {
        annotateAfterMs: _delay,
        userId: _user,
        guid: _guid,
        url: _url,
        ...updates
      } = args;
      validateArticleSize({ ...existing, ...updates });
      const annotateNow = annotatesAtImport(args.estimatedReadMinutes);
      await ctx.db.patch(existing._id, {
        ...updates,
        readerDocumentId: existing.readerDocumentId ?? args.readerDocumentId,
        extractionStatus: "extracted",
        extractionLeaseUntil: undefined,
        extractionRetryAt: undefined,
        annotationStatus: annotateNow ? "pending" : "deferred",
        ...(args.embedding ? { embeddedAt: Date.now() } : {}),
      });
      const after = await ctx.db.get(existing._id);
      if (after) await updateQueueStats(ctx, existing, after);
      await wakeExtraction(ctx, existing.userId);
      if (annotateNow)
        await ctx.scheduler.runAfter(
          args.annotateAfterMs ?? 500,
          internal.actions.generateAnnotations.generateForArticle,
          { articleId: existing._id },
        );
    }
    await queueLibraryIndex(ctx, existing._id);
    return { articleId: existing._id, created: false };
  }
  const { annotateAfterMs, ...article } = args;
  validateArticleSize(article);
  const annotateNow = annotatesAtImport(args.estimatedReadMinutes);
  const id = await ctx.db.insert("articles", {
    ...article,
    ...(article.embedding ? { embeddedAt: Date.now() } : {}),
    extractionStatus: "extracted",
    annotationStatus: annotateNow ? "pending" : "deferred",
    createdAt: Date.now(),
  });
  const inserted = await ctx.db.get(id);
  if (inserted) {
    await updateQueueStats(ctx, null, inserted);
    await rememberImportIdentity(ctx, inserted, args.guid, args.url);
  }
  await queueLibraryIndex(ctx, id);
  if (annotateNow) {
    await ctx.scheduler.runAfter(
      annotateAfterMs ?? 500,
      internal.actions.generateAnnotations.generateForArticle,
      { articleId: id },
    );
  }
  return { articleId: id, created: true };
}

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
      // A failed first annotation is retried too, a capped number of times and
      // not while the backfill holds it: it is what the reader is about to open
      const claimed =
        article?.reannotateClaimedAt !== undefined &&
        Date.now() - article.reannotateClaimedAt < CLAIM_TTL_MS;
      if (article && needsAnnotationStart(article) && !claimed)
        deferred.push(article);
    }
    if (!deferred.length) return 0;
    if (!(await spendReaderLimit(ctx, ctx.readerId, "annotateAhead")))
      throw new ConvexError(READER_LIMITS.annotateAhead.message);
    for (const article of deferred) {
      if (article.annotationStatus === "failed")
        await ctx.db.patch("articles", article._id, {
          annotationRetries: (article.annotationRetries ?? 0) + 1,
        });
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
    generation: v.optional(annotationGeneration),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (
      !article ||
      !(await annotationPublicationAllowed(ctx, article, args.generation))
    )
      return;
    await setAnnotationStatus(
      ctx,
      args.articleId,
      args.status,
      args.skipReason,
    );
  },
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
    if (row && !row.embedding) {
      await ctx.db.patch("articles", args.articleId, {
        embedding: args.embedding,
        embeddedAt: Date.now(),
      });
    }
    return null;
  },
});
