// Re-runs work a library skipped while it had no AI key: embeddings for its
// articles, notes, highlights, threads and impressions, then marginalia for
// articles skipped with skipReason "no_provider". Saving a key starts
// it. Each step queues at most PAGE jobs and waits BATCH_DELAY_MS before the
// next, so a large library is caught up slowly rather than all at once.
import { getConvexSize, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { setAnnotationStatus } from "./articles";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./functions";
import { libraryIndexText } from "./lib/importJobs";
import { embeddingProvider } from "./lib/providers";
import { readerProviders } from "./lib/readerAI";
import { spendReaderLimit } from "./limits";

/** Jobs queued per batch. */
export const PAGE = 10;
/** Wait between batches that queued work. */
export const BATCH_DELAY_MS = 45_000;
/** Spacing between the jobs of one batch. */
export const JOB_STAGGER_MS = 3_000;
/** Non-empty pages checked per step when they hold nothing to do. */
const SCAN_PAGES = 5;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
// Leave 4 MiB of the transaction's 16 MiB for auth/routing, limits, queue stats,
// generated metadata and scheduling. These costs are cumulative across phases.
const BODY_BUDGET_BYTES = 12 * MAX_DOCUMENT_BYTES;
// Scan + before/after gets + two patches, each charging native old reads,
// trigger old/new reads and a full write: eleven copies, plus one spare.
const ANNOTATION_BODY_COPIES = 12;
/** Retry after the reader's hourly catch-up budget runs out. */
const LIMIT_RETRY_MS = 10 * 60_000;

type Db = Pick<QueryCtx, "db">;

// Embeddings first, so the marginalia can draw on the reader's notes and marks
const PHASES = [
  "articles",
  "notes",
  "highlights",
  "threads",
  "impressions",
  "annotate",
] as const;
type Phase = (typeof PHASES)[number];

type Job =
  | { kind: "annotate"; id: Id<"articles"> }
  | { kind: "article"; id: Id<"articles"> }
  | { kind: "note"; id: Id<"userNotes"> }
  | { kind: "highlight"; id: Id<"highlights"> }
  | { kind: "thread"; id: Id<"companionThreads"> }
  | { kind: "impression"; id: Id<"impressions">; updatedAt: number };

interface Page {
  jobs: Job[];
  cursor: number | undefined;
  done: boolean;
  read: number;
}

type CatchUpDocument = Doc<
  "articles" | "userNotes" | "highlights" | "companionThreads" | "impressions"
>;
type ScanBudget = { used: number; exhausted: boolean };

async function readOne<Row extends CatchUpDocument>(
  source: (after: number | undefined) => Promise<Row[]>,
  after: number | undefined,
  budget: ScanBudget,
): Promise<Row | null> {
  // Reserve a whole possible document before reading it, not after a PAGE-sized
  // fetch. A document already read but not accepted remains behind the cursor.
  if (budget.used + MAX_DOCUMENT_BYTES > BODY_BUDGET_BYTES) {
    budget.exhausted = true;
    return null;
  }
  const [row] = await source(after);
  if (!row) return null;
  budget.used += getConvexSize(row);
  return row;
}

async function readPage<Row extends CatchUpDocument>(
  source: (after: number | undefined) => Promise<Row[]>,
  jobFor: (row: Row) => Job | null,
  cursor: number | undefined,
  budget: ScanBudget,
): Promise<Page> {
  const jobs: Job[] = [];
  let read = 0;
  for (let i = 0; i < PAGE; i++) {
    const row = await readOne(source, cursor, budget);
    if (!row) return { jobs, cursor, read, done: !budget.exhausted };
    read++;
    const job = jobFor(row);
    const writes =
      job?.kind === "annotate"
        ? (ANNOTATION_BODY_COPIES - 1) * getConvexSize(row)
        : 0;
    if (budget.used + writes > BODY_BUDGET_BYTES) {
      budget.exhausted = true;
      return { jobs, cursor, read, done: false };
    }
    budget.used += writes;
    cursor = row._creationTime;
    if (job) jobs.push(job);
  }
  return { jobs, cursor, read, done: false };
}

function catchUpRow(ctx: Db, userId: string) {
  return ctx.db
    .query("catchUpState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** The owner always; another reader only while active and not being deleted. */
async function isLive(ctx: Db, userId: string): Promise<boolean> {
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
    .first();
  return !reader || (reader.status === "active" && !reader.deletingAt);
}

async function capabilities(ctx: Db, userId: string) {
  const { providers } = await readerProviders(ctx, userId);
  return {
    text: providers.length > 0,
    embed: embeddingProvider(providers) !== null,
  };
}

/** One page of a phase, starting after `cursor` (a _creationTime). */
async function scan(
  ctx: MutationCtx,
  userId: string,
  phase: Phase,
  cursor: number | undefined,
  budget: ScanBudget,
): Promise<Page> {
  switch (phase) {
    case "annotate": {
      return readPage(
        (after) =>
          ctx.db
            .query("articles")
            .withIndex("by_userId_and_annotationStatus_and_skipReason", (q) => {
              const range = q
                .eq("userId", userId)
                .eq("annotationStatus", "skipped")
                .eq("skipReason", "no_provider");
              return after === undefined
                ? range
                : range.gt("_creationTime", after);
            })
            .take(1),
        (row) => ({ kind: "annotate", id: row._id }),
        cursor,
        budget,
      );
    }
    case "articles": {
      const sources = ([undefined, "unavailable"] as const).map(
        (status) => (after: number | undefined) =>
          ctx.db
            .query("articles")
            .withIndex("by_catch_up_article", (q) => {
              const range = q
                .eq("userId", userId)
                .eq("extractionStatus", "extracted")
                .eq("embeddedAt", undefined)
                .eq("libraryIndex.status", status);
              return after === undefined
                ? range
                : range.gt("_creationTime", after);
            })
            .take(1),
      );
      // Merge two one-row lookaheads, not two pages of article bodies. Neither
      // range can advance the shared cursor past an unread older candidate.
      const heads: (Doc<"articles"> | null)[] = [];
      let read = 0;
      for (const source of sources) {
        const row = await readOne(source, cursor, budget);
        heads.push(row);
        if (row) read++;
        if (budget.exhausted) return { jobs: [], cursor, read, done: false };
      }
      const jobs: Job[] = [];
      for (let i = 0; i < PAGE; i++) {
        const first = heads[0];
        const second = heads[1];
        if (!first && !second) return { jobs, cursor, read, done: true };
        const at =
          !second || (first && first._creationTime <= second._creationTime)
            ? 0
            : 1;
        const row = heads[at];
        if (!row) throw new Error("Missing catch-up candidate");
        cursor = row._creationTime;
        if (!row.embedding && libraryIndexText(row))
          jobs.push({ kind: "article", id: row._id });
        if (i === PAGE - 1) break;
        heads[at] = await readOne(sources[at], cursor, budget);
        if (heads[at]) read++;
        if (budget.exhausted) return { jobs, cursor, read, done: false };
      }
      return { jobs, cursor, read, done: false };
    }
    case "notes": {
      return readPage(
        (after) =>
          ctx.db
            .query("userNotes")
            .withIndex("by_user", (q) =>
              after === undefined
                ? q.eq("userId", userId)
                : q.eq("userId", userId).gt("_creationTime", after),
            )
            .take(1),
        (row) =>
          !row.embedding &&
          row.contentPlain &&
          row.noteIndex?.status !== "failed"
            ? { kind: "note", id: row._id }
            : null,
        cursor,
        budget,
      );
    }
    case "highlights": {
      return readPage(
        (after) =>
          ctx.db
            .query("highlights")
            .withIndex("by_userId", (q) =>
              after === undefined
                ? q.eq("userId", userId)
                : q.eq("userId", userId).gt("_creationTime", after),
            )
            .take(1),
        (row) =>
          !row.embedding && row.text
            ? { kind: "highlight", id: row._id }
            : null,
        cursor,
        budget,
      );
    }
    case "threads": {
      return readPage(
        (after) =>
          ctx.db
            .query("companionThreads")
            .withIndex("by_user", (q) =>
              after === undefined
                ? q.eq("userId", userId)
                : q.eq("userId", userId).gt("_creationTime", after),
            )
            .take(1),
        (row) => (!row.embedding ? { kind: "thread", id: row._id } : null),
        cursor,
        budget,
      );
    }
    case "impressions": {
      return readPage(
        (after) =>
          ctx.db
            .query("impressions")
            .withIndex("by_userId", (q) =>
              after === undefined
                ? q.eq("userId", userId)
                : q.eq("userId", userId).gt("_creationTime", after),
            )
            .take(1),
        (row) =>
          !row.embedding
            ? {
                kind: "impression",
                id: row._id,
                updatedAt: row.updatedAt,
              }
            : null,
        cursor,
        budget,
      );
    }
  }
}

async function queue(ctx: MutationCtx, job: Job, delayMs: number) {
  switch (job.kind) {
    case "annotate":
      // Pending again, so a second scan or a restart never queues it twice
      await setAnnotationStatus(ctx, job.id, "pending");
      await ctx.scheduler.runAfter(
        delayMs,
        internal.actions.generateAnnotations.generateForArticle,
        {
          articleId: job.id,
        },
      );
      return;
    case "article":
      await ctx.scheduler.runAfter(delayMs, internal.libraryIndex.enqueue, {
        articleId: job.id,
      });
      return;
    case "note":
      await ctx.scheduler.runAfter(
        delayMs,
        internal.actions.embedUserNote.embed,
        { noteId: job.id },
      );
      return;
    case "highlight":
      await ctx.scheduler.runAfter(
        delayMs,
        internal.actions.embedReaderActivity.embedHighlight,
        {
          highlightId: job.id,
        },
      );
      return;
    case "thread":
      await ctx.scheduler.runAfter(
        delayMs,
        internal.actions.embedReaderActivity.embedThread,
        {
          threadId: job.id,
        },
      );
      return;
    case "impression":
      await ctx.scheduler.runAfter(
        delayMs,
        internal.actions.embedReaderActivity.embedImpression,
        {
          impressionId: job.id,
          updatedAt: job.updatedAt,
        },
      );
      return;
  }
}

/**
 * Starts the library's catch-up, or leaves the running one alone. A run that
 * started without an embedding key rescans from the start once one is added.
 */
export async function startCatchUp(ctx: MutationCtx, userId: string) {
  if (!(await isLive(ctx, userId))) return;
  const can = await capabilities(ctx, userId);
  if (!can.text) return;
  const now = Date.now();
  const row = await catchUpRow(ctx, userId);
  if (row?.running) {
    if (can.embed && !row.embed)
      await ctx.db.patch("catchUpState", row._id, {
        embed: true,
        phase: 0,
        cursor: undefined,
        updatedAt: now,
      });
    return;
  }
  const fields = {
    running: true,
    runId: (row?.runId ?? 0) + 1,
    embed: can.embed,
    phase: 0,
    cursor: undefined,
    articlesQueued: 0,
    itemsQueued: 0,
    startedAt: now,
    updatedAt: now,
    finishedAt: undefined,
  };
  if (row) await ctx.db.patch("catchUpState", row._id, fields);
  else await ctx.db.insert("catchUpState", { userId, ...fields });
  await ctx.scheduler.runAfter(0, internal.catchUp.step, {
    userId,
    runId: fields.runId,
  });
}

export const start = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await startCatchUp(ctx, args.userId);
    return null;
  },
});

