// Indexes an imported book once it is readable (D-DES-054, D-DES-055): a
// short summary per reading unit, then the book's one point written from those
// summaries, then about 300-token passages embedded for Ask about this book.
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
  INDEX_UNIT_CAP,
  MAX_ATTEMPTS,
  MAX_PAUSES,
  STALE_MS,
} from "./lib/bookIndex";
import { embeddingProvider } from "./lib/providers";
import { readerProviders } from "./lib/readerAI";
import { spendReaderLimit } from "./limits";

type Db = Pick<QueryCtx, "db">;
type Stage = Doc<"bookIndexUnits">["stage"];
type Phase = Doc<"bookIndexState">["phase"];

/** Units looked at per read; the rows are small. */
const WINDOW = 100;
/** Windows looked at per step when they hold nothing to queue. */
const SCAN_WINDOWS = 5;
/** Retry after the reader's hourly indexing budget runs out. */
const LIMIT_RETRY_MS = 10 * 60_000;
/** Books a backfill starts for one library. */
const BACKFILL_BOOKS = 200;
/** Rows deleted or read per call where each carries a vector. */
const PASSAGE_BATCH = 100;

const stageOf = (phase: Phase): Stage | null =>
  phase === "summaries" ? "summary" : phase === "passages" ? "passages" : null;

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
 * Whether the library can do a phase's work: summaries need a text key and
 * passages an embedding key. A reader without the key pauses the run with a
 * reason; saving a key resumes it (resumeBooks).
 */
async function keyFor(ctx: Db, userId: string, phase: Phase) {
  const { providers } = await readerProviders(ctx, userId);
  return (
    phase === "passages"
      ? embeddingProvider(providers) !== null
      : providers.length > 0
  )
    ? "ok"
    : "no_key";
}

