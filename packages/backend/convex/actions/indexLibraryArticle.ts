"use node";
import { type ObjectType, v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import { embeddingModel, embedTexts } from "../lib/embeddings";
import { retryableImportError } from "../lib/importJobs";
import { isAuthFailure } from "../lib/providers";
import { loadReaderAI } from "../lib/router";

export const run = internalAction({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(internal.libraryIndex.claim, args);
    if (!claim) return;
    await indexClaimed(ctx, { articleId: args.articleId, ...claim });
  },
});

const workArgs = {
  articleId: v.id("articles"),
  userId: v.string(),
  text: v.string(),
  revision: v.number(),
  run: v.number(),
  hash: v.string(),
  model: v.string(),
};

export const runClaimed = internalAction({
  args: workArgs,
  handler: indexClaimed,
});

async function indexClaimed(ctx: ActionCtx, args: ObjectType<typeof workArgs>) {
  const fence = {
    articleId: args.articleId,
    userId: args.userId,
    revision: args.revision,
    run: args.run,
    hash: args.hash,
    model: args.model,
  };
  try {
    const target = (
      await loadReaderAI(ctx, args.userId, { text: false })
    ).embedder();
    // Recheck ownership, content, model and lease immediately before any paid request.
    if (!(await ctx.runMutation(internal.libraryIndex.validate, fence))) return;
    if (!target) {
      await ctx.runMutation(internal.libraryIndex.complete, fence);
      return;
    }
    if (
      embeddingModel(target.provider).replace(/^openai\//, "") !==
      "text-embedding-3-small"
    )
      throw new Error("Library embedding model changed");
    const [embedding] = await embedTexts(target, [args.text]);
    await ctx.runMutation(internal.libraryIndex.complete, {
      ...fence,
      embedding,
    });
  } catch (error) {
    // Do not log article text, keys, provider bodies or URL query strings.
    await ctx.runMutation(internal.libraryIndex.fail, {
      ...fence,
      retryable: retryableImportError(error),
      unavailable: isAuthFailure(error),
    });
  }
}
