import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { libraryIsActive } from "./access";

type Outcome = "offered" | "opened" | "finished" | "skipped";
type Counts = Record<Outcome, number>;

// Interactions that are outcomes of an offer; saved and abandoned are not
function outcomeOf(action: Doc<"articleInteractions">["action"]) {
  switch (action) {
    case "presented":
      return "offered";
    case "opened":
    case "finished":
    case "skipped":
      return action;
    default:
      return undefined;
  }
}

// Held to a few articles because each carries its full text
const BACKFILL_PAGE = 8;

async function addCounts(
  ctx: MutationCtx,
  userId: string,
  feedId: Id<"feeds">,
  delta: Partial<Counts>,
) {
  const now = Date.now();
  const row = await ctx.db
    .query("feedStats")
    .withIndex("by_user_feed", (q) =>
      q.eq("userId", userId).eq("feedId", feedId),
    )
    .unique();
  const next = {
    offered: (row?.offered ?? 0) + (delta.offered ?? 0),
    opened: (row?.opened ?? 0) + (delta.opened ?? 0),
    finished: (row?.finished ?? 0) + (delta.finished ?? 0),
    skipped: (row?.skipped ?? 0) + (delta.skipped ?? 0),
    updatedAt: now,
  };
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("feedStats", { userId, feedId, ...next });
}

/**
 * Counts one interaction toward its article's feed, in the same transaction
 * that inserted it. Convex serializes conflicting mutations (a loser retries
 * on fresh data), so concurrent interactions on one feed cannot lose an
 * increment. Call it right after every insert into articleInteractions.
 */
export async function countFeedOutcome(
  ctx: MutationCtx,
  article: Doc<"articles">,
  interactionId: Id<"articleInteractions">,
) {
  const interaction = await ctx.db.get(interactionId);
  const outcome = interaction && outcomeOf(interaction.action);
  if (
    !interaction ||
    !outcome ||
    !article.feedId ||
    interaction.userId !== article.userId
  )
    return;
  const state = await ctx.db
    .query("feedStatsBackfill")
    .withIndex("by_user", (q) => q.eq("userId", interaction.userId))
    .unique();
  if (!state) {
    // History before this interaction is the backfill's; this one and every
    // later one are counted live
    await ctx.db.insert("feedStatsBackfill", {
      userId: interaction.userId,
      cutoff: interaction._creationTime,
      ready: false,
    });
    await ctx.scheduler.runAfter(0, internal.feedStats.backfill, {
      userId: interaction.userId,
    });
  }
  await addCounts(ctx, interaction.userId, article.feedId, { [outcome]: 1 });
}

/**
 * Counts a reader's earlier interactions into feedStats in small, resumable
 * pages. Idempotent: the cursor advances in the same transaction as the
 * counts, and a finished backfill does nothing.
 */
export const backfill = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    if (!(await libraryIsActive(ctx, userId))) return;
    let state = await ctx.db
      .query("feedStatsBackfill")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (state?.ready) return;
    if (!state) {
      const id = await ctx.db.insert("feedStatsBackfill", {
        userId,
        cutoff: Date.now(),
        ready: false,
      });
      state = await ctx.db.get(id);
    }
    if (!state) return;
    const page = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) =>
        q.eq("userId", userId).lt("_creationTime", state.cutoff),
      )
      .paginate({ cursor: state.cursor ?? null, numItems: BACKFILL_PAGE });
    const feeds = new Map<Id<"articles">, Id<"feeds"> | undefined>();
    const deltas = new Map<Id<"feeds">, Partial<Counts>>();
    for (const interaction of page.page) {
      const outcome = outcomeOf(interaction.action);
      if (!outcome) continue;
      if (!feeds.has(interaction.articleId)) {
        const article = await ctx.db.get(interaction.articleId);
        // Deleted articles keep their history rows but have no feed to credit
        feeds.set(
          interaction.articleId,
          article?.userId === userId ? article.feedId : undefined,
        );
      }
      const feedId = feeds.get(interaction.articleId);
      if (!feedId) continue;
      const delta = deltas.get(feedId) ?? {};
      delta[outcome] = (delta[outcome] ?? 0) + 1;
      deltas.set(feedId, delta);
    }
    for (const [feedId, delta] of deltas)
      await addCounts(ctx, userId, feedId, delta);
    await ctx.db.patch(state._id, {
      cursor: page.continueCursor,
      ready: page.isDone,
    });
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.feedStats.backfill, { userId });
  },
});
