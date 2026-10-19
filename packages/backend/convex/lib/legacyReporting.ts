import type { GenericDocument } from "convex/server";
import { ConvexError, convexToJson } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  readLegacyDocument,
  readReportingDocument,
  resolveArticleCard,
} from "./articleMetadata";
import { metadataLibraryRetained } from "./shelfCounts";

export function noteReportingProjection(note: Doc<"userNotes">) {
  return {
    noteId: note._id,
    userId: note.userId,
    articleId: note.articleId,
    sourceCreationTime: note._creationTime,
    createdAt: note.createdAt,
    annotationId: note.annotationId,
    nonblank: Boolean(note.contentPlain.trim()),
  };
}

export function reflectionReportingProjection(row: Doc<"reflections">) {
  return {
    reflectionId: row._id,
    userId: row.userId,
    sourceCreationTime: row._creationTime,
    respondedAt: row.respondedAt,
    nonblank: Boolean(row.userResponse?.trim()),
  };
}

// Registered by the shared generic writer, not individual save handlers. Empty
// responses remain source rows (and keep M02's independent deletion protection).
export async function syncNoteReporting(
  ctx: MutationCtx,
  before: Doc<"userNotes"> | null,
  after: Doc<"userNotes"> | null,
) {
  const id = after?._id ?? before?._id;
  if (!id) return;
  const fields = after ? noteReportingProjection(after) : null;
  if (
    before &&
    fields &&
    JSON.stringify(convexToJson(noteReportingProjection(before))) ===
      JSON.stringify(convexToJson(fields))
  )
    return;
  const old = await ctx.db
    .query("noteReportingMetadata")
    .withIndex("by_noteId", (q) => q.eq("noteId", id))
    .unique();
  if (!fields || !(await metadataLibraryRetained(ctx, fields.userId))) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  if (old) await ctx.db.replace(old._id, fields);
  else await ctx.db.insert("noteReportingMetadata", fields);
}

export async function syncReflectionReporting(
  ctx: MutationCtx,
  before: Doc<"reflections"> | null,
  after: Doc<"reflections"> | null,
) {
  // Undefined respondedAt cannot enter any retained reporting date range. Do
  // not amplify generic generation of unanswered questions into unused rows.
  // Empty SAVED responses with a date still get metadata (nonblank=false).
  if (!before && after?.respondedAt === undefined) return;
  const id = after?._id ?? before?._id;
  if (!id) return;
  const fields =
    after?.respondedAt !== undefined
      ? reflectionReportingProjection(after)
      : null;
  if (
    before &&
    fields &&
    JSON.stringify(convexToJson(reflectionReportingProjection(before))) ===
      JSON.stringify(convexToJson(fields))
  )
    return;
  const old = await ctx.db
    .query("reflectionReportingMetadata")
    .withIndex("by_reflectionId", (q) => q.eq("reflectionId", id))
    .unique();
  if (!fields || !(await metadataLibraryRetained(ctx, fields.userId))) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  if (old) await ctx.db.replace(old._id, fields);
  else await ctx.db.insert("reflectionReportingMetadata", fields);
}

/** Unfiltered iteration: no hidden filtered rows and no paginate (Convex only
 * permits ONE paginate per function, even when the first range is empty).
 * Convex's query iterator issues queryStreamNext once per next(), no prefetch.
 * Reserve a maximum-size row BEFORE dispatch, including the 5,001st sentinel. */
export async function takeReportingRows<T extends GenericDocument>(
  ctx: Pick<QueryCtx, "db">,
  source: AsyncIterable<T>,
  limit: number,
): Promise<T[]> {
  const rows: T[] = [];
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (rows.length < limit) {
      const row = await readReportingDocument(ctx, async () => {
        const next = await iterator.next();
        return next.done ? null : next.value;
      });
      if (!row) break;
      rows.push(row);
    }
  } finally {
    await iterator.return?.();
  }
  return rows;
}

async function reportingReady(
  ctx: QueryCtx,
  userId: string,
  kind: "notes" | "reflections",
) {
  const state = await readReportingDocument(ctx, () =>
    ctx.db
      .query("legacyReportingState")
      .withIndex("by_userId_and_kind", (q) =>
        q.eq("userId", userId).eq("kind", kind),
      )
      .unique(),
  );
  return state?.ready === true && state.overflow === 0 && state.cursor === null;
}

