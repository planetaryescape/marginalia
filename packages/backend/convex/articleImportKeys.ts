import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./functions";

/** Account purge step: caller repeats while this returns a nonzero batch. */
export async function purgeForReader(ctx: MutationCtx, userId: string) {
  const rows = await ctx.db
    .query("articleImportKeys")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(100);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

/** Article deletion hook; scheduled separately so aliases never inflate a removal transaction. */
export const discard = internalMutation({
  args: { articleId: v.id("articles"), userId: v.string() },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (article) return;
    const rows = await ctx.db
      .query("articleImportKeys")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 100)
      await ctx.scheduler.runAfter(0, internal.articleImportKeys.discard, args);
  },
});
