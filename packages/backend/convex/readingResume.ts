import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { mergeResume, resumeArticle, resumeState } from "./lib/readingResume";
import {
  metadataLibraryActive,
  metadataLibraryRetained,
} from "./lib/shelfCounts";

/** Explicit, additive admin migration. One paginate per transaction, no scheduled jobs. */
export const backfill = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    if (!(await metadataLibraryActive(ctx, userId)))
      return { complete: false, inactive: true };
    let state = await resumeState(ctx, userId);
    if (!state) {
      const id = await ctx.db.insert("readingResumeState", {
        userId,
        phase: "interactions",
        cursor: null,
      });
      state = await ctx.db.get(id);
    }
    if (!state) throw new Error("Resume migration state missing");
    if (state.phase === "done") return { complete: true, inactive: false };
    const opts = {
      cursor: state.cursor,
      numItems: 4,
      maximumBytesRead: 2_000_000,
    };
    const page =
      state.phase === "interactions"
        ? await ctx.db
            .query("articleInteractions")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .paginate(opts)
        : await ctx.db
            .query("readingActivity")
            .withIndex("by_user_started", (q) => q.eq("userId", userId))
            .paginate(opts);
    for (const row of page.page) {
      if (
        "action" in row &&
        row.action !== "opened" &&
        row.action !== "abandoned"
      )
        continue;
      const article = await resumeArticle(ctx, userId, row.articleId);
      if (!article) continue;
      await mergeResume(
        ctx,
        article,
        {
          articleId: row.articleId,
          updatedAt: "updatedAt" in row ? row.updatedAt : row.createdAt,
          maxScrollPercent:
            row.maxScrollPercent ??
            ("scrollPercentage" in row ? row.scrollPercentage : undefined) ??
            0,
          paragraphIndex:
            "paragraphIndex" in row ? row.paragraphIndex : undefined,
          visitId: row.visitId,
          day: "day" in row ? row.day : undefined,
        },
        !("action" in row),
      );
    }
    const phase = page.isDone
      ? state.phase === "interactions"
        ? "checkpoints"
        : "done"
      : state.phase;
    await ctx.db.patch(state._id, {
      phase,
      cursor: page.isDone ? null : page.continueCursor,
    });
    return { complete: phase === "done", inactive: false };
  },
});

/** Call in the existing account metadata step, BEFORE any paginating hook.
 * Positive count requests a fresh transaction; zero has not paginated. */
export async function purgeReadingResumes(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge a retained library");
  const rows = await ctx.db
    .query("readingResumes")
    .withIndex("by_userId_and_articleId", (q) => q.eq("userId", userId))
    .take(64);
  if (rows.length) {
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  }
  const state = await resumeState(ctx, userId);
  if (state) {
    await ctx.db.delete(state._id);
    return 1;
  }
  return 0;
}
