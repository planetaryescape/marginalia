import { v } from "convex/values";
import { internal } from "./_generated/api";
import { ownedArticle, requireArticle } from "./access";
import { internalMutation, internalQuery, mutation, query } from "./functions";

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
    unitIndex: v.optional(v.number()),
    turns: v.array(turnValidator),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { legacyId, ...args }) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    const now = Date.now();
    const unitIndex = args.unitIndex;
    // A book's answers are looked up within their part
    const threads =
      unitIndex === undefined
        ? await ctx.db
            .query("companionThreads")
            .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
            .take(200)
        : await ctx.db
            .query("companionThreads")
            .withIndex("by_article_and_unitIndex", (q) =>
              q.eq("articleId", args.articleId).eq("unitIndex", unitIndex),
            )
            .take(200);
    const legacy = legacyId
      ? threads.find(
          (t) =>
            t._id === legacyId &&
            t.userId === ctx.readerId &&
            t.answerId === undefined,
        )
      : undefined;
    const existing =
      threads.find(
        (t) => t.userId === ctx.readerId && t.answerId === args.answerId,
      ) ?? legacy;
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
      await ctx.db.patch("companionThreads", existing._id, {
        answerId: args.answerId,
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

export const setEmbedding = internalMutation({
  args: { threadId: v.id("companionThreads"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("companionThreads", args.threadId);
    if (row)
      await ctx.db.patch("companionThreads", args.threadId, {
        embedding: args.embedding,
      });
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
