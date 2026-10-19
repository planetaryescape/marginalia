"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { embedTexts } from "../lib/embeddings";
import { loadReaderAI } from "../lib/router";

/**
 * Embeds tags that have none (the seed adds names only), a batch at a time.
 * Stops when a batch embeds nothing, so a missing key or a failing provider
 * can't loop; running it again continues.
 */
export const embedMissing = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const target = (
      await loadReaderAI(ctx, args.userId, { text: false })
    ).embedder();
    if (!target) return;
    const batch = await ctx.runQuery(internal.tags.missingEmbeddings, args);
    if (!batch.length) return;
    try {
      const vectors = await embedTexts(
        target,
        batch.map((item) => item.text),
      );
      await ctx.runMutation(internal.tags.setEmbeddings, {
        userId: args.userId,
        items: batch.map((item, i) => ({
          id: item.id,
          text: item.text,
          embedding: vectors[i],
        })),
      });
    } catch (error) {
      console.error("Embedding tags failed:", error);
      return;
    }
    await ctx.scheduler.runAfter(
      1_000,
      internal.actions.embedTags.embedMissing,
      args,
    );
  },
});
