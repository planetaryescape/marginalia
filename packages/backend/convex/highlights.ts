import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

export const listByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(500);
  },
});

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    text: v.string(),
    paragraphIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const highlightId = await ctx.db.insert("highlights", {
      ...args,
      userId: DEFAULT_USER_ID,
      createdAt: Date.now(),
    });
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
    await ctx.db.delete("highlights", args.highlightId);
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

export const listUnembedded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("highlights").take(500);
    return rows.filter((r) => !r.embedding).map((r) => r._id);
  },
});
