import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { readerTest } from "./owner";

/** Deliver only actual cleanup mutations, never queued model/Reader actions. */
export async function finishArticleRemoval(
  t: Pick<ReturnType<typeof readerTest>, "run" | "mutation">,
  articleId: Id<"articles">,
) {
  while (true) {
    const job = await t.run((ctx) =>
      ctx.db
        .query("feedArticleCleanup")
        .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
        .first(),
    );
    if (!job) return;
    if (job.phase === "checking")
      await t.mutation(internal.feedRemovalCleanup.prepare, { jobId: job._id });
    else
      await t.mutation(internal.feedRemovalCleanup.discard, { jobId: job._id });
  }
}

/** Complete only eligibility, retaining post-delete generated rows for native
 * cleanup/fence measurements. The returned metrics are the final transaction. */
export async function proveArticleRemoval(
  t: Pick<ReturnType<typeof readerTest>, "run" | "mutation">,
  articleId: Id<"articles">,
) {
  while (true) {
    const job = await t.run((ctx) =>
      ctx.db
        .query("feedArticleCleanup")
        .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
        .first(),
    );
    if (job?.phase !== "checking") return null;
    const metrics = await t.run(async (ctx) => {
      await ctx.runMutation(internal.feedRemovalCleanup.prepare, {
        jobId: job._id,
      });
      return ctx.meta.getTransactionMetrics();
    });
    const next = await t.run((ctx) => ctx.db.get(job._id));
    if (next?.phase !== "checking") return metrics;
  }
}
