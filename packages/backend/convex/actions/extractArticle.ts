"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { embedText } from "../lib/aiModels";
import { WORDS_PER_MINUTE } from "../lib/constants";

export const extractPending = internalAction({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.runQuery(
      internal.articles.listPendingExtractionInternal,
    );

    for (const article of pending) {
      try {
        await extractSingle(ctx, article);
      } catch (error) {
        console.error(`Failed to extract ${article.url}:`, error);
        await ctx.runMutation(internal.articles.updateExtractionStatus, {
          articleId: article._id,
          status: "failed",
        });
      }
    }
  },
});

export const extractOne = internalAction({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ctx.runQuery(internal.articles.getByIdInternal, {
      articleId: args.articleId,
    });
    if (!article) throw new Error("Article not found");
    await extractSingle(ctx, article);
  },
});

async function extractSingle(ctx: any, article: any) {
  if (!article.url) {
    await ctx.runMutation(internal.articles.updateExtractionStatus, {
      articleId: article._id,
      status: "failed",
    });
    return;
  }

  const { extract } = await import("@extractus/article-extractor");

  const result = await extract(article.url);

  if (!result?.content) {
    await ctx.runMutation(internal.articles.updateExtractionStatus, {
      articleId: article._id,
      status: "failed",
    });
    return;
  }

  // Strip HTML tags for plain text content
  const plainText = result.content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const wordCount = plainText.split(/\s+/).length;
  const estimatedReadMinutes = Math.ceil(wordCount / WORDS_PER_MINUTE);

  // Generate embedding for semantic search
  let embedding: number[] | undefined;
  try {
    // Use first ~2000 chars for embedding (captures main theme)
    const embeddingText = plainText.slice(0, 8000);
    embedding = await embedText(embeddingText);
  } catch (error) {
    console.error("Embedding failed, continuing without:", error);
  }

  await ctx.runMutation(internal.articles.updateExtracted, {
    articleId: article._id,
    content: plainText,
    contentHtml: result.content,
    excerpt: plainText.slice(0, 300),
    wordCount,
    estimatedReadMinutes,
    imageUrl: result.image || article.imageUrl,
    title: result.title || article.title,
    author: result.author || article.author,
    embedding,
  });

  // Schedule annotation generation
  await ctx.scheduler.runAfter(
    1000,
    internal.actions.generateAnnotations.generateForArticle,
    { articleId: article._id },
  );
}
