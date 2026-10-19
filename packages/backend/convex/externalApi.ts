import { v } from "convex/values";
import { ownedArticleCard } from "./access";
import { internalQuery } from "./functions";
import { findImportArticle } from "./lib/articleIdentity";
import { externalGuid } from "./lib/externalApi";

export const articleByExternalId = internalQuery({
  args: { userId: v.string(), externalId: v.string() },
  handler: async (ctx, args) => {
    const article = await findImportArticle(
      ctx,
      args.userId,
      "",
      externalGuid(args.externalId),
    );
    return article?._id ?? null;
  },
});

/** One article's highlights, only when the article is in this library. */
export const highlightsForArticle = internalQuery({
  args: { userId: v.string(), articleId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("articles", args.articleId);
    if (!id) return null;
    const article = await ownedArticleCard(ctx, id, args.userId);
    if (!article) return null;
    const rows = await ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", id))
      .take(500);
    return {
      articleId: id,
      title: article.title,
      highlights: rows
        .filter((row) => row.userId === args.userId)
        .map((row) => ({
          id: row._id,
          kind: row.kind,
          text: row.text,
          paragraphIndex: row.paragraphIndex ?? null,
          createdAt: row.createdAt,
        })),
    };
  },
});
