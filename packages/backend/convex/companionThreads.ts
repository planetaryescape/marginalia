import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

const turnValidator = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
});

export const listByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("companionThreads")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(200);
  },
});

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    mode: v.union(
      v.literal("explain"),
      v.literal("simplify"),
      v.literal("ask"),
      v.literal("article"),
    ),
    selection: v.string(),
    question: v.optional(v.string()),
    paragraphIndex: v.optional(v.number()),
    turns: v.array(turnValidator),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const threadId = await ctx.db.insert("companionThreads", {
      ...args,
      userId: DEFAULT_USER_ID,
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

export const updateTurns = mutation({
  args: {
    threadId: v.id("companionThreads"),
    turns: v.array(turnValidator),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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

export const listUnembedded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("companionThreads").take(500);
    return rows.filter((r) => !r.embedding).map((r) => r._id);
  },
});
