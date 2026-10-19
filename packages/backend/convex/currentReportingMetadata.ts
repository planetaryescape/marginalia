import type { GenericDocument, PaginationResult } from "convex/server";
import { ConvexError, convexToJson, getDocumentSize, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  limitLegacyReadBytes,
  readLegacyDocument,
} from "./lib/articleMetadata";
import { syncDwellReporting, syncVisitReporting } from "./lib/currentReporting";
import { metadataLibraryRetained } from "./lib/shelfCounts";

const args = {
  userId: v.string(),
  kind: v.union(v.literal("visits"), v.literal("dwell")),
};
const MiB = 1024 * 1024;
// Activation deliberately refuses a larger baseline. This is a bounded,
// same-snapshot proof, not a cursor asserted to mean completeness. Operators
// must not force readiness when either envelope is exceeded.
const PROOF_ROWS = 4096;
type Kind = Doc<"currentReportingState">["kind"];

function stateFor(ctx: Pick<QueryCtx, "db">, userId: string, kind: Kind) {
  return ctx.db
    .query("currentReportingState")
    .withIndex("by_userId_and_kind", (q) =>
      q.eq("userId", userId).eq("kind", kind),
    )
    .unique();
}

export const status = internalQuery({
  args,
  handler: (ctx, { userId, kind }) => stateFor(ctx, userId, kind),
});

/** Exactly one canonical paginate, even for an empty range. Generic hooks must
 * be installed first: writes behind the cursor are maintained atomically. */
export const migrate = internalMutation({
  args,
  returns: v.object({
    done: v.boolean(),
    migrated: v.number(),
    retained: v.boolean(),
  }),
  handler: async (ctx, { userId, kind }) => {
    if (!(await metadataLibraryRetained(ctx, userId)))
      return { done: false, migrated: 0, retained: false };
    const state = await stateFor(ctx, userId, kind);
    if (state?.backfilled && state.cursor === null)
      return { done: true, migrated: 0, retained: true };
    const options = {
      cursor: state?.cursor ?? null,
      numItems: 1,
      maximumBytesRead: MiB,
    };
    let done: boolean;
    let cursor: string;
    let migrated: number;
    if (kind === "visits") {
      const page = await ctx.db
        .query("readingActivity")
        .withIndex("by_user_started", (q) => q.eq("userId", userId))
        .paginate(options);
      for (const row of page.page) await syncVisitReporting(ctx, null, row);
      done = page.isDone;
      cursor = page.continueCursor;
      migrated = page.page.length;
    } else {
      const page = await ctx.db
        .query("paragraphDwell")
        .withIndex("by_user_article", (q) => q.eq("userId", userId))
        .paginate(options);
      for (const row of page.page) await syncDwellReporting(ctx, null, row);
      done = page.isDone;
      cursor = page.continueCursor;
      migrated = page.page.length;
    }
    const fields = {
      userId,
      kind,
      ready: false,
      cursor: done ? null : cursor,
      backfilled: done,
    };
    if (state) await ctx.db.replace(state._id, fields);
    else await ctx.db.insert("currentReportingState", fields);
    return { done, migrated, retained: true };
  },
});

function visitValue(
  row: Omit<Doc<"visitReportingMetadata">, "_id" | "_creationTime">,
) {
  return JSON.stringify(
    convexToJson({
      activityId: row.activityId,
      userId: row.userId,
      articleId: row.articleId,
      sourceCreationTime: row.sourceCreationTime,
      startedAt: row.startedAt,
      activeTimeMs: row.activeTimeMs,
      estimatedReadMinutes: row.estimatedReadMinutes,
    }),
  );
}
function dwellValue(
  row: Omit<Doc<"dwellReportingMetadata">, "_id" | "_creationTime">,
) {
  return JSON.stringify(
    convexToJson({
      dwellId: row.dwellId,
      userId: row.userId,
      articleId: row.articleId,
      sourceCreationTime: row.sourceCreationTime,
      updatedAt: row.updatedAt,
      values: row.values,
    }),
  );
}

