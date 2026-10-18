import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { DEFAULT_USER_ID } from "./lib/constants";

type Source = "manifest" | "legacy";
export interface FilePage {
  files: { filePath: string; fileHash: string }[];
  cursor: string | null;
}

interface BackfillProgress {
  complete: boolean;
  afterPath: string | null;
}
interface BackfillRun extends BackfillProgress {
  scheduled: boolean;
  transactions: number;
}

const FILES_PER_BACKFILL_RUN = 25;
const MAX_BACKFILL_RUNS = 1000;

/** Tombstones prevent a racing/resumed backfill from reviving removed files. */
export async function writeManifest(
  ctx: MutationCtx,
  userId: string,
  filePath: string,
  fileHash: string | null,
) {
  const row = await ctx.db
    .query("vaultFiles")
    .withIndex("by_user_file", (q) =>
      q.eq("userId", userId).eq("filePath", filePath),
    )
    .unique();
  const value = { userId, filePath, fileHash };
  if (row) await ctx.db.replace(row._id, value);
  else await ctx.db.insert("vaultFiles", value);
}

/** Account-purge integration: invoke repeatedly until it returns zero. */
export async function purgeMetadata(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  const rows = await ctx.db
    .query("vaultFiles")
    .withIndex("by_user_file", (q) => q.eq("userId", userId))
    .paginate({ numItems: 64, cursor: null, maximumBytesRead: 512_000 });
  for (const row of rows.page) await ctx.db.delete(row._id);
  if (rows.page.length) return rows.page.length;
  const state = await migrationState(ctx, userId);
  if (!state) return 0;
  await ctx.db.delete(state._id);
  return 1;
}

async function migrationState(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("vaultManifestBackfills")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** One indexed file seek per transaction; never scan every vector in a file. */
export const backfill = internalMutation({
  args: { userId: v.string(), requireActiveReader: v.optional(v.boolean()) },
  handler: async (ctx, { userId, requireActiveReader }) => {
    // Scheduled work must not recreate metadata after an account purge. Manual
    // single-step fixtures/admin calls retain the existing internal contract.
    if (requireActiveReader && userId !== DEFAULT_USER_ID) {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
        .unique();
      if (
        !reader ||
        reader.status !== "active" ||
        reader.deletingAt !== undefined
      )
        throw new Error("Vault backfill requires an active library");
    }
    const state = await migrationState(ctx, userId);
    if (state?.complete)
      return { complete: true, afterPath: state.afterPath ?? null };
    const next = await ctx.db
      .query("noteChunks")
      .withIndex("by_user_file", (q) =>
        state?.afterPath === undefined
          ? q.eq("userId", userId)
          : q.eq("userId", userId).gt("filePath", state.afterPath),
      )
      .first();
    if (next) {
      const existing = await ctx.db
        .query("vaultFiles")
        .withIndex("by_user_file", (q) =>
          q.eq("userId", userId).eq("filePath", next.filePath),
        )
        .unique();
      if (!existing) {
        // Preserve the old hash contract: the last appended chunk wins.
        const last = await ctx.db
          .query("noteChunks")
          .withIndex("by_user_file", (q) =>
            q.eq("userId", userId).eq("filePath", next.filePath),
          )
          .order("desc")
          .first();
        await writeManifest(
          ctx,
          userId,
          next.filePath,
          last?.fileHash ?? next.fileHash,
        );
      }
    }
    const value = {
      userId,
      afterPath: next?.filePath ?? state?.afterPath,
      complete: !next,
    };
    if (state) await ctx.db.replace(state._id, value);
    else await ctx.db.insert("vaultManifestBackfills", value);
    return { complete: value.complete, afterPath: value.afterPath ?? null };
  },
});

export const backfillStatus = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const state = await migrationState(ctx, userId);
    return {
      complete: state?.complete ?? false,
      afterPath: state?.afterPath ?? null,
    };
  },
});

