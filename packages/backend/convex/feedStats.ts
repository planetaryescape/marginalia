import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
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

// Held to a few rows because each page reads full articles (up to 1 MiB of
// text each) and full interactions (annotationsOpened can be large), against a
// 16 MiB read limit per transaction. Every phase reads at most this many rows,
// plus at most two more for a finish's lookup.
const REBUILD_PAGE = 4;
// Bump to make every reader's counts be rebuilt under new counting rules
export const REBUILD_VERSION = 2;

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
 * How many feed opens the `opened` interaction adds (0 or 1).
 *
 * A desk open (no visitId) and the reader page's first checkpoint (a visitId)
 * are one open, so for each reader, article and session (no session is its own
 * key) the opens counted are max(desk, visit) whatever order rows arrive in.
 * `feedOpenCounts` holds the two numbers and the feed gains one when the larger
 * rises: exact and O(1).
 *
 * The counters are complete by construction: they are cleared with the
 * markers and fed only by decided rows, so a counter always equals the tally
 * of the marked `opened` rows of its key. Nothing is ever initialised from
 * history here; history is counted by the rebuild.
 */
async function settleOpen(
  ctx: MutationCtx,
  interaction: Doc<"articleInteractions">,
) {
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
  const isVisit = interaction.visitId !== undefined;
  const desk = (counter?.desk ?? 0) + (isVisit ? 0 : 1);
  const visit = (counter?.visit ?? 0) + (isVisit ? 1 : 0);
  const before = counter ? Math.max(counter.desk, counter.visit) : 0;
  if (counter) await ctx.db.patch(counter._id, { desk, visit });
  else
    await ctx.db.insert("feedOpenCounts", {
      userId,
      articleId,
      sessionId,
      desk,
      visit,
    });
  await ctx.db.patch(interaction._id, { feedCounted: true });
  return Math.max(desk, visit) > before ? 1 : 0;
}

/**
 * Whether a visit's finish is a new outcome. A visit retried across midnight
 * is recorded once per day; only the first one decided counts, found with one
 * indexed lookup rather than a window, so it holds however many rows the
 * visit has. The caller has already marked this row, so it is excluded by id.
 * The first row marked for a visit is always the one credited, because markers
 * are cleared with the counts and set only by this code.
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
) {
  if (interaction.action === "opened") return settleOpen(ctx, interaction);
  await ctx.db.patch(interaction._id, { feedCounted: true });
  if (interaction.action === "finished")
    return (await isNewFinish(ctx, interaction)) ? 1 : 0;
  return 1;
}

/**
 * A reader's per-feed counts for anything that decides something from them
 * (suggestions, taste, reporting). While their rebuild is not ready at the
 * current version the stored counts are zero, partial or from older rules, so
 * they read as "no data yet", like a feed with no history. A reader with no
 * rebuild state has had no interaction counted, so there is nothing to hide.
 */
export async function readableFeedStats(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  limit: number,
) {
  const state = await ctx.db
    .query("feedStatsBackfill")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (state && !(state.ready && state.version === REBUILD_VERSION)) return [];
  return ctx.db
    .query("feedStats")
    .withIndex("by_user_feed", (q) => q.eq("userId", userId))
    .take(limit);
}

/** The state of a reader's counts, started fresh for the current rules. */
const freshState = (userId: string, ready: boolean) => ({
  userId,
  version: REBUILD_VERSION,
  phase: "stats" as const,
  ready,
});

// A rebuild step that has not run this long after it was scheduled is taken to
// be lost (its reader was disabled when it ran, say) and is scheduled again
const STALE_MS = 60_000;

/** Stops a step that has not started yet; one that has cannot be stopped. */
async function cancelStep(
  ctx: MutationCtx,
  jobId: Id<"_scheduled_functions"> | undefined,
) {
  if (!jobId) return;
  const job = await ctx.db.system.get(jobId);
  if (job?.state.kind === "pending") await ctx.scheduler.cancel(jobId);
}

