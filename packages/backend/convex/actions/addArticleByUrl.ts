"use node";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { DEFAULT_USER_ID, WORDS_PER_MINUTE } from "../lib/constants";
import { embedText } from "../lib/aiModels";

export const add = action({
  args: { url: v.string() },
  handler: async (ctx, args): Promise<{ articleId: Id<"articles">; alreadyExists: boolean }> => {
    const url = args.url.trim();
    if (!url) throw new Error("URL is required");

    // Check for duplicate by URL
    const existing: any = await ctx.runQuery(internal.articles.getByUrl, { url });
    if (existing) {
      return { articleId: existing._id, alreadyExists: true };
    }

    // Extract article content
    const { extract } = await import("@extractus/article-extractor");

    const result = await extract(url);

    if (!result || !result.content) {
      throw new Error(
        "Could not extract article content. The site may block scraping or require JavaScript.",
      );
    }

    const plainText = result.content
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const wordCount = plainText.split(/\s+/).length;
    const estimatedReadMinutes = Math.ceil(wordCount / WORDS_PER_MINUTE);

    // Generate embedding
    let embedding: number[] | undefined;
    try {
      embedding = await embedText(plainText.slice(0, 8000));
    } catch (error) {
      console.error("Embedding failed, continuing without:", error);
    }

    // Insert directly as an extracted article (no feed needed)
    const articleId = await ctx.runMutation(internal.articles.insertExtracted, {
      userId: DEFAULT_USER_ID,
      guid: url,
      url,
      title: result.title || url,
      author: result.author,
      publishedAt: result.published
        ? new Date(result.published).getTime()
        : undefined,
      content: plainText,
      contentHtml: result.content,
      excerpt: plainText.slice(0, 300),
      wordCount,
      estimatedReadMinutes,
      imageUrl: result.image,
      embedding,
    });

    // Schedule annotation generation
    await ctx.scheduler.runAfter(
      500,
      internal.actions.generateAnnotations.generateForArticle,
      { articleId },
    );

    return { articleId, alreadyExists: false };
  },
});
