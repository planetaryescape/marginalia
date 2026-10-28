import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { ownedArticleCard as ownedArticle, requireArticle } from "./access";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import {
  assertBytes,
  MAX_STORED_TURNS,
  TRANSCRIPT_BYTES,
  threadPreview,
  validateIndex,
  validateTranscript,
} from "./lib/readerBodies";

const turnValidator = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
});

const modeValidator = v.union(
  v.literal("explain"),
  v.literal("simplify"),
  v.literal("define"),
  v.literal("ask"),
  v.literal("article"),
);

export const listByArticle = query({
  args: {
    articleId: v.id("articles"),
    // For a book: only the answers about this part
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return [];
    const unitIndex = args.unitIndex;
    return unitIndex === undefined
      ? ctx.db
          .query("companionThreads")
          .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
          .take(200)
      : ctx.db
          .query("companionThreads")
          .withIndex("by_article_and_unitIndex", (q) =>
            q.eq("articleId", args.articleId).eq("unitIndex", unitIndex),
          )
          .take(200);
  },
});

/** The newest answers the reader chose to keep, for the Notes page. */
const KEPT_LIMIT = 100;

export const listKept = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("companionThreads")
      // Rows saved before Keep existed have no keptAt and sort below 0
      .withIndex("by_user_kept", (q) =>
        q.eq("userId", ctx.readerId).gt("keptAt", 0),
      )
      .order("desc")
      .take(KEPT_LIMIT);
    // The embedding is 1536 numbers the page never reads
    return rows.map(({ embedding: _embedding, ...row }) => row);
  },
});

export const listByArticleInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) =>
    ctx.db
      .query("companionThreads")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(200),
});

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    mode: modeValidator,
    selection: v.string(),
    question: v.optional(v.string()),
    paragraphIndex: v.optional(v.number()),
    unitIndex: v.optional(v.number()),
    turns: v.array(turnValidator),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    validateTranscript(args.turns);
    assertBytes(args.selection, 32_000, "Selection");
    if (args.question) assertBytes(args.question, 16_000, "Question");
    validateIndex(args.unitIndex, "unit");
    validateIndex(args.paragraphIndex, "paragraph");
    if (args.model) assertBytes(args.model, 512, "Model");
    const now = Date.now();
    const threadId = await ctx.db.insert("companionThreads", {
      ...args,
      userId: ctx.readerId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.embedReaderActivity.embedThread,
      {
        threadId,
      },
    );
    return threadId;
  },
});

/**
 * Keeps an answer the reader chose to keep. Answers are temporary until this
 * runs, so it is the only way a new reader client creates a thread. An
 * answer's identity is the id the client gave it, so a retry (a double click,
 * a second tab) updates its one row while a different answer to the same
 * passage and question is a row of its own. An older automatically saved
 * thread, which has no such id, is upgraded in place when the client says
 * which row the answer was loaded from (`legacyId`).
 */