/**
 * Schedules the reader's next rebuild step and makes it the only one: the
 * state row takes a fresh `stepToken`, which the step must present, and the
 * step scheduled before is cancelled. A step that is already running, or one
 * that cannot be cancelled in time, finds a token that is no longer current
 * and stops without doing work or scheduling anything, so however often a
 * step is scheduled (the chain, a reactivation, a stall) there is one chain.
 */
async function scheduleStep(ctx: MutationCtx, state: Doc<"feedStatsBackfill">) {
  await cancelStep(ctx, state.stepJobId);
  const stepToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stepJobId = await ctx.scheduler.runAfter(
    0,
    internal.feedStats.backfill,
    { userId: state.userId, token: stepToken },
  );
  await ctx.db.patch(state._id, {
    stepToken,
    stepJobId,
    scheduledAt: Date.now(),
  });
}

/**
 * Starts the next rebuild step if the reader's rebuild is not ready, whatever
 * became of the one scheduled before (`force`), or only when none looks to be
 * on its way. `scheduledAt` is written with each step scheduled, in a row every
 * caller reads and writes, so concurrent callers schedule one between them.
 */
async function ensureRebuildRunning(
  ctx: MutationCtx,
  state: Doc<"feedStatsBackfill">,
  force: boolean,
) {
  if (
    state.ready ||
    (!force &&
      state.scheduledAt !== undefined &&
      Date.now() - state.scheduledAt < STALE_MS)
  )
    return;
  await scheduleStep(ctx, state);
}

/**
 * For a library that has just become active again: a rebuild that stopped
 * when it was disabled has nothing scheduled to continue it.
 */
export async function resumeRebuild(ctx: MutationCtx, userId: string) {
  const state = await ctx.db
    .query("feedStatsBackfill")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (state && state.version === REBUILD_VERSION)
    await ensureRebuildRunning(ctx, state, true);
}

/** Replaces a reader's state with a fresh one and starts its rebuild. */
async function restartRebuild(
  ctx: MutationCtx,
  userId: string,
  state: Doc<"feedStatsBackfill"> | null,
) {
  await cancelStep(ctx, state?.stepJobId);
  let id = state?._id;
  if (id) await ctx.db.replace(id, freshState(userId, false));
  else id = await ctx.db.insert("feedStatsBackfill", freshState(userId, false));
  const fresh = await ctx.db.get(id);
  if (fresh) await scheduleStep(ctx, fresh);
}

/**
 * Counts one interaction toward its article's feed, in the same transaction
 * that inserted it. Convex serializes conflicting mutations (a loser retries
 * on fresh data), so concurrent interactions on one feed cannot lose an
 * increment. Call it right after every insert into articleInteractions.
 *
 * Only a reader whose counts are rebuilt (`ready` at the current version)
 * is counted live. Before that the row is left unmarked for the rebuild, which
 * counts every unmarked row it reaches; a row the rebuild's cursor has already
 * passed sets `dirty`, so the rebuild makes another pass before it is ready.
 * Both writes are to the state row the rebuild also reads and writes, so the
 * database orders them: a live row either sees `ready` or is seen by the
 * rebuild. `feedCounted` is set in the same transaction as the increment, so
 * each interaction is decided exactly once by whichever path reaches it first.
 * A marker rather than a time cutoff because Convex creation times do not
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
  if (!state || state.version !== REBUILD_VERSION) {
    // A reader with nothing else recorded has no history to rebuild
    const first =
      !state &&
      (
        await ctx.db
          .query("articleInteractions")
          .withIndex("by_user", (q) => q.eq("userId", interaction.userId))
          .take(2)
      ).length === 1;
    if (!first) {
      await restartRebuild(ctx, interaction.userId, state);
      return;
    }
    await ctx.db.insert(
      "feedStatsBackfill",
      freshState(interaction.userId, true),
    );
  } else if (!state.ready) {
    if (
      state.seen !== undefined &&
      interaction._creationTime <= state.seen &&
      !state.dirty
    )
      await ctx.db.patch(state._id, { dirty: true });
    await ensureRebuildRunning(ctx, state, false);
    return;
  }
  const added = await decide(ctx, interaction);
  if (added)
    await addCounts(ctx, interaction.userId, article.feedId, {
      [outcome]: added,
    });
}

/**
 * Rebuilds a reader's feedStats from their interactions under the current
 * rules, in small resumable steps. feedStats is derived data, so the old
 * counts and decisions are discarded rather than reconciled: phases clear
 * feedStats, clear feedOpenCounts, clear every `feedCounted` marker, then count
 * all interactions in creation order. Re-running, running twice at once or
 * resuming adds nothing, because each step reads its progress from the state
 * row and each counted interaction is marked in the same transaction.
 * A state from an older version starts the rebuild over. While it runs, live
 * interactions are left for it to count (see countFeedOutcome).
 */
