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
// Most opens of one article that are compared when pairing them
const GROUP_LIMIT = 200;

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
 * Whether this interaction is a new outcome rather than the same event
 * recorded twice. The desk records an open before the reader page's first
 * checkpoint records the visit's, so within one article and session the two
 * kinds pair off in time order, and only the larger kind adds to the count.
 * A visit's finish retried across midnight is recorded once per day; only the
 * first counts. Decided from stored rows alone, so the live path and the
 * backfill reach the same answer.
 */
async function isNewOutcome(
  ctx: MutationCtx,
  interaction: Doc<"articleInteractions">,
) {
  if (interaction.action !== "opened" && interaction.action !== "finished")
    return true;
  const same = await ctx.db
    .query("articleInteractions")
    .withIndex("by_user_article_action", (q) =>
      q
        .eq("userId", interaction.userId)
        .eq("articleId", interaction.articleId)
        .eq("action", interaction.action),
    )
    .take(GROUP_LIMIT);
  const at = same.findIndex((row) => row._id === interaction._id);
  // Beyond the window nothing is paired; counting it is the safer error
  if (at === -1) return true;
  if (interaction.action === "finished") {
    if (interaction.visitId === undefined) return true;
    return !same
      .slice(0, at)
      .some((row) => row.visitId === interaction.visitId);
  }
  const session = same.filter((row) => row.sessionId === interaction.sessionId);
  const position = session.findIndex((row) => row._id === interaction._id);
  const isVisit = interaction.visitId !== undefined;
  const kind = (row: Doc<"articleInteractions">) =>
    (row.visitId !== undefined) === isVisit;
  const rank = session.slice(0, position + 1).filter(kind).length;
  const otherBefore = session.slice(0, position).filter((r) => !kind(r)).length;
  return rank > otherBefore;
}

/**
 * Counts one interaction toward its article's feed, in the same transaction
 * that inserted it. Convex serializes conflicting mutations (a loser retries
 * on fresh data), so concurrent interactions on one feed cannot lose an
 * increment. Call it right after every insert into articleInteractions.
 *
 * `feedCounted` is set in the same transaction as the increment, so each
 * interaction is decided by exactly one path, whichever reaches it first. A
 * marker rather than a time cutoff because Convex creation times do not
 * follow commit order.
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
    interaction.feedCounted ||
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
    await ctx.db.insert("feedStatsBackfill", {
      userId: interaction.userId,
      ready: false,
    });
    await ctx.scheduler.runAfter(0, internal.feedStats.backfill, {
      userId: interaction.userId,
    });
  }
  await ctx.db.patch(interaction._id, { feedCounted: true });
  if (await isNewOutcome(ctx, interaction))
    await addCounts(ctx, interaction.userId, article.feedId, { [outcome]: 1 });
}

/**
 * Counts a reader's interactions that no path has decided yet into feedStats,
 * in small resumable pages. Idempotent: it skips marked interactions, so a
 * re-run, a concurrent run or one that overlaps live counting adds nothing.
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
        ready: false,
      });
      state = await ctx.db.get(id);
    }
    if (!state) return;
    const page = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .paginate({ cursor: state.cursor ?? null, numItems: BACKFILL_PAGE });
    const feeds = new Map<Id<"articles">, Id<"feeds"> | undefined>();
    for (const interaction of page.page) {
      const outcome = outcomeOf(interaction.action);
      if (!outcome || interaction.feedCounted) continue;
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
      await ctx.db.patch(interaction._id, { feedCounted: true });
      if (await isNewOutcome(ctx, interaction))
        await addCounts(ctx, userId, feedId, { [outcome]: 1 });
    }
    await ctx.db.patch(state._id, {
      cursor: page.continueCursor,
      ready: page.isDone,
    });
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.feedStats.backfill, { userId });
  },
});
