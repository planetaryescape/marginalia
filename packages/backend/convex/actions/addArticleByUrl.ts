"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../functions";
import { ingestArticle } from "../lib/ingest";

export const add = action({
  args: { url: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ articleId: Id<"articles">; alreadyExists: boolean }> => {
    const url = args.url.trim();
    if (!url) throw new Error("URL is required");

    // Check for duplicate by URL
    const existing: any = await ctx.runQuery(internal.articles.getByUrl, {
      url,
    });
    if (existing) {
      return { articleId: existing._id, alreadyExists: true };
    }

    // Extract article content
    const { extract } = await import("@extractus/article-extractor");

    const result = await extract(url);

    if (!result?.content) {
      throw new Error(
        "Could not extract article content. The site may block scraping or require JavaScript.",
      );
    }

    const articleId = await ingestArticle(ctx, {
      url,
      title: result.title || url,
      html: result.content,
      author: result.author,
      publishedAt: result.published
        ? new Date(result.published).getTime()
        : undefined,
      imageUrl: result.image,
    });

    if (!articleId) throw new Error("This article is too large to store.");
    return { articleId, alreadyExists: false };
  },
});
