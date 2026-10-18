// Indexes an imported book once it is readable (D-DES-054, D-DES-055):
// short summaries and searchable passages in one fair, paced queue. The
// one point still waits for all summaries to settle.
// The outline fills in as the summaries land.
//
// It follows the catch-up's pacing (catchUp.ts): at most BATCH_JOBS jobs a
// batch, BATCH_DELAY_MS between batches, JOB_STAGGER_MS between the jobs of a
// batch. A unit's job is claimed by writing its bookIndexUnits row "pending"
// in the mutation that schedules it, so a restart or a second run never
// schedules it twice; a claim that outlives CLAIM_TTL_MS is taken as lost.
// Resumable and idempotent: rows already done are skipped.
//
//   bunx convex run bookIndex:backfill '{"userId":"default_user"}'
//   bunx convex run bookIndex:status '{"userId":"default_user"}'
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { libraryIsActive, ownedArticle } from "./access";
import { BATCH_DELAY_MS, JOB_STAGGER_MS } from "./catchUp";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./functions";
import {
  BATCH_JOBS,
  CLAIM_TTL_MS,
  fairBatch,
  INDEX_UNIT_CAP,
  MAX_ATTEMPTS,
  MAX_PASSAGES_PER_UNIT,
  MAX_PAUSES,
  MAX_UNIT_FAILURES,
  STALE_MS,
} from "./lib/bookIndex";
import { embeddingProvider } from "./lib/providers";
import { readerProviders } from "./lib/readerAI";
import { spendReaderLimit } from "./limits";

type Db = Pick<QueryCtx, "db">;
type Stage = Doc<"bookIndexUnits">["stage"];
type Phase = Doc<"bookIndexState">["phase"];
type UnitJob = { index: number; attempts: number };
interface UnitLanes {
  summary: UnitJob[];
  passages: UnitJob[];
}

/** Retry after the reader's hourly indexing budget runs out. */
const LIMIT_RETRY_MS = 10 * 60_000;
/** Books a backfill starts for one library. */
const BACKFILL_BOOKS = 200;
/** Rows deleted or read per call where each carries a vector. */
const PASSAGE_BATCH = 100;

function stateRow(ctx: Db, userId: string, articleId: Id<"articles">) {
  return ctx.db
    .query("bookIndexState")
    .withIndex("by_userId_and_articleId", (q) =>
      q.eq("userId", userId).eq("articleId", articleId),
    )
    .unique();
}

function bookRow(ctx: Db, userId: string, articleId: Id<"articles">) {
  return ctx.db
    .query("books")
    .withIndex("by_userId_and_articleId", (q) =>
      q.eq("userId", userId).eq("articleId", articleId),
    )
    .unique();
}

function indexRow(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  stage: Stage,
  unitIndex: number,
) {
  return ctx.db
    .query("bookIndexUnits")
    .withIndex("by_userId_and_articleId_and_stage_and_unitIndex", (q) =>
      q
        .eq("userId", userId)
        .eq("articleId", articleId)
        .eq("stage", stage)
        .eq("unitIndex", unitIndex),
    )
    .unique();
}

/**
 * Whether a book may still be written to: its library is active (a reader
 * being deleted is disabled first), and the article, its book row and its text
 * exist. Every write of indexing checks this in its own transaction, so a job
 * that outlives its reader or its book writes nothing.
 */
async function liveBook(ctx: Db, userId: string, articleId: Id<"articles">) {
  if (!(await libraryIsActive(ctx, userId))) return null;
  const article = await ownedArticle(ctx, articleId, userId);
  if (!article?.bookOutline) return null;
  return bookRow(ctx, userId, articleId);
}

/**
 * Summaries need text credentials; passages only need embedding credentials.
 * A missing key blocks that lane, not independently useful work in the other.
 */
async function keysFor(
  ctx: Db,
  userId: string,
): Promise<Record<Stage, "no_key" | undefined>> {
  const { providers } = await readerProviders(ctx, userId);
  return {
    summary: providers.length ? undefined : "no_key",
    passages: embeddingProvider(providers) ? undefined : "no_key",
  };
}