async function proofMetadata<T extends GenericDocument>(
  ctx: MutationCtx,
  source: AsyncIterable<T>,
) {
  const rows: T[] = [];
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (rows.length <= PROOF_ROWS) {
      const row = await readLegacyDocument(ctx, async () => {
        const next = await iterator.next();
        return next.done ? null : next.value;
      });
      if (!row) return rows;
      rows.push(row);
    }
    return null;
  } catch (error) {
    if (
      error instanceof ConvexError &&
      error.data ===
        "Article headers exceed this request's read budget. Request fewer articles."
    )
      return null;
    throw error;
  } finally {
    await iterator.return?.();
  }
}

function canonicalComplete<T extends GenericDocument>(
  ctx: MutationCtx,
  page: PaginationResult<T>,
) {
  const bytes = page.page.reduce((sum, row) => sum + getDocumentSize(row), 0);
  // The canonical page is unfiltered, including the physical crossing row.
  // Guard each subsequent metadata read BEFORE dispatch; leave 3 MiB for
  // retained/state/control reads. Never loosen the shared default allowance.
  limitLegacyReadBytes(ctx, 13 * MiB - bytes);
  return page.isDone && page.page.length <= PROOF_ROWS;
}

function equalOrder(expected: string[], actual: string[] | null) {
  return (
    actual !== null &&
    expected.length === actual.length &&
    expected.every((value, index) => value === actual[index])
  );
}

/** Separate production activation. Proves canonical projection AND complete
 * source order in this transaction. Missing/extra/duplicate/stale rows, changed
 * float order, and row/byte cuts all refuse; completed backfill is not proof. */
export const verifyAndActivate = internalMutation({
  args,
  returns: v.boolean(),
  handler: async (ctx, { userId, kind }) => {
    if (!(await metadataLibraryRetained(ctx, userId))) return false;
    const state = await stateFor(ctx, userId, kind);
    if (!state) return false;
    const refuse = async () => {
      if (state.ready) await ctx.db.patch(state._id, { ready: false });
      return false;
    };
    if (!state.backfilled || state.cursor !== null) return refuse();
    const options = {
      cursor: null,
      numItems: PROOF_ROWS + 1,
      maximumBytesRead: 8 * MiB,
    };
    let matches: boolean;
    if (kind === "visits") {
      const page = await ctx.db
        .query("readingActivity")
        .withIndex("by_user_started", (q) => q.eq("userId", userId))
        .paginate(options);
      if (!canonicalComplete(ctx, page)) return refuse();
      const rows = await proofMetadata(
        ctx,
        ctx.db
          .query("visitReportingMetadata")
          .withIndex("by_userId_startedAt_sourceCreationTime_activityId", (q) =>
            q.eq("userId", userId),
          ),
      );
      matches = equalOrder(
        page.page.map((row) =>
          visitValue({
            activityId: row._id,
            userId: row.userId,
            articleId: row.articleId,
            sourceCreationTime: row._creationTime,
            startedAt: row.startedAt,
            activeTimeMs: row.activeTimeMs,
            estimatedReadMinutes: row.estimatedReadMinutes,
          }),
        ),
        rows?.map(visitValue) ?? null,
      );
    } else {
      const page = await ctx.db
        .query("paragraphDwell")
        .withIndex("by_user_article", (q) => q.eq("userId", userId))
        .paginate(options);
      if (!canonicalComplete(ctx, page)) return refuse();
      const rows = await proofMetadata(
        ctx,
        ctx.db
          .query("dwellReportingMetadata")
          .withIndex("by_userId_articleId_sourceCreationTime_dwellId", (q) =>
            q.eq("userId", userId),
          ),
      );
      matches = equalOrder(
        page.page.map((row) =>
          dwellValue({
            dwellId: row._id,
            userId: row.userId,
            articleId: row.articleId,
            sourceCreationTime: row._creationTime,
            updatedAt: row.updatedAt,
            // Independently derive from canonical values, never the sync helper.
            values: Object.values(row.dwell),
          }),
        ),
        rows?.map(dwellValue) ?? null,
      );
    }
    if (!matches) return refuse();
    if (!state.ready) await ctx.db.patch(state._id, { ready: true });
    return true;
  },
});
