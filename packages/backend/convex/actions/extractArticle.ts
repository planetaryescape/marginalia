"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { EXTRACT_PAGE, WORDS_PER_MINUTE } from "../lib/constants";
import { embedForLibrary } from "../lib/router";

export const extractPending = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const pending = await ctx.runQuery(
      internal.articles.listPendingExtractionInternal,
      { userId: args.userId },
    );

    for (const article of pending) {
      // A run started by a later poll may have reached it first
      const current = await ctx.runQuery(internal.articles.getByIdInternal, {
        articleId: article._id,
      });
      if (current?.extractionStatus !== "pending") continue;
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
    // The query returns a page at a time; keep going until the backlog is empty
    if (pending.length === EXTRACT_PAGE) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.extractArticle.extractPending,
        args,
      );
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
    embedding = (
      await embedForLibrary(ctx, article.userId, [embeddingText])
    )?.[0];
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