/** A failed unit that may still be tried, in a later run. */
const isRecoverable = (
  row: Pick<Doc<"bookIndexUnits">, "status" | "failures">,
) => row.status === "failed" && (row.failures ?? 0) < MAX_UNIT_FAILURES;

type Verdict = "queue" | "wait" | "skip" | "give_up";

/** What a unit's row says about whether its job should be queued now. */
export function verdictFor(
  row: Pick<Doc<"bookIndexUnits">, "status" | "claimedAt" | "attempts"> | null,
  now: number,
): Verdict {
  if (!row) return "queue";
  switch (row.status) {
    case "done":
    case "skipped":
      return "skip";
    case "failed":
      return row.attempts < MAX_ATTEMPTS ? "queue" : "skip";
    case "pending":
      if (now - row.claimedAt < CLAIM_TTL_MS) return "wait";
      return row.attempts < MAX_ATTEMPTS ? "queue" : "give_up";
  }
}

/**
 * Gives the book's failed units a fresh run's tries, if they haven't failed
 * too often, and returns the earliest stage that has any (summaries before
 * passages), or null. A refused key never counted against a unit.
 */
async function reviveFailed(
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
): Promise<Stage | null> {
  let earliest: Stage | null = null;
  for (const stage of ["summary", "passages"] as const) {
    const rows = await ctx.db
      .query("bookIndexUnits")
      .withIndex("by_userId_and_articleId_and_stage_and_unitIndex", (q) =>
        q.eq("userId", userId).eq("articleId", articleId).eq("stage", stage),
      )
      .take(INDEX_UNIT_CAP + 1);
    for (const row of rows.filter(isRecoverable)) {
      earliest ??= stage;
      if (row.attempts)
        await ctx.db.patch("bookIndexUnits", row._id, { attempts: 0 });
    }
  }
  return earliest;
}

/** Starts a book's indexing, resumes one that stopped or lost its schedule, or leaves a live one alone. */
export const start = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    const book = article?.bookOutline
      ? await bookRow(ctx, args.userId, args.articleId)
      : null;
    if (!article || !book) return "not started: no such book";
    if (!(await libraryIsActive(ctx, args.userId)))
      return "not started: inactive library";
    const now = Date.now();
    const row = await stateRow(ctx, args.userId, args.articleId);
    // Repeated starts must not refund/reset live work or replace its run.
    if (row?.running) {
      if (row.summaryBlocked || row.passagesBlocked) {
        // A key can be saved while the independent lane is still running.
        // Preserve in-flight paid claims; only old credential pauses expire.
        await ctx.db.patch("bookIndexState", row._id, {
          summaryBlocked: undefined,
          passagesBlocked: undefined,
          pauseFloor: (row.lastClaim ?? now) + 1,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(0, internal.bookIndex.step, {
          ...args,
          runId: row.runId,
        });
        return "resumed";
      }
      if (now - row.updatedAt < STALE_MS) return "already running";
      await ctx.db.patch("bookIndexState", row._id, { updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.bookIndex.step, {
        ...args,
        runId: row.runId,
      });
      return "resumed";
    }
    // Failed units get a fresh run's tries, unless they have failed too often
    const revived = await reviveFailed(ctx, args.userId, args.articleId);
    if (row?.phase === "done" && !revived) return "already indexed";
    const phase: Phase = revived
      ? revived === "summary"
        ? "summaries"
        : "passages"
      : (row?.phase ?? "summaries");
    const keys = await keysFor(ctx, args.userId);
    if (keys.summary && keys.passages)
      return "not started: the library needs a key for this step";
    const lastClaim =
      row?.lastClaim ??
      Math.max(
        row?.pointClaimedAt ?? 0,
        ...(await laneRows(ctx, args.userId, args.articleId, "summary")).map(
          (unit) => unit.claimedAt,
        ),
        ...(await laneRows(ctx, args.userId, args.articleId, "passages")).map(
          (unit) => unit.claimedAt,
        ),
      );
    const keyResume = row?.pausedReason !== undefined;
    const fields = {
      running: true,
      runId: keyResume ? row.runId : (row?.runId ?? 0) + 1,
      phase,
      cursor: 0,
      pointAttempts: revived === "summary" ? 0 : (row?.pointAttempts ?? 0),
      pointClaimedAt: keyResume ? row.pointClaimedAt : undefined,
      protocol: 2 as const,
      nextLane: row?.nextLane ?? "summary",
      claimFloor: keyResume ? row.claimFloor : Math.max(now, lastClaim + 1),
      pauseFloor: lastClaim + 1,
      lastClaim,
      // Never bypass a pacing window when resuming or restarting.
      nextBatchAt:
        row?.nextBatchAt ?? (row ? row.updatedAt + BATCH_DELAY_MS : now),
      overviewDone:
        revived === "summary"
          ? false
          : (row?.overviewDone ??
            (row?.phase === "passages" || row?.phase === "done")),
      summaryBlocked: undefined,
      passagesBlocked: undefined,
      pausedReason: undefined,
      recoverable: undefined,
      updatedAt: now,
      finishedAt: undefined,
    };
    if (row) await ctx.db.patch("bookIndexState", row._id, fields);
    else
      await ctx.db.insert("bookIndexState", {
        userId: args.userId,
        articleId: args.articleId,
        queued: 0,
        startedAt: now,
        ...fields,
      });
    await ctx.scheduler.runAfter(0, internal.bookIndex.step, {
      ...args,
      runId: fields.runId,
    });
    return "started";
  },
});