export type ReportingNote = Omit<
  Doc<"noteReportingMetadata">,
  "_id" | "_creationTime"
> & { source?: Doc<"userNotes"> };
export type ReportingReflection = Omit<
  Doc<"reflectionReportingMetadata">,
  "_id" | "_creationTime"
>;
type Window = { previousStart: number; end: number };

export async function reportingNotes(
  ctx: QueryCtx,
  period: Window,
  userId: string,
  limit: number,
): Promise<ReportingNote[]> {
  if (await reportingReady(ctx, userId, "notes")) {
    return takeReportingRows(
      ctx,
      ctx.db
        .query("noteReportingMetadata")
        .withIndex(
          "by_userId_and_createdAt_and_sourceCreationTime_and_noteId",
          (q) =>
            q
              .eq("userId", userId)
              .gte("createdAt", period.previousStart)
              .lt("createdAt", period.end),
        ),
      limit,
    );
  }
  const rows = await takeReportingRows(
    ctx,
    ctx.db
      .query("userNotes")
      .withIndex("by_user_created", (q) =>
        q
          .eq("userId", userId)
          .gte("createdAt", period.previousStart)
          .lt("createdAt", period.end),
      ),
    limit,
  );
  return rows.map((source) => ({ ...noteReportingProjection(source), source }));
}

export async function reportingReflections(
  ctx: QueryCtx,
  period: Window,
  userId: string,
  limit: number,
): Promise<ReportingReflection[]> {
  if (await reportingReady(ctx, userId, "reflections")) {
    return takeReportingRows(
      ctx,
      ctx.db
        .query("reflectionReportingMetadata")
        .withIndex(
          "by_userId_and_respondedAt_and_sourceCreationTime_and_reflectionId",
          (q) =>
            q
              .eq("userId", userId)
              .gte("respondedAt", period.previousStart)
              .lt("respondedAt", period.end),
        ),
      limit,
    );
  }
  const rows = await takeReportingRows(
    ctx,
    ctx.db
      .query("reflections")
      .withIndex("by_user_responded", (q) =>
        q
          .eq("userId", userId)
          .gte("respondedAt", period.previousStart)
          .lt("respondedAt", period.end),
      ),
    limit,
  );
  return rows.map(reflectionReportingProjection);
}

export async function reportingNoteSource(
  ctx: QueryCtx,
  note: ReportingNote,
  userId: string,
) {
  const row =
    note.source ??
    (await readLegacyDocument(ctx, () => ctx.db.get("userNotes", note.noteId)));
  if (
    !row ||
    row.userId !== userId ||
    JSON.stringify(noteReportingProjection(row)) !==
      JSON.stringify({
        noteId: note.noteId,
        userId: note.userId,
        articleId: note.articleId,
        sourceCreationTime: note.sourceCreationTime,
        createdAt: note.createdAt,
        annotationId: note.annotationId,
        nonblank: note.nonblank,
      })
  )
    throw new ConvexError(
      "Reporting note metadata is incomplete. No partial result was returned.",
    );
  return row;
}

/** Same ownership/readiness/deferred policy as ownedArticleCard, but charge the
 * compact join and readiness lookup as well as its existing guarded body read. */
export async function reportingArticleCard(
  ctx: QueryCtx,
  articleId: Id<"articles">,
  userId: string,
) {
  const row = await readReportingDocument(ctx, () =>
    ctx.db
      .query("articleMetadata")
      .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
      .unique(),
  );
  if (row) return row.userId === userId ? resolveArticleCard(ctx, row) : null;
  const state = await readReportingDocument(ctx, () =>
    ctx.db
      .query("libraryMetadataState")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique(),
  );
  if (state?.articlesReady) return null;
  const source = await readLegacyDocument(ctx, () =>
    ctx.db.get("articles", articleId),
  );
  return source?.userId === userId ? resolveArticleCard(ctx, source) : null;
}

/** Called inside account's existing compact-metadata slot. No new numeric step
 * and NO paginate: the enclosing account invocation may already have used it. */
export async function purgeLegacyReporting(ctx: MutationCtx, userId: string) {
  for (const table of [
    "noteReportingMetadata",
    "reflectionReportingMetadata",
    "legacyReportingState",
  ] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(100);
    if (!rows.length) continue;
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  }
  return 0;
}