/** Explicit admin invocation only: no cron, deploy hook, or HTTP side effect. */
export const runBackfill = internalAction({
  args: { userId: v.string(), remainingRuns: v.optional(v.number()) },
  handler: async (
    ctx,
    { userId, remainingRuns = MAX_BACKFILL_RUNS },
  ): Promise<BackfillRun> => {
    if (
      !Number.isSafeInteger(remainingRuns) ||
      remainingRuns < 1 ||
      remainingRuns > MAX_BACKFILL_RUNS
    )
      throw new Error(`Expected 1–${MAX_BACKFILL_RUNS} backfill runs`);
    let progress: BackfillProgress = { complete: false, afterPath: null };
    for (let i = 0; i < FILES_PER_BACKFILL_RUN; i++) {
      progress = await ctx.runMutation(internal.vaultFiles.backfill, {
        userId,
        requireActiveReader: true,
      });
      if (progress.complete)
        return { ...progress, scheduled: false, transactions: i + 1 };
    }
    const scheduled = remainingRuns > 1;
    if (scheduled)
      await ctx.scheduler.runAfter(100, internal.vaultFiles.runBackfill, {
        userId,
        remainingRuns: remainingRuns - 1,
      });
    return { ...progress, scheduled, transactions: FILES_PER_BACKFILL_RUN };
  },
});

const cursorSchema = z.object({
  source: z.enum(["manifest", "legacy"]),
  afterPath: z.string(),
});

export async function readHashPage(
  ctx: QueryCtx,
  userId: string,
  cursor: string | null,
): Promise<FilePage> {
  const position = cursor ? cursorSchema.parse(JSON.parse(cursor)) : null;
  const state = await migrationState(ctx, userId);
  if (position?.source === "manifest" && !state?.complete)
    throw new Error("Vault manifest is not complete");
  const source: Source =
    position?.source ?? (state?.complete ? "manifest" : "legacy");
  const afterPath = position?.afterPath;
  const files: FilePage["files"] = [];
  if (source === "manifest") {
    const rows = await ctx.db
      .query("vaultFiles")
      .withIndex("by_user_file", (q) =>
        afterPath === undefined
          ? q.eq("userId", userId)
          : q.eq("userId", userId).gt("filePath", afterPath),
      )
      .paginate({ numItems: 100, cursor: null, maximumBytesRead: 512_000 });
    for (const row of rows.page)
      if (row.fileHash !== null)
        files.push({ filePath: row.filePath, fileHash: row.fileHash });
    const last = rows.page.at(-1);
    if (!rows.isDone && !last)
      throw new Error("Vault metadata exceeds page budget");
    return {
      files,
      cursor:
        rows.isDone || !last
          ? null
          : JSON.stringify({ source, afterPath: last.filePath }),
    };
  }
  // Mixed deployments cannot advertise an empty/complete manifest. Two indexed
  // seeks read at most two chunk documents (<2 MiB), regardless of corpus size.
  const first = await ctx.db
    .query("noteChunks")
    .withIndex("by_user_file", (q) =>
      afterPath === undefined
        ? q.eq("userId", userId)
        : q.eq("userId", userId).gt("filePath", afterPath),
    )
    .first();
  if (!first) return { files, cursor: null };
  const last = await ctx.db
    .query("noteChunks")
    .withIndex("by_user_file", (q) =>
      q.eq("userId", userId).eq("filePath", first.filePath),
    )
    .order("desc")
    .first();
  files.push({
    filePath: first.filePath,
    fileHash: last?.fileHash ?? first.fileHash,
  });
  return {
    files,
    cursor: JSON.stringify({ source, afterPath: first.filePath }),
  };
}

export const page = internalQuery({
  args: { userId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: (ctx, args) => readHashPage(ctx, args.userId, args.cursor),
});

/** Call only AFTER the existing HTTP API-key check. Old clients still get a map. */
export async function hashesResponse(
  ctx: ActionCtx,
  request: Request,
  userId: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("protocol") === "2") {
    const result: FilePage = await ctx.runQuery(internal.vaultFiles.page, {
      userId,
      cursor: url.searchParams.get("cursor"),
    });
    return Response.json({
      version: 2,
      hashes: Object.fromEntries(
        result.files.map(({ filePath, fileHash }) => [filePath, fileHash]),
      ),
      cursor: result.cursor,
    });
  }
  const hashes: Record<string, string> = Object.create(null);
  let cursor: string | null = null;
  do {
    const result: FilePage = await ctx.runQuery(internal.vaultFiles.page, {
      userId,
      cursor,
    });
    for (const file of result.files) hashes[file.filePath] = file.fileHash;
    cursor = result.cursor;
  } while (cursor !== null);
  return Response.json(hashes);
}