export const keep = mutation({
  args: {
    articleId: v.id("articles"),
    answerId: v.string(),
    legacyId: v.optional(v.id("companionThreads")),
    mode: modeValidator,
    selection: v.string(),
    question: v.optional(v.string()),
    paragraphIndex: v.optional(v.number()),
    occurrence: v.optional(v.number()),
    paragraphEnd: v.optional(v.number()),
    summaryDefinition: v.optional(v.boolean()),
    unitIndex: v.optional(v.number()),
    turns: v.array(turnValidator),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { legacyId, ...args }) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    validateTranscript(args.turns);
    assertBytes(args.answerId, 512, "Answer identity");
    if (!args.answerId.trim()) throw new Error("An answer needs an identity");
    assertBytes(args.selection, 32_000, "Selection");
    if (args.question) assertBytes(args.question, 16_000, "Question");
    validateIndex(args.unitIndex, "unit");
    validateIndex(args.paragraphIndex, "paragraph");
    validateIndex(args.occurrence, "occurrence");
    validateIndex(args.paragraphEnd, "paragraph");
    if (args.model) assertBytes(args.model, 512, "Model");
    const now = Date.now();
    const identified = await ctx.db
      .query("companionThreads")
      .withIndex("by_userId_and_articleId_and_unitIndex_and_answerId", (q) =>
        q
          .eq("userId", ctx.readerId)
          .eq("articleId", args.articleId)
          .eq("unitIndex", args.unitIndex)
          .eq("answerId", args.answerId),
      )
      .first();
    const candidate = legacyId ? await ctx.db.get(legacyId) : null;
    const legacy =
      candidate?.userId === ctx.readerId &&
      candidate.articleId === args.articleId &&
      candidate.unitIndex === args.unitIndex &&
      candidate.answerId === undefined
        ? candidate
        : null;
    const existing = identified ?? legacy;
    const threadId =
      existing?._id ??
      (await ctx.db.insert("companionThreads", {
        ...args,
        userId: ctx.readerId,
        keptAt: now,
        createdAt: now,
        updatedAt: now,
      }));
    if (existing) {
      // A stale tab may hold fewer turns than the record has grown to; never
      // shrink a kept transcript.
      const stale = args.turns.length < existing.turns.length;
      const unchanged =
        existing.turns.length === args.turns.length &&
        existing.model === args.model &&
        existing.turns.every(
          (turn, index) =>
            turn.role === args.turns[index].role &&
            turn.content === args.turns[index].content,
        );
      // A retry neither creates another row nor launches another embedding.
      if (
        existing.answerId === args.answerId &&
        existing.keptAt !== undefined &&
        (stale || unchanged)
      )
        return existing._id;
      await ctx.db.patch("companionThreads", existing._id, {
        answerId: args.answerId,
        summaryDefinition: args.summaryDefinition ?? existing.summaryDefinition,
        // An older row learns where its passage is when it is kept again
        occurrence: args.occurrence ?? existing.occurrence,
        paragraphEnd: args.paragraphEnd ?? existing.paragraphEnd,
        turns: stale ? existing.turns : args.turns,
        model: stale ? existing.model : args.model,
        keptAt: existing.keptAt ?? now,
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.actions.embedReaderActivity.embedThread,
      { threadId },
    );
    return threadId;
  },
});

export const updateTurns = mutation({
  args: {
    threadId: v.id("companionThreads"),
    turns: v.array(turnValidator),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("companionThreads", args.threadId);
    if (thread?.userId !== ctx.readerId) throw new Error("Thread not found");
    validateTranscript(args.turns);
    if (args.model) assertBytes(args.model, 512, "Model");
    await ctx.db.patch("companionThreads", args.threadId, {
      turns: args.turns,
      model: args.model,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.embedReaderActivity.embedThread,
      {
        threadId: args.threadId,
      },
    );
  },
});

export const remove = mutation({
  args: { threadId: v.id("companionThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("companionThreads", args.threadId);
    if (thread?.userId !== ctx.readerId) throw new Error("Thread not found");
    await ctx.db.delete("companionThreads", args.threadId);
  },
});

export const getByIdInternal = internalQuery({
  args: { threadId: v.id("companionThreads") },
  handler: async (ctx, args) => ctx.db.get("companionThreads", args.threadId),
});

export const listPreviewsByArticle = query({
  args: {
    articleId: v.id("articles"),
    unitIndex: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId)))
      return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("companionThreads")
      .withIndex("by_article_and_unitIndex", (q) =>
        q.eq("articleId", args.articleId).eq("unitIndex", args.unitIndex),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(25, args.paginationOpts.numItems)),
        maximumBytesRead: 2_000_000,
      });
    return {
      ...page,
      page: await Promise.all(
        page.page
          .filter((row) => row.userId === ctx.readerId)
          .map(threadPreview),
      ),
    };
  },
});

export const listKeptPreviews = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("companionThreads")
      .withIndex("by_user_kept", (q) =>
        q.eq("userId", ctx.readerId).gt("keptAt", 0),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(25, args.paginationOpts.numItems)),
        maximumBytesRead: 2_000_000,
      });
    return { ...page, page: await Promise.all(page.page.map(threadPreview)) };
  },
});

export const getBody = query({
  args: { threadId: v.id("companionThreads") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.threadId);
    if (row?.userId !== ctx.readerId) return null;
    // Explicit hydration carries only the fields needed to reopen an answer.
    return {
      _id: row._id,
      articleId: row.articleId,
      answerId: row.answerId,
      mode: row.mode,
      selection: row.selection,
      question: row.question,
      paragraphIndex: row.paragraphIndex,
      occurrence: row.occurrence,
      paragraphEnd: row.paragraphEnd,
      summaryDefinition: row.summaryDefinition,
      unitIndex: row.unitIndex,
      turns: row.turns,
      model: row.model,
      keptAt: row.keptAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      legacyOversized:
        row.turns.length > MAX_STORED_TURNS ||
        new TextEncoder().encode(JSON.stringify(row.turns)).byteLength >
          TRANSCRIPT_BYTES,
    };
  },
});

export const setEmbedding = internalMutation({
  args: { threadId: v.id("companionThreads"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("companionThreads", args.threadId);
    if (row) {
      await ctx.db.patch("companionThreads", args.threadId, {
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
      .query("companionThreads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(500);
    return rows.filter((r) => !r.embedding).map((r) => r._id);
  },
});
