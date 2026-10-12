import { v } from "convex/values";
import { ownedArticle, requireArticle } from "./access";
import { internalMutation, query } from "./functions";

export const getByArticle = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return null;
    return ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .first();
  },
});

/** Replaces any existing summary for the article. */
export const save = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    gist: v.string(),
    thesis: v.string(),
    ideas: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        detail: v.string(),
        role: v.union(
          v.literal("premise"),
          v.literal("evidence"),
          v.literal("claim"),
          v.literal("counterpoint"),
          v.literal("conclusion"),
        ),
        paragraphs: v.array(v.number()),
      }),
    ),
    links: v.array(
      v.object({
        from: v.string(),
        to: v.string(),
        relation: v.union(
          v.literal("supports"),
          v.literal("leads_to"),
          v.literal("contrasts"),
          v.literal("illustrates"),
        ),
      }),
    ),
    flow: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, args.userId);
    const existing = await ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(10);
    for (const row of existing) await ctx.db.delete("summaries", row._id);
    return ctx.db.insert("summaries", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