/**
 * Schedules a start for each of the library's books that isn't indexed, one
 * after another BATCH_DELAY_MS apart, and returns how many. Saving a key calls
 * this with `respectCap`, so a library whose keys keep failing isn't resumed
 * for ever; the backfill command does not.
 */
export async function resumeBooks(
  ctx: MutationCtx,
  userId: string,
  { respectCap }: { respectCap: boolean },
): Promise<{ scheduled: number; books: number }> {
  const books = await ctx.db
    .query("books")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(BACKFILL_BOOKS);
  let scheduled = 0;
  for (const book of books) {
    const row = await stateRow(ctx, userId, book.articleId);
    if (row?.phase === "done" && !row.recoverable) continue;
    if (respectCap && (row?.failures ?? 0) >= MAX_PAUSES) continue;
    await ctx.scheduler.runAfter(
      scheduled === 0 ? 0 : scheduled * BATCH_DELAY_MS,
      internal.bookIndex.start,
      { userId, articleId: book.articleId },
    );
    scheduled++;
  }
  return { scheduled, books: books.length };
}

/** Queues indexing for books already imported, one book after another. */
export const backfill = internalMutation({
  args: { userId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { scheduled, books } = await resumeBooks(ctx, args.userId, {
      respectCap: false,
    });
    return `scheduled ${scheduled} of ${books} books`;
  },
});

async function laneRows(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  stage: Stage,
) {
  return ctx.db
    .query("bookIndexUnits")
    .withIndex("by_userId_and_articleId_and_stage_and_unitIndex", (q) =>
      q.eq("userId", userId).eq("articleId", articleId).eq("stage", stage),
    )
    .take(INDEX_UNIT_CAP);
}

const settledRow = (row: Doc<"bookIndexUnits">) =>
  row.status === "done" ||
  row.status === "skipped" ||
  (row.status === "failed" && row.attempts >= MAX_ATTEMPTS);

/** Both lanes share this single transaction and persisted pacing gate. Old
 * queued steps safely join it; duplicate steps cannot open another pool. */