export const backfill = internalMutation({
  args: { userId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, { userId, token }) => {
    if (!(await libraryIsActive(ctx, userId))) return;
    let state = await ctx.db
      .query("feedStatsBackfill")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // A step that is no longer the current one was superseded by a newer
    // schedule, which owns the chain. A call with no token is a start (the
    // fan-out, a test) and takes the chain over when it schedules its successor.
    if (token !== undefined && token !== state?.stepToken) return;
    if (state && state.version !== REBUILD_VERSION) {
      await cancelStep(ctx, state.stepJobId);
      await ctx.db.replace(state._id, freshState(userId, false));
      state = await ctx.db.get(state._id);
    } else if (!state) {
      const id = await ctx.db.insert(
        "feedStatsBackfill",
        freshState(userId, false),
      );
      state = await ctx.db.get(id);
    }
    if (!state || state.ready) return;
    const current = state;
    const next = () => scheduleStep(ctx, current);

    if (state.phase === "stats" || state.phase === undefined) {
      const rows = await ctx.db
        .query("feedStats")
        .withIndex("by_user_feed", (q) => q.eq("userId", userId))
        .take(REBUILD_PAGE);
      for (const row of rows) await ctx.db.delete(row._id);
      if (rows.length < REBUILD_PAGE)
        await ctx.db.patch(state._id, { phase: "counts" });
      await next();
      return;
    }
    if (state.phase === "counts") {
      const rows = await ctx.db
        .query("feedOpenCounts")
        .withIndex("by_key", (q) => q.eq("userId", userId))
        .take(REBUILD_PAGE);
      for (const row of rows) await ctx.db.delete(row._id);
      if (rows.length < REBUILD_PAGE)
        await ctx.db.patch(state._id, { phase: "markers" });
      await next();
      return;
    }
    const page = await ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .paginate({ cursor: state.cursor ?? null, numItems: REBUILD_PAGE });
    if (state.phase === "markers") {
      for (const row of page.page)
        if (row.feedCounted !== undefined)
          await ctx.db.patch(row._id, { feedCounted: undefined });
      await ctx.db.patch(
        state._id,
        page.isDone
          ? { phase: "count", cursor: undefined }
          : { cursor: page.continueCursor },
      );
      await next();
      return;
    }
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
      const added = await decide(ctx, interaction);
      if (added) await addCounts(ctx, userId, feedId, { [outcome]: added });
    }
    const last = page.page.at(-1);
    if (!page.isDone) {
      await ctx.db.patch(state._id, {
        cursor: page.continueCursor,
        seen: last?._creationTime ?? state.seen,
      });
      await next();
    } else if (state.dirty) {
      // A live row arrived behind the cursor: pass over the history again
      await ctx.db.patch(state._id, {
        cursor: undefined,
        seen: undefined,
        dirty: undefined,
      });
      await next();
    } else {
      await ctx.db.patch(state._id, {
        ready: true,
        cursor: undefined,
        seen: undefined,
      });
    }
  },
});
