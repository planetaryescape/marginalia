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
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return [];
    return ctx.db
      .query("companionThreads")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(200);
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
 * runs, so it is the only way a new reader client creates a thread. Keeping the
 * same answer again (a double click, a second tab) updates the one row.
 */
export const keep = mutation({
  args: {
    articleId: v.id("articles"),
    mode: modeValidator,
    selection: v.string(),
    question: v.optional(v.string()),
    paragraphIndex: v.optional(v.number()),
    turns: v.array(turnValidator),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, ctx.readerId);
    const now = Date.now();
    const threads = await ctx.db
      .query("companionThreads")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(200);
    const existing = threads.find(
      (t) =>
        t.userId === ctx.readerId &&
        t.mode === args.mode &&
        t.selection === args.selection &&
        t.question === args.question &&
        t.paragraphIndex === args.paragraphIndex,
    );
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