export const step = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    runId: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await stateRow(ctx, args.userId, args.articleId);
    if (!state?.running || state.runId !== args.runId) return null;
    const now = Date.now();
    const patch = (fields: Partial<Doc<"bookIndexState">>) =>
      ctx.db.patch("bookIndexState", state._id, { updatedAt: now, ...fields });
    const next = (delayMs: number) =>
      ctx.scheduler.runAfter(delayMs, internal.bookIndex.step, args);

    const book = await liveBook(ctx, args.userId, args.articleId);
    // Checked every batch: a left reader or a gone book stops the run, and a
    // removed key pauses it until one is saved
    if (!book || state.phase === "done") {
      await patch({ running: false, pointClaimedAt: undefined });
      return null;
    }
    if (state.protocol !== 2) {
      // Keep old pending claims and a claimed overview intact. Do not redo
      // successful work or schedule alongside the last legacy five-job batch.
      const nextBatchAt = state.queued ? state.updatedAt + BATCH_DELAY_MS : now;
      await patch({
        protocol: 2,
        overviewDone: state.phase === "passages",
        nextLane: "summary",
        nextBatchAt,
        lastClaim: Math.max(
          state.pointClaimedAt ?? 0,
          ...(await laneRows(ctx, args.userId, args.articleId, "summary")).map(
            (row) => row.claimedAt,
          ),
          ...(await laneRows(ctx, args.userId, args.articleId, "passages")).map(
            (row) => row.claimedAt,
          ),
        ),
      });
      await next(Math.max(0, nextBatchAt - now));
      return null;
    }
    if ((state.nextBatchAt ?? 0) > now) {
      await next((state.nextBatchAt ?? now) - now);
      return null;
    }
    const end = Math.min(book.unitCount, INDEX_UNIT_CAP);
    const lanes = {
      summary: await laneRows(ctx, args.userId, args.articleId, "summary"),
      passages: await laneRows(ctx, args.userId, args.articleId, "passages"),
    };
    const keys = await keysFor(ctx, args.userId);
    const reasons = {
      summary: state.summaryBlocked ?? keys.summary,
      passages: state.passagesBlocked ?? keys.passages,
    };
    const candidates: UnitLanes = { summary: [], passages: [] };
    const settled = { summary: false, passages: false };
    for (const stage of ["summary", "passages"] as const) {
      const rows = lanes[stage].filter((row) => row.unitIndex < end);
      const byIndex = new Map(rows.map((row) => [row.unitIndex, row]));
      for (let index = 0; index < end; index++) {
        const row = byIndex.get(index) ?? null;
        const verdict = verdictFor(row, now);
        if (verdict === "give_up" && row) {
          await ctx.db.patch("bookIndexUnits", row._id, {
            status: "failed",
            failures: (row.failures ?? 0) + 1,
          });
          row.status = "failed";
        }
        if (!reasons[stage] && verdict === "queue")
          candidates[stage].push({ index, attempts: row?.attempts ?? 0 });
      }
      settled[stage] = rows.filter(settledRow).length === end;
    }
    let overviewDone = state.overviewDone ?? false;
    const phase: Phase = !settled.summary
      ? "summaries"
      : overviewDone
        ? "passages"
        : "point";
    const { jobs, nextLane } = fairBatch(
      candidates,
      state.nextLane ?? "summary",
    );
    let turn = nextLane;
    // The overview is another job in the same envelope, never a side pool.
    const pointLive =
      state.pointClaimedAt !== undefined &&
      now - state.pointClaimedAt < CLAIM_TTL_MS;
    if (settled.summary && !overviewDone && !pointLive) {
      if (
        state.pointAttempts >= MAX_ATTEMPTS ||
        !lanes.summary.some((row) => row.status === "done")
      )
        overviewDone = true;
      else if (!reasons.summary) {
        // Reserve one existing slot; unit fairness carries into the next batch.
        if (jobs.length === BATCH_JOBS) {
          const lent = jobs.pop();
          if (lent) turn = lent.stage;
        }
      }
    }
    const queuePoint =
      settled.summary && !overviewDone && !pointLive && !reasons.summary;
    const total = jobs.length + Number(queuePoint);
    if (total) {
      // Nothing is claimed until the batch is allowed to run
      if (!(await spendReaderLimit(ctx, args.userId, "bookIndex"))) {
        await patch({});
        await next(LIMIT_RETRY_MS);
        return null;
      }
      const claim = Math.max(
        now,
        state.claimFloor ?? 0,
        (state.lastClaim ?? now - 1) + 1,
      );
      for (const [at, { stage, value: job }] of jobs.entries()) {
        const existing = await indexRow(
          ctx,
          args.userId,
          args.articleId,
          stage,
          job.index,
        );
        const fields = {
          status: "pending" as const,
          claimedAt: claim,
          attempts: job.attempts + 1,
        };
        if (existing)
          await ctx.db.patch("bookIndexUnits", existing._id, fields);
        else
          await ctx.db.insert("bookIndexUnits", {
            userId: args.userId,
            articleId: args.articleId,
            stage,
            unitIndex: job.index,
            ...fields,
          });
        const job_args = {
          articleId: args.articleId,
          unitIndex: job.index,
          userId: args.userId,
          runId: args.runId,
          claim,
        };
        await ctx.scheduler.runAfter(
          at * JOB_STAGGER_MS,
          stage === "summary"
            ? internal.actions.indexBook.summarizeUnit
            : internal.actions.indexBook.embedPassages,
          job_args,
        );
      }
      if (queuePoint) {
        await ctx.scheduler.runAfter(
          jobs.length * JOB_STAGGER_MS,
          internal.actions.indexBook.writeOverview,
          { ...args, claim },
        );
        await ctx.scheduler.runAfter(
          CLAIM_TTL_MS + 1_000,
          internal.bookIndex.pointWatchdog,
          { ...args, claim },
        );
      }
      await patch({
        phase: overviewDone
          ? settled.summary
            ? "passages"
            : "summaries"
          : phase,
        overviewDone,
        nextLane: turn,
        lastClaim: claim,
        pointAttempts: state.pointAttempts + Number(queuePoint),
        pointClaimedAt: queuePoint ? claim : state.pointClaimedAt,
        nextBatchAt: now + BATCH_DELAY_MS,
        cursor: 0,
        queued: state.queued + total,
      });
      await next(BATCH_DELAY_MS);
      return null;
    }
    if (settled.summary && settled.passages && overviewDone) {
      await patch({
        phase: "done",
        overviewDone,
        running: false,
        finishedAt: now,
        pausedReason: undefined,
        recoverable: [...lanes.summary, ...lanes.passages].filter(isRecoverable)
          .length,
      });
      return null;
    }
    const textWaiting = !settled.summary || !overviewDone;
    const blocked =
      !pointLive &&
      (!textWaiting || reasons.summary) &&
      (settled.passages || reasons.passages);
    await patch({
      phase: overviewDone && settled.summary ? "passages" : phase,
      overviewDone,
      running: !blocked,
      pausedReason: blocked ? (reasons.summary ?? reasons.passages) : undefined,
    });
    if (!blocked) await next(BATCH_DELAY_MS);
    return null;
  },
});

