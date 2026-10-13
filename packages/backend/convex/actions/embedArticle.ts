"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { embedForLibrary } from "../lib/router";

/** Embeds an article saved while its library had no embedding key. */
export const embed = internalAction({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article: Doc<"articles"> | null = await ctx.runQuery(
      internal.articles.getByIdInternal,
      args,
    );
    if (!article?.content || article.embedding) return;
    try {
      // The same text ingestion embeds
      const [embedding] =
        (await embedForLibrary(ctx, article.userId, [
          article.content.slice(0, 8000),
        ])) ?? [];
      if (!embedding) return;
      await ctx.runMutation(internal.articles.setEmbedding, {
        articleId: args.articleId,
        embedding,
      });
    } catch (error) {
      console.error(`Failed to embed article ${args.articleId}:`, error);
    }
  },
});
