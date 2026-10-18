import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";

type Source = "manifest" | "legacy";
export interface FilePage {
  files: { filePath: string; fileHash: string }[];
  cursor: string | null;
}

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
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const state = await migrationState(ctx, userId);
    if (state?.complete) return { complete: true, afterPath: state.afterPath };
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
    return { complete: value.complete, afterPath: value.afterPath };
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
