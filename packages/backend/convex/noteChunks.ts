import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./functions";
import { readHashPage, writeManifest } from "./vaultFiles";

async function boundedFile(ctx: MutationCtx, userId: string, filePath: string) {
  const result = await ctx.db
    .query("noteChunks")
    .withIndex("by_user_file", (q) =>
      q.eq("userId", userId).eq("filePath", filePath),
    )
    .paginate({ numItems: 129, cursor: null, maximumBytesRead: 4_000_000 });
  if (!result.isDone || result.page.length > 128)
    throw new Error(
      "Existing vault file exceeds atomic replacement budget; preserved unchanged",
    );
  return result.page;
}

const chunkValidator = v.object({
  userId: v.string(),
  filePath: v.string(),
  fileName: v.string(),
  chunkIndex: v.number(),
  content: v.string(),
  tags: v.optional(v.array(v.string())),
  embedding: v.array(v.float64()),
  fileHash: v.string(),
  indexedAt: v.number(),
});

export const getByIdInternal = internalQuery({
  args: { chunkId: v.id("noteChunks") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.chunkId);
  },
});

export const listByFile = internalQuery({
  args: { userId: v.string(), filePath: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("noteChunks")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", args.userId).eq("filePath", args.filePath),
      )
      .collect();
  },
});

export const getFileHash = internalQuery({
  args: { userId: v.string(), filePath: v.string() },
  handler: async (ctx, args) => {
    const chunk = await ctx.db
      .query("noteChunks")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", args.userId).eq("filePath", args.filePath),
      )
      .first();
    return chunk?.fileHash ?? null;
  },
});

export const deleteByFile = internalMutation({
  args: { userId: v.string(), filePath: v.string() },
  handler: async (ctx, args) => {
    const chunks = await boundedFile(ctx, args.userId, args.filePath);
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
    await writeManifest(ctx, args.userId, args.filePath, null);
  },
});

export const insertBatch = internalMutation({
  args: {
    userId: v.string(),
    chunks: v.array(chunkValidator),
  },
  handler: async (ctx, args) => {
    if (args.chunks.length > 25)
      throw new Error("Vault upload batch exceeds limit");
    for (const chunk of args.chunks) {
      await ctx.db.insert("noteChunks", { ...chunk, userId: args.userId });
      await writeManifest(ctx, args.userId, chunk.filePath, chunk.fileHash);
    }
  },
});

/** A complete replacement commits together or leaves the old file untouched. */
export const replaceFile = internalMutation({
  args: {
    userId: v.string(),
    filePath: v.string(),
    chunks: v.array(chunkValidator),
  },
  handler: async (ctx, args) => {
    const hash = args.chunks[0]?.fileHash;
    if (
      !hash ||
      args.chunks.length > 128 ||
      args.chunks.some(
        (chunk, index) =>
          chunk.filePath !== args.filePath ||
          chunk.fileHash !== hash ||
          chunk.chunkIndex !== index ||
          chunk.embedding.length !== 1536 ||
          chunk.embedding.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new Error(
        "Expected one complete file with ordered chunks and valid embeddings",
      );
    }
    const previous = await boundedFile(ctx, args.userId, args.filePath);
    for (const chunk of previous) await ctx.db.delete(chunk._id);
    for (const chunk of args.chunks)
      await ctx.db.insert("noteChunks", { ...chunk, userId: args.userId });
    await writeManifest(ctx, args.userId, args.filePath, hash);
  },
});

export const count = query({
  args: {},
  handler: async (ctx) => {
    const chunks = await ctx.db
      .query("noteChunks")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .collect();
    return chunks.length;
  },
});

export const allFilePaths = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // Kept for internal callers with small manifests. HTTP must use the action
    // helper, so each page has its own read-byte transaction budget.
    const result = await readHashPage(ctx, args.userId, null);
    if (result.cursor !== null)
      throw new Error("Use vaultFiles.hashesResponse for paginated hashes");
    return Object.fromEntries(
      result.files.map(({ filePath, fileHash }) => [filePath, fileHash]),
    );
  },
});