const pointArgs = {
  userId: v.string(),
  articleId: v.id("articles"),
  runId: v.number(),
  claim: v.number(),
};

/** The state row, if it is the current run waiting on this call for the point. */
async function pointState(
  ctx: Db,
  args: {
    userId: string;
    articleId: Id<"articles">;
    runId: number;
    claim: number;
  },
) {
  const state = await stateRow(ctx, args.userId, args.articleId);
  if (
    !state?.running ||
    state.runId !== args.runId ||
    state.phase !== "point" ||
    state.pointClaimedAt !== args.claim ||
    !(await liveBook(ctx, args.userId, args.articleId))
  )
    return null;
  return state;
}

/** The book's one point is written: on to the passages. */
export const pointWritten = internalMutation({
  args: {
    ...pointArgs,
    overview: v.optional(
      v.object({ thesis: v.string(), gist: v.string(), model: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await pointState(ctx, args);
    if (!state) return null;
    if (args.overview) {
      // Nested mutation shares this transaction: no stale overview can be
      // saved between claim validation and releasing the claim.
      await ctx.runMutation(internal.summaries.saveBookOverview, {
        userId: args.userId,
        articleId: args.articleId,
        ...args.overview,
      });
    }
    await ctx.db.patch("bookIndexState", state._id, {
      phase: "passages",
      overviewDone: true,
      cursor: 0,
      pointClaimedAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.bookIndex.step, {
      userId: args.userId,
      articleId: args.articleId,
      runId: args.runId,
    });
    return null;
  },
});

/** The call for the book's one point failed: the step tries again, up to its cap. */
export const pointFailed = internalMutation({
  args: pointArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await pointState(ctx, args);
    if (!state) return null;
    await ctx.db.patch("bookIndexState", state._id, {
      pointClaimedAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(BATCH_DELAY_MS, internal.bookIndex.step, {
      userId: args.userId,
      articleId: args.articleId,
      runId: args.runId,
    });
    return null;
  },
});

/**
 * Scheduled when a call for the point is, to run a TTL later. If that call is
 * still the current claim it was lost, so the claim is freed and the step
 * tries again within MAX_ATTEMPTS, or moves on keeping the part-1 point.
 */
export const pointWatchdog = internalMutation({
  args: pointArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await pointState(ctx, args);
    if (!state || Date.now() - args.claim < CLAIM_TTL_MS) return null;
    await ctx.db.patch("bookIndexState", state._id, {
      pointClaimedAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.bookIndex.step, {
      userId: args.userId,
      articleId: args.articleId,
      runId: args.runId,
    });
    return null;
  },
});

/**
 * A job found no usable key: block only its lane. The shared step stops once
 * no independent work remains. Saving a key resumes it, within MAX_PAUSES.
 */
export const pauseIndex = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    reason: v.union(v.literal("no_key"), v.literal("unusable_key")),
    stage: v.optional(
      v.union(v.literal("summary"), v.literal("passages"), v.literal("point")),
    ),
    runId: v.optional(v.number()),
    claim: v.optional(v.number()),
    unitIndex: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await stateRow(ctx, args.userId, args.articleId);
    if (!state?.running || !(await liveBook(ctx, args.userId, args.articleId)))
      return null;
    if (args.runId !== undefined && state.runId !== args.runId) return null;
    if (
      args.claim !== undefined &&
      args.claim < (state.pauseFloor ?? -Infinity)
    )
      return null;
    const stage =
      args.stage ??
      (state.phase === "passages"
        ? "passages"
        : state.phase === "point"
          ? "point"
          : "summary");
    if (args.claim !== undefined) {
      if (stage === "point") {
        if (
          !(await pointState(ctx, {
            ...args,
            runId: state.runId,
            claim: args.claim,
          }))
        )
          return null;
      } else {
        if (
          args.unitIndex === undefined ||
          !(await claimedJob(
            ctx,
            {
              ...args,
              stage,
              unitIndex: args.unitIndex,
              claim: args.claim,
            },
            true,
          ))
        )
          return null;
      }
    } else if (state.protocol === 2) {
      // Old actions did not identify the failing claim. They cannot pause a
      // different run/lane after the protocol upgrades.
      return null;
    }
    await ctx.db.patch("bookIndexState", state._id, {
      ...(stage === "passages"
        ? { passagesBlocked: args.reason }
        : { summaryBlocked: args.reason }),
      pointClaimedAt: stage === "point" ? undefined : state.pointClaimedAt,
      pointAttempts:
        stage === "point"
          ? Math.max(0, state.pointAttempts - 1)
          : state.pointAttempts,
      failures:
        (state.failures ?? 0) +
        Number(!state.summaryBlocked && !state.passagesBlocked),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// --- For actions/indexBook.ts ---

const jobIdentity = {
  runId: v.optional(v.number()),
};

/** Legacy queued actions lack runId, so a monotonic claim floor also fences
 * them after restart. Existing live legacy claims survive the lazy upgrade. */
async function claimedJob(
  ctx: Db,
  args: {
    userId: string;
    articleId: Id<"articles">;
    stage: Stage;
    unitIndex: number;
    claim: number;
    runId?: number;
  },
  refunded = false,
) {
  const state = await stateRow(ctx, args.userId, args.articleId);
  if (
    !state ||
    (!state.running && !state.pausedReason) ||
    (args.runId !== undefined && args.runId !== state.runId) ||
    args.claim < (state.claimFloor ?? -Infinity) ||
    !(await liveBook(ctx, args.userId, args.articleId))
  )
    return null;
  const row = await indexRow(
    ctx,
    args.userId,
    args.articleId,
    args.stage,
    args.unitIndex,
  );
  if (
    !row ||
    row.status !== (refunded ? "failed" : "pending") ||
    row.claimedAt !== args.claim
  )
    return null;
  const unit = await ctx.db
    .query("bookUnits")
    .withIndex("by_userId_and_articleId_and_index", (q) =>
      q
        .eq("userId", args.userId)
        .eq("articleId", args.articleId)
        .eq("index", args.unitIndex),
    )
    .unique();
  return unit ? { row, unit, state } : null;
}

/**
 * One unit's text for a job, if the job still holds its claim. The unit row
 * can be about 400 KB, so it is read only here, one at a time.
 */
export const unitForJob = internalQuery({
  args: {
    ...jobIdentity,
    userId: v.optional(v.string()),
    articleId: v.id("articles"),
    unitIndex: v.number(),
    stage: v.union(v.literal("summary"), v.literal("passages")),
    claim: v.number(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (!article?.bookOutline) return null;
    const userId = article.userId;
    if (args.userId !== undefined && args.userId !== userId) return null;
    const found = await claimedJob(ctx, { ...args, userId });
    if (!found?.state.running) return null;
    const { unit } = found;
    return {
      userId,
      bookTitle: article.title,
      unitCount: article.bookOutline.length,
      unit: {
        index: unit.index,
        title: unit.title,
        chapter: unit.chapter,
        content: unit.content,
        wordCount: unit.wordCount,
      },
    };
  },
});

/** Ends a job. A stale job (its claim was replaced) changes nothing. */
export const completeJob = internalMutation({
  args: {
    ...jobIdentity,
    userId: v.string(),
    articleId: v.id("articles"),
    stage: v.union(v.literal("summary"), v.literal("passages")),
    unitIndex: v.number(),
    claim: v.number(),
    status: v.union(
      v.literal("done"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    // The job never reached a model (no key): the try doesn't count
    refund: v.optional(v.boolean()),
    summary: v.optional(v.string()),
    passageCount: v.optional(v.number()),
    model: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const found = await claimedJob(ctx, args);
    if (!found) return false;
    const { row } = found;
    await ctx.db.patch("bookIndexUnits", row._id, {
      status: args.status,
      attempts: args.refund ? Math.max(0, row.attempts - 1) : row.attempts,
      summary: args.summary,
      passageCount: args.passageCount,
      model: args.model,
      // Only a failure of the work counts; a refused key is refunded
      failures:
        args.status === "failed" && !args.refund
          ? (row.failures ?? 0) + 1
          : row.failures,
    });
    return true;
  },
});

/** The book's title and settled parts' summaries, for the one point. */
export const summariesForPoint = internalQuery({
  args: {
    articleId: v.id("articles"),
    userId: v.optional(v.string()),
    runId: v.optional(v.number()),
    claim: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (!article?.bookOutline) return null;
    if (!(await liveBook(ctx, article.userId, args.articleId))) return null;
    if (args.userId !== undefined && args.userId !== article.userId)
      return null;
    if (
      args.runId !== undefined &&
      args.claim !== undefined &&
      !(await pointState(ctx, {
        ...args,
        userId: article.userId,
        runId: args.runId,
        claim: args.claim,
      }))
    )
      return null;
    const rows = await laneRows(ctx, article.userId, args.articleId, "summary");
    const end = Math.min(article.bookOutline.length, INDEX_UNIT_CAP);
    if (
      rows.filter((row) => row.unitIndex < end && settledRow(row)).length !==
      end
    )
      return null;
    const summaries = await summariesOf(ctx, article.userId, article._id);
    return {
      userId: article.userId,
      title: article.title,
      lines: article.bookOutline.map((unit, index) => ({
        title: unit.title,
        summary: summaries.get(index) ?? null,
      })),
    };
  },
});

async function summariesOf(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
): Promise<Map<number, string>> {
  const rows = await ctx.db
    .query("bookIndexUnits")
    .withIndex("by_userId_and_articleId_and_stage_and_unitIndex", (q) =>
      q.eq("userId", userId).eq("articleId", articleId).eq("stage", "summary"),
    )
    .take(INDEX_UNIT_CAP);
  return new Map(
    rows.flatMap((row) =>
      row.status === "done" && row.summary
        ? [[row.unitIndex, row.summary] as const]
        : [],
    ),
  );
}

/** A book's summaries by part, for the reader's outline. */
export async function unitSummaries(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
): Promise<(string | null)[]> {
  const found = await summariesOf(ctx, userId, articleId);
  const last = Math.max(-1, ...found.keys());
  return Array.from({ length: last + 1 }, (_, i) => found.get(i) ?? null);
}

/** Removes a unit's passages, a batch at a time; true when more remain. */
export const clearPassages = internalMutation({
  args: {
    ...jobIdentity,
    userId: v.string(),
    articleId: v.id("articles"),
    unitIndex: v.number(),
    claim: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await claimedJob(ctx, { ...args, stage: "passages" }))) return false;
    const rows = await ctx.db
      .query("bookPassages")
      .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", args.articleId)
          .eq("unitIndex", args.unitIndex),
      )
      .take(PASSAGE_BATCH);
    for (const passage of rows)
      await ctx.db.delete("bookPassages", passage._id);
    return rows.length === PASSAGE_BATCH;
  },
});

/** Adds a batch of a unit's embedded passages, if the job still holds its claim. */
export const addPassages = internalMutation({
  args: {
    ...jobIdentity,
    userId: v.string(),
    articleId: v.id("articles"),
    unitIndex: v.number(),
    claim: v.number(),
    passages: v.array(
      v.object({
        passageIndex: v.number(),
        heading: v.string(),
        text: v.string(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await claimedJob(ctx, { ...args, stage: "passages" }))) return false;
    const existing = await ctx.db
      .query("bookPassages")
      .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", args.articleId)
          .eq("unitIndex", args.unitIndex),
      )
      .take(MAX_PASSAGES_PER_UNIT);
    const written = new Set(existing.map((row) => row.passageIndex));
    for (const passage of args.passages)
      if (!written.has(passage.passageIndex)) {
        await ctx.db.insert("bookPassages", {
          userId: args.userId,
          articleId: args.articleId,
          unitIndex: args.unitIndex,
          ...passage,
        });
        written.add(passage.passageIndex);
      }
    return true;
  },
});

// --- For Ask about this book (lib/bookAsk.ts) ---

/**
 * A book's outline with the summaries so far, if the article is the reader's
 * book. The ID arrives as text from the browser, so it is checked here.
 */
export const askContext = internalQuery({
  args: { articleId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const articleId = ctx.db.normalizeId("articles", args.articleId);
    const article = articleId
      ? await ownedArticle(ctx, articleId, args.userId)
      : null;
    if (!article?.bookOutline) return null;
    const summaries = await summariesOf(ctx, args.userId, article._id);
    const anyPassage = await ctx.db
      .query("bookPassages")
      .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
        q.eq("userId", args.userId).eq("articleId", article._id),
      )
      .first();
    return {
      articleId: article._id,
      lines: article.bookOutline.map((unit, index) => ({
        title: unit.title,
        summary: summaries.get(index) ?? null,
      })),
      hasPassages: anyPassage !== null,
    };
  },
});

/** The passages a search found, in its order, kept only if they are this reader's and this book's. */
export const loadPassages = internalQuery({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    ids: v.array(v.id("bookPassages")),
  },
  handler: async (ctx, args) => {
    const found = await Promise.all(
      args.ids.slice(0, 24).map((id) => ctx.db.get("bookPassages", id)),
    );
    return found.flatMap((row) =>
      row && row.userId === args.userId && row.articleId === args.articleId
        ? [{ unitIndex: row.unitIndex, heading: row.heading, text: row.text }]
        : [],
    );
  },
});

/** How far a library's books have got. */
export const status = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("bookIndexState")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(BACKFILL_BOOKS);
    return rows.map((row) => ({
      articleId: row.articleId,
      running: row.running,
      phase: row.phase,
      queued: row.queued,
      updatedAt: row.updatedAt,
      finishedAt: row.finishedAt,
      pausedReason: row.pausedReason,
      recoverable: row.recoverable,
      summaryBlocked: row.summaryBlocked,
      passagesBlocked: row.passagesBlocked,
    }));
  },
});
