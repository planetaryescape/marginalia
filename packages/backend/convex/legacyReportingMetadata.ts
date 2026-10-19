import type { GenericDocument, PaginationResult } from "convex/server";
import { ConvexError, convexToJson, getDocumentSize, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  limitLegacyReadBytes,
  readLegacyDocument,
} from "./lib/articleMetadata";
import {
  syncNoteReporting,
  syncReflectionReporting,
} from "./lib/legacyReporting";
import { metadataLibraryRetained } from "./lib/shelfCounts";

const args = {
  userId: v.string(),
  kind: v.union(v.literal("notes"), v.literal("reflections")),
};
const MiB = 1024 * 1024;
const PROOF_ROWS = 512;
type State = Doc<"legacyReportingState">;
type Kind = State["kind"];
type MigrationResult = { done: boolean; migrated: number; retained: boolean };

function stateFor(ctx: MutationCtx, userId: string, kind: Kind) {
  return ctx.db
    .query("legacyReportingState")
    .withIndex("by_userId_and_kind", (q) =>
      q.eq("userId", userId).eq("kind", kind),
    )
    .unique();
}

/** One canonical row, one paginate, no jobs. Source-ID callbacks are idempotent
 * and fence absent/deleting libraries again before writing any projection. */
export const migrate = internalMutation({
  args,
  returns: v.object({
    done: v.boolean(),
    migrated: v.number(),
    retained: v.boolean(),
  }),
  handler: async (ctx, { userId, kind }): Promise<MigrationResult> => {
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
    if (kind === "notes") {
      const page = await ctx.db
        .query("userNotes")
        .withIndex("by_user_created", (q) => q.eq("userId", userId))
        .paginate(options);
      for (const row of page.page) await syncNoteReporting(ctx, null, row);
      done = page.isDone;
      cursor = page.continueCursor;
      migrated = page.page.length;
    } else {
      const page = await ctx.db
        .query("reflections")
        .withIndex("by_user_responded", (q) =>
          q.eq("userId", userId).gt("respondedAt", undefined),
        )
        .paginate(options);
      for (const row of page.page)
        await syncReflectionReporting(ctx, null, row);
      done = page.isDone;
      cursor = page.continueCursor;
      migrated = page.page.length;
    }
    const fields = {
      userId,
      kind,
      ready: false,
      overflow: state?.overflow ?? 0,
      cursor: done ? null : cursor,
      backfilled: done,
    };
    if (state) await ctx.db.replace(state._id, fields);
    else await ctx.db.insert("legacyReportingState", fields);
    return { done, migrated, retained: true };
  },
});

type Signature = { sourceId: string; value: string };
function noteSignature(
  row: Omit<Doc<"noteReportingMetadata">, "_id" | "_creationTime">,
): Signature {
  return {
    sourceId: row.noteId,
    value: JSON.stringify(
      convexToJson({
        noteId: row.noteId,
        userId: row.userId,
        articleId: row.articleId,
        sourceCreationTime: row.sourceCreationTime,
        createdAt: row.createdAt,
        annotationId: row.annotationId,
        nonblank: row.nonblank,
      }),
    ),
  };
}
function reflectionSignature(
  row: Omit<Doc<"reflectionReportingMetadata">, "_id" | "_creationTime">,
): Signature {
  return {
    sourceId: row.reflectionId,
    value: JSON.stringify(
      convexToJson({
        reflectionId: row.reflectionId,
        userId: row.userId,
        sourceCreationTime: row.sourceCreationTime,
        respondedAt: row.respondedAt,
        nonblank: row.nonblank,
      }),
    ),
  };
}

/** Metadata can itself contain arbitrarily large valid strings. Reserve one
 * native max document BEFORE every unfiltered next(), under the existing queue.
 * The caller subtracts the already-bounded canonical page from that authority. */
async function proofMetadata<T extends GenericDocument>(
  ctx: MutationCtx,
  source: AsyncIterable<T>,
): Promise<T[] | null> {
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
  // The unfiltered page charges every yielded/crossing row (<= 8 MiB + 1 MiB).
  // Leave 3 MiB for retained/state/control reads. Metadata shares the remaining
  // authority and ALSO retains the unrelated callers' existing 10 MiB policy.
  const bytes = page.page.reduce((sum, row) => sum + getDocumentSize(row), 0);
  limitLegacyReadBytes(ctx, 13 * MiB - bytes);
  return page.isDone && page.page.length <= PROOF_ROWS;
}

function equalSet(expected: Signature[], actual: Signature[]) {
  if (expected.length !== actual.length) return false;
  const values = new Map(expected.map((row) => [row.sourceId, row.value]));
  for (const row of actual) {
    if (values.get(row.sourceId) !== row.value) return false;
    values.delete(row.sourceId); // duplicates cannot satisfy the same source twice
  }
  return values.size === 0;
}

/** Deliberately separate from migration. A completed cursor is NOT proof of
 * equality or emptiness. Each kind is verified/activated in its own snapshot. */
export const verifyAndActivate = internalMutation({
  args,
  returns: v.boolean(),
  handler: async (ctx, { userId, kind }): Promise<boolean> => {
    if (!(await metadataLibraryRetained(ctx, userId))) return false;
    const state = await stateFor(ctx, userId, kind);
    if (!state) return false;
    async function refuse() {
      if (state?.ready) await ctx.db.patch(state._id, { ready: false });
      return false;
    }
    if (!state.backfilled || state.cursor !== null || state.overflow !== 0)
      return refuse();
    const options = {
      cursor: null,
      numItems: PROOF_ROWS + 1,
      maximumBytesRead: 8 * MiB,
    };
    let matches: boolean;
    if (kind === "notes") {
      const page = await ctx.db
        .query("userNotes")
        .withIndex("by_user_created", (q) => q.eq("userId", userId))
        .paginate(options);
      if (!canonicalComplete(ctx, page)) return refuse();
      const metadata = await proofMetadata(
        ctx,
        ctx.db
          .query("noteReportingMetadata")
          .withIndex("by_userId", (q) => q.eq("userId", userId)),
      );
      matches =
        metadata !== null &&
        equalSet(
          // Independently derive canonical semantics, not the writer's helper.
          page.page.map((row) =>
            noteSignature({
              noteId: row._id,
              userId: row.userId,
              articleId: row.articleId,
              sourceCreationTime: row._creationTime,
              createdAt: row.createdAt,
              annotationId: row.annotationId,
              nonblank: Boolean(row.contentPlain.trim()),
            }),
          ),
          metadata.map(noteSignature),
        );
    } else {
      const page = await ctx.db
        .query("reflections")
        .withIndex("by_user_responded", (q) =>
          q.eq("userId", userId).gt("respondedAt", undefined),
        )
        .paginate(options);
      if (!canonicalComplete(ctx, page)) return refuse();
      const metadata = await proofMetadata(
        ctx,
        ctx.db
          .query("reflectionReportingMetadata")
          .withIndex("by_userId", (q) => q.eq("userId", userId)),
      );
      matches =
        metadata !== null &&
        equalSet(
          page.page.map((row) =>
            reflectionSignature({
              reflectionId: row._id,
              userId: row.userId,
              sourceCreationTime: row._creationTime,
              respondedAt: row.respondedAt,
              nonblank: Boolean(row.userResponse?.trim()),
            }),
          ),
          metadata.map(reflectionSignature),
        );
    }
    if (!matches) return refuse();
    if (!state.ready) await ctx.db.patch(state._id, { ready: true });
    return true;
  },
});