async function canRun(ctx: Db, userId: string, phase: Phase) {
  return (
    (await libraryIsActive(ctx, userId)) &&
    (await keyFor(ctx, userId, phase)) === "ok"
  );
}

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
    const now = Date.now();
    const row = await stateRow(ctx, args.userId, args.articleId);
    if (row?.phase === "done") return "already indexed";
    const phase = row?.phase ?? "summaries";
    if (!(await canRun(ctx, args.userId, phase)))
      return "not started: the library needs a key for this step";
    if (row?.running) {
      if (now - row.updatedAt < STALE_MS) return "already running";
      await ctx.db.patch("bookIndexState", row._id, { updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.bookIndex.step, {
        ...args,
        runId: row.runId,
      });
      return "resumed";
    }
    const fields = {
      running: true,
      runId: (row?.runId ?? 0) + 1,
      phase,
      cursor: 0,
      pointAttempts: 0,
      pointClaimedAt: undefined,
      pausedReason: undefined,
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
    if (row?.phase === "done") continue;
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

/** Queues one batch of the current phase, then schedules the next. Only the current run advances. */
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
    if ((await keyFor(ctx, args.userId, state.phase)) !== "ok") {
      await patch({
        running: false,
        pointClaimedAt: undefined,
        pausedReason: "no_key",
        failures: (state.failures ?? 0) + 1,
      });
      return null;
    }
    const end = Math.min(book.unitCount, INDEX_UNIT_CAP);

    if (state.phase === "point") {
      // A call for the point is in flight; its watchdog takes over if it is lost
      if (
        state.pointClaimedAt !== undefined &&
        now - state.pointClaimedAt < CLAIM_TTL_MS
      )
        return null;
      if (state.pointAttempts >= MAX_ATTEMPTS) {
        // The part-1 point stays; the book is still searchable
        await patch({
          phase: "passages",
          cursor: 0,
          pointClaimedAt: undefined,
        });
        await next(0);
        return null;
      }
      await patch({
        pointAttempts: state.pointAttempts + 1,
        pointClaimedAt: now,
      });
      // The action moves the run on (pointWritten) or retries it (pointFailed);
      // if it is lost, the watchdog frees the claim and the step tries again
      await ctx.scheduler.runAfter(
        0,
        internal.actions.indexBook.writeOverview,
        { ...args, claim: now },
      );
      await ctx.scheduler.runAfter(
        CLAIM_TTL_MS + 1_000,
        internal.bookIndex.pointWatchdog,
        { ...args, claim: now },
      );
      return null;
    }

    const stage = stageOf(state.phase);
    if (!stage) return null;
    let cursor = state.cursor;
    const jobs: { index: number; attempts: number }[] = [];
    for (
      let page = 0;
      page < SCAN_WINDOWS && cursor < end && jobs.length < BATCH_JOBS;
      page++
    ) {
      const windowEnd = Math.min(end, cursor + WINDOW);
      const rows = await ctx.db
        .query("bookIndexUnits")
        .withIndex("by_userId_and_articleId_and_stage_and_unitIndex", (q) =>
          q
            .eq("userId", args.userId)
            .eq("articleId", args.articleId)
            .eq("stage", stage)
            .gte("unitIndex", cursor)
            .lt("unitIndex", windowEnd),
        )
        .take(WINDOW);
      const byIndex = new Map(rows.map((row) => [row.unitIndex, row]));
      let index = cursor;
      for (; index < windowEnd && jobs.length < BATCH_JOBS; index++) {
        const row = byIndex.get(index) ?? null;
        const verdict = verdictFor(row, now);
        if (verdict === "queue")
          jobs.push({ index, attempts: row?.attempts ?? 0 });
        else if (verdict === "give_up" && row)
          await ctx.db.patch("bookIndexUnits", row._id, { status: "failed" });
      }
      cursor = index;
    }

    if (jobs.length) {
      // Nothing is claimed until the batch is allowed to run
      if (!(await spendReaderLimit(ctx, args.userId, "bookIndex"))) {
        await patch({});
        await next(LIMIT_RETRY_MS);
        return null;
      }
      for (const [at, job] of jobs.entries()) {
        const existing = await indexRow(
          ctx,
          args.userId,
          args.articleId,
          stage,
          job.index,
        );
        const fields = {
          status: "pending" as const,
          claimedAt: now,
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
          claim: now,
        };
        await ctx.scheduler.runAfter(
          at * JOB_STAGGER_MS,
          stage === "summary"
            ? internal.actions.indexBook.summarizeUnit
            : internal.actions.indexBook.embedPassages,
          job_args,
        );
      }
      await patch({ cursor, queued: state.queued + jobs.length });
      await next(BATCH_DELAY_MS);
      return null;
    }

    if (cursor < end) {
      // Only empty windows were checked: carry on now
      await patch({ cursor });
      await next(0);
      return null;
    }

    // Everything has been looked at. The phase is over once every unit is
    // settled; until then the jobs in flight get time to land, and any that
    // failed are queued again from the top.
    const rows = await ctx.db
      .query("bookIndexUnits")
      .withIndex("by_userId_and_articleId_and_stage_and_unitIndex", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", args.articleId)
          .eq("stage", stage),
      )
      .take(INDEX_UNIT_CAP + 1);
    const settled = rows.filter(
      (row) =>
        row.unitIndex < end &&
        (row.status === "done" ||
          row.status === "skipped" ||
          (row.status === "failed" && row.attempts >= MAX_ATTEMPTS)),
    );
    if (settled.length < end) {
      await patch({ cursor: 0 });
      await next(BATCH_DELAY_MS);
      return null;
    }
    if (stage === "summary") {
      const any = settled.some((row) => row.status === "done");
      await patch({ phase: any ? "point" : "passages", cursor: 0 });
      await next(0);
      return null;
    }
    await patch({ phase: "done", running: false, finishedAt: now });
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
  ctx: MutationCtx,
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
  args: pointArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await pointState(ctx, args);
    if (!state) return null;
    await ctx.db.patch("bookIndexState", state._id, {
      phase: "passages",
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
    if (!state) return null;
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
 * A job found no usable key (none saved, or one that won't open): the run
 * stops with a reason instead of retrying, and saving a key resumes it. The
 * pause is counted, and refunded tries don't reset the count.
 */
export const pauseIndex = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    reason: v.union(v.literal("no_key"), v.literal("unusable_key")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await stateRow(ctx, args.userId, args.articleId);
    // Only the first of a batch's jobs to report pauses it and counts
    if (!state?.running) return null;
    await ctx.db.patch("bookIndexState", state._id, {
      running: false,
      pointClaimedAt: undefined,
      pausedReason: args.reason,
      failures: (state.failures ?? 0) + 1,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// --- For actions/indexBook.ts ---

/**
 * One unit's text for a job, if the job still holds its claim. The unit row
 * can be about 400 KB, so it is read only here, one at a time.
 */
export const unitForJob = internalQuery({
  args: {
    articleId: v.id("articles"),
    unitIndex: v.number(),
    stage: v.union(v.literal("summary"), v.literal("passages")),
    claim: v.number(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (!article?.bookOutline) return null;
    const userId = article.userId;
    const row = await indexRow(
      ctx,
      userId,
      args.articleId,
      args.stage,
      args.unitIndex,
    );
    if (row?.status !== "pending" || row.claimedAt !== args.claim) return null;
    if (!(await libraryIsActive(ctx, userId))) return null;
    const unit = await ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) =>
        q
          .eq("userId", userId)
          .eq("articleId", args.articleId)
          .eq("index", args.unitIndex),
      )
      .unique();
    if (!unit) return null;
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
    if (!(await liveBook(ctx, args.userId, args.articleId))) return false;
    const row = await indexRow(
      ctx,
      args.userId,
      args.articleId,
      args.stage,
      args.unitIndex,
    );
    if (row?.status !== "pending" || row.claimedAt !== args.claim) return false;
    await ctx.db.patch("bookIndexUnits", row._id, {
      status: args.status,
      attempts: args.refund ? Math.max(0, row.attempts - 1) : row.attempts,
      summary: args.summary,
      passageCount: args.passageCount,
      model: args.model,
    });
    return true;
  },
});

/** The book's title and its parts' summaries so far, for the one point. */
export const summariesForPoint = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (!article?.bookOutline) return null;
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
    userId: v.string(),
    articleId: v.id("articles"),
    unitIndex: v.number(),
    claim: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await liveBook(ctx, args.userId, args.articleId))) return false;
    const row = await indexRow(
      ctx,
      args.userId,
      args.articleId,
      "passages",
      args.unitIndex,
    );
    if (row?.status !== "pending" || row.claimedAt !== args.claim) return false;
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
    if (!(await liveBook(ctx, args.userId, args.articleId))) return false;
    const row = await indexRow(
      ctx,
      args.userId,
      args.articleId,
      "passages",
      args.unitIndex,
    );
    if (row?.status !== "pending" || row.claimedAt !== args.claim) return false;
    for (const passage of args.passages)
      await ctx.db.insert("bookPassages", {
        userId: args.userId,
        articleId: args.articleId,
        unitIndex: args.unitIndex,
        ...passage,
      });
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
    }));
  },
});
