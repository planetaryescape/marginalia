import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

// Rows per run. Each run reads the articles of its rows, which can be close to
// a megabyte apiece, so the batch stays small.
const BATCH = 8;

/**
 * Copies `estimatedReadMinutes` onto `readingActivity` rows and `articleTitle`
 * onto `lookups` rows written before those fields existed, then marks lookups
 * of deleted articles. Pages through each table and schedules itself until
 * both are done. Safe to run again: rows that already have the field are
 * skipped.
 */
export const run = internalMutation({
  args: {
    table: v.optional(
      v.union(v.literal("readingActivity"), v.literal("lookups")),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { table = "readingActivity", cursor = null }) => {
    const articles = new Map<Id<"articles">, Doc<"articles"> | null>();
    const articleOf = async (id: Id<"articles">) => {
      if (!articles.has(id)) articles.set(id, await ctx.db.get("articles", id));
      return articles.get(id) ?? null;
    };
    let isDone: boolean;
    let continueCursor: string;
    if (table === "readingActivity") {
      const page = await ctx.db
        .query("readingActivity")
        .paginate({ numItems: BATCH, cursor });
      for (const row of page.page) {
        if (row.estimatedReadMinutes !== undefined) continue;
        const minutes = (await articleOf(row.articleId))?.estimatedReadMinutes;
        if (minutes !== undefined)
          await ctx.db.patch("readingActivity", row._id, {
            estimatedReadMinutes: minutes,
          });
      }
      ({ isDone, continueCursor } = page);
    } else {
      const page = await ctx.db
        .query("lookups")
        .paginate({ numItems: BATCH, cursor });
      for (const row of page.page) {
        if (row.articleTitle !== undefined || row.articleGone) continue;
        const article = await articleOf(row.articleId);
        await ctx.db.patch(
          "lookups",
          row._id,
          article ? { articleTitle: article.title } : { articleGone: true },
        );
      }
      ({ isDone, continueCursor } = page);
    }
    if (!isDone)
      await ctx.scheduler.runAfter(0, internal.readingRoomBackfill.run, {
        table,
        cursor: continueCursor,
      });
    else if (table === "readingActivity")
      await ctx.scheduler.runAfter(0, internal.readingRoomBackfill.run, {
        table: "lookups",
      });
  },
});
