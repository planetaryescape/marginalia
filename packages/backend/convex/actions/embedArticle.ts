"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

/** Embeds an article saved while its library had no embedding key. */
export const embed = internalAction({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.libraryIndex.enqueue, args);
  },
});