/** Queues one batch, then schedules the next. Only the current run advances. */
export async function advanceCatchUp(
  ctx: MutationCtx,
  args: { userId: string; runId: number },
): Promise<null> {
  const row = await catchUpRow(ctx, args.userId);
  if (!row?.running || row.runId !== args.runId) return null;
  const now = Date.now();
  const finish = () =>
    ctx.db.patch("catchUpState", row._id, {
      running: false,
      finishedAt: now,
      updatedAt: now,
    });
  if (!(await isLive(ctx, args.userId))) {
    await finish();
    return null;
  }
  // Checked every batch: a key removed mid-run stops that kind of work
  const can = await capabilities(ctx, args.userId);
  let phase = row.phase;
  let cursor = row.cursor;
  let jobs: Job[] = [];
  let scanned = 0;
  const budget: ScanBudget = { used: 0, exhausted: false };
  while (phase < PHASES.length && scanned < SCAN_PAGES && !budget.exhausted) {
    const name = PHASES[phase];
    const allowed = name === "annotate" ? can.text : can.embed;
    if (!allowed) {
      phase++;
      cursor = undefined;
      continue;
    }
    const page = await scan(ctx, args.userId, name, cursor, budget);
    if (page.read) scanned++;
    if (page.jobs.length) {
      jobs = page.jobs;
      // Leave the cursor where it was until the batch is allowed to run
      if (!(await spendReaderLimit(ctx, args.userId, "catchUp"))) {
        await ctx.db.patch("catchUpState", row._id, {
          phase,
          cursor,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(
          LIMIT_RETRY_MS,
          internal.catchUp.step,
          args,
        );
        return null;
      }
    }
    if (page.done) {
      phase++;
      cursor = undefined;
    } else cursor = page.cursor;
    if (jobs.length) break;
  }

  if (!jobs.length && phase >= PHASES.length) {
    await finish();
    return null;
  }
  for (const [index, job] of jobs.entries())
    await queue(ctx, job, index * JOB_STAGGER_MS);
  const annotations = jobs.filter((job) => job.kind === "annotate").length;
  await ctx.db.patch("catchUpState", row._id, {
    phase,
    cursor,
    articlesQueued: row.articlesQueued + annotations,
    itemsQueued: row.itemsQueued + jobs.length - annotations,
    updatedAt: now,
  });
  // Read-only continuation advances its cursor without spending a provider
  // batch. A byte-limited candidate stays behind the cursor for the next step.
  await ctx.scheduler.runAfter(
    jobs.length ? BATCH_DELAY_MS : 0,
    internal.catchUp.step,
    args,
  );
  return null;
}

export const step = internalMutation({
  args: { userId: v.string(), runId: v.number() },
  returns: v.null(),
  handler: advanceCatchUp,
});

/** For the account page: what the running catch-up has queued so far. */
export const status = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ articlesQueued: v.number(), itemsQueued: v.number() }),
  ),
  handler: async (ctx) => {
    const row = await catchUpRow(ctx, ctx.readerId);
    if (!row?.running) return null;
    return {
      articlesQueued: row.articlesQueued,
      itemsQueued: row.itemsQueued,
    };
  },
});
