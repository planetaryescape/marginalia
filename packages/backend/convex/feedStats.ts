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

// Most opens of one article and session read when a counter is first built
// from history. Past it the opens are left undecided rather than miscounted.
const INIT_LIMIT = 1000;

/**
 * How many feed opens the `opened` interaction adds (0 or 1, or more when it
 * is the first touch of a key whose undecided history is decided with it), or
 * undefined when it cannot be decided yet.
 *
 * A desk open (no visitId) and the reader page's first checkpoint (a visitId)
 * are one open, so for each reader, article and session (no session is its own
 * key) the opens counted are max(desk, visit) whatever order rows arrive in.
 * `feedOpenCounts` holds the two numbers and the feed gains one when the larger
 * rises: exact and O(1).
 *
 * Invariant: where a counter row exists it includes every `opened` row of its
 * key that is marked `feedCounted`. A row is never in two counters or counted
 * twice, because the marker is set in the same transaction as the tally.
 *
 * History: a key's counter is built from its own rows the first time the key
 * is touched, in creation order, in the same transaction. Rows already marked
 * (decided before the counters existed) only enter the tally, since feedStats
 * already includes them; unmarked rows are decided as they are tallied. This
 * is chosen over a per-reader backfill with a fall-back to the old window
 * because it needs no readiness state, is exact immediately and for any
 * interleaving with the feedStats backfill, and untouched keys cost nothing.
 * Its one cost is reading a key's rows once; past INIT_LIMIT it declines.
 */
async function settleOpen(
  ctx: MutationCtx,
  interaction: Doc<"articleInteractions">,
): Promise<number | undefined> {
  const { userId, articleId, sessionId } = interaction;
  const counter = await ctx.db
    .query("feedOpenCounts")
    .withIndex("by_key", (q) =>
      q
        .eq("userId", userId)
        .eq("articleId", articleId)
        .eq("sessionId", sessionId),
    )
    .unique();
  if (counter) {
    const isVisit = interaction.visitId !== undefined;
    const before = Math.max(counter.desk, counter.visit);
    const desk = counter.desk + (isVisit ? 0 : 1);
    const visit = counter.visit + (isVisit ? 1 : 0);
    await ctx.db.patch(counter._id, { desk, visit });
    await ctx.db.patch(interaction._id, { feedCounted: true });
    return Math.max(desk, visit) > before ? 1 : 0;
  }
  const history = await ctx.db
    .query("articleInteractions")
    .withIndex("by_user_article_action_session", (q) =>
      q
        .eq("userId", userId)
        .eq("articleId", articleId)
        .eq("action", "opened")
        .eq("sessionId", sessionId),
    )
    .take(INIT_LIMIT + 1);
  if (history.length > INIT_LIMIT) {
    console.error("feedStats: too many opens to build a counter", {
      articleId,
      sessionId,
    });
    return undefined;
  }
  let desk = 0;
  let visit = 0;
  let added = 0;
  for (const row of history) {
    const before = Math.max(desk, visit);
    if (row.visitId === undefined) desk++;
    else visit++;
    if (!row.feedCounted) {
      await ctx.db.patch(row._id, { feedCounted: true });
      if (Math.max(desk, visit) > before) added++;
    }
  }
  await ctx.db.insert("feedOpenCounts", {
    userId,
    articleId,
    sessionId,
    desk,
    visit,
  });
  return added;
}

/**
 * Whether a visit's finish is a new outcome. A visit retried across midnight
 * is recorded once per day; only the first one decided counts, found with one
 * indexed lookup rather than a window, so it holds however many rows the
 * visit has. The caller has already marked this row, so it is excluded by id.
 */
async function isNewFinish(
  ctx: MutationCtx,
  interaction: Doc<"articleInteractions">,
) {
  if (interaction.visitId === undefined) return true;
  const decided = await ctx.db
    .query("articleInteractions")
    .withIndex("by_user_article_action_visit_counted", (q) =>
      q
        .eq("userId", interaction.userId)
        .eq("articleId", interaction.articleId)
        .eq("action", "finished")
        .eq("visitId", interaction.visitId)
        .eq("feedCounted", true),
    )
    .take(2);
  return decided.every((row) => row._id === interaction._id);
}

/** Decides one unmarked interaction and marks it. Returns how much it adds. */
async function decide(
  ctx: MutationCtx,
  interaction: Doc<"articleInteractions">,
): Promise<number | undefined> {
  if (interaction.action === "opened") return settleOpen(ctx, interaction);
  await ctx.db.patch(interaction._id, { feedCounted: true });
  if (interaction.action === "finished")
    return (await isNewFinish(ctx, interaction)) ? 1 : 0;
  return 1;
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
    interaction.userId !== article.userId ||
    // Not while the library is being deleted: the purge may already be past
    // these tables
    !(await libraryIsActive(ctx, interaction.userId))
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
  const added = await decide(ctx, interaction);
  if (added)
    await addCounts(ctx, interaction.userId, article.feedId, {
      [outcome]: added,
    });
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
    for (const seen of page.page) {
      // Re-read: an earlier open in this page may have decided it with its key
      const interaction = await ctx.db.get(seen._id);
      const outcome = interaction && outcomeOf(interaction.action);
      if (!interaction || !outcome || interaction.feedCounted) continue;
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
      const added = await decide(ctx, interaction);
      if (added) await addCounts(ctx, userId, feedId, { [outcome]: added });
    }
    await ctx.db.patch(state._id, {
      cursor: page.continueCursor,
      ready: page.isDone,
    });
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.feedStats.backfill, { userId });
  },
});
