import { convexToJson, getDocumentSize } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";

export function visitReportingProjection(row: Doc<"readingActivity">) {
  return {
    activityId: row._id,
    userId: row.userId,
    articleId: row.articleId,
    sourceCreationTime: row._creationTime,
    startedAt: row.startedAt,
    activeTimeMs: row.activeTimeMs,
    estimatedReadMinutes: row.estimatedReadMinutes,
  };
}

export function dwellReportingProjection(row: Doc<"paragraphDwell">) {
  return {
    dwellId: row._id,
    userId: row.userId,
    articleId: row.articleId,
    sourceCreationTime: row._creationTime,
    updatedAt: row.updatedAt,
    values: Object.values(row.dwell),
  };
}

// Compare serialized Convex values, including signed zero/NaN/Infinity. All
// fields not projected here are unused by current Room/Topics/Linger. Legacy
// consumers continue to read the canonical rows and keep their own semantics.
export async function syncVisitReporting(
  ctx: MutationCtx,
  before: Doc<"readingActivity"> | null,
  after: Doc<"readingActivity"> | null,
) {
  const id = after?._id ?? before?._id;
  if (!id) return;
  const fields = after ? visitReportingProjection(after) : null;
  if (
    before &&
    fields &&
    JSON.stringify(convexToJson(visitReportingProjection(before))) ===
      JSON.stringify(convexToJson(fields))
  )
    return;
  const old = await ctx.db
    .query("visitReportingMetadata")
    .withIndex("by_activityId", (q) => q.eq("activityId", id))
    .unique();
  if (!fields || !(await metadataLibraryRetained(ctx, fields.userId))) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  if (old) await ctx.db.replace(old._id, fields);
  else await ctx.db.insert("visitReportingMetadata", fields);
}

export async function syncDwellReporting(
  ctx: MutationCtx,
  before: Doc<"paragraphDwell"> | null,
  after: Doc<"paragraphDwell"> | null,
) {
  const id = after?._id ?? before?._id;
  if (!id) return;
  const fields = after ? dwellReportingProjection(after) : null;
  if (
    before &&
    fields &&
    JSON.stringify(convexToJson(dwellReportingProjection(before))) ===
      JSON.stringify(convexToJson(fields))
  )
    return;
  const old = await ctx.db
    .query("dwellReportingMetadata")
    .withIndex("by_dwellId", (q) => q.eq("dwellId", id))
    .unique();
  if (!fields || !(await metadataLibraryRetained(ctx, fields.userId))) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  if (old) await ctx.db.replace(old._id, fields);
  else await ctx.db.insert("dwellReportingMetadata", fields);
}

export async function currentReportingReady(
  ctx: QueryCtx,
  userId: string,
  kind: "visits" | "dwell",
) {
  const state = await ctx.db
    .query("currentReportingState")
    .withIndex("by_userId_and_kind", (q) =>
      q.eq("userId", userId).eq("kind", kind),
    )
    .unique();
  return state?.ready === true && state.backfilled && state.cursor === null;
}

export function currentVisitQuery(
  ctx: QueryCtx,
  userId: string,
  period: { start: number; end: number },
) {
  return ctx.db
    .query("visitReportingMetadata")
    .withIndex("by_userId_startedAt_sourceCreationTime_activityId", (q) =>
      q
        .eq("userId", userId)
        .gte("startedAt", period.start)
        .lt("startedAt", period.end),
    )
    .order("desc");
}

/** Resolve readiness once, not once per parallel article. Leave the caller's
 * batch settlement, physical sentinel and global-row accounting untouched. */
export async function currentDwellReader(ctx: QueryCtx, userId: string) {
  const ready = await currentReportingReady(ctx, userId, "dwell");
  return async (articleId: Id<"articles">, limit: number) => {
    if (ready)
      return ctx.db
        .query("dwellReportingMetadata")
        .withIndex("by_userId_articleId_sourceCreationTime_dwellId", (q) =>
          q.eq("userId", userId).eq("articleId", articleId),
        )
        .order("desc")
        .take(limit);
    const rows = await ctx.db
      .query("paragraphDwell")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", userId).eq("articleId", articleId),
      )
      .order("desc")
      .take(limit);
    return rows.map(dwellReportingProjection);
  };
}

// Main calls this in the existing compact-metadata purge slot. Never paginate:
// account may already have spent its single paginate in this transaction.
export async function purgeCurrentReporting(ctx: MutationCtx, userId: string) {
  const MiB = 1024 * 1024;
  let removed = 0;
  let bytes = 0;
  let complete = true;
  tables: for (const table of [
    "visitReportingMetadata",
    "dwellReportingMetadata",
    "currentReportingState",
  ] as const) {
    // Drain across table boundaries in one compact-metadata invocation, rather
    // than scheduling a new account round for each singleton state. Reserve a
    // whole possible document BEFORE each read; no hidden take(100) overshoot.
    while (true) {
      if (removed >= 100 || bytes + MiB > 2 * MiB) {
        complete = false;
        break tables;
      }
      const row = await ctx.db
        .query(table)
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      if (!row) break;
      const size = getDocumentSize(row);
      bytes += size;
      // Deletion can read the old row too, including a generic writer's lookup.
      // The row is now known in this snapshot: reserve two further actual sizes.
      if (bytes + 2 * size > 2 * MiB) {
        complete = false;
        break tables;
      }
      await ctx.db.delete(row._id);
      bytes += 2 * size;
      removed++;
    }
  }
  if (!complete && removed === 0)
    throw new Error(
      "Current reporting metadata exceeds the account purge budget",
    );
  return { removed, complete, reservedBytes: bytes };
}
