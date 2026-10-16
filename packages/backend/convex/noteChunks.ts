import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./functions";
import { bumpRetrievalRevision } from "./lib/retrievalRevision";

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
    const chunks = await ctx.db
      .query("noteChunks")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", args.userId).eq("filePath", args.filePath),
      )
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
  },
});

export const insertBatch = internalMutation({
  args: {
    userId: v.string(),
    chunks: v.array(chunkValidator),
  },
  handler: async (ctx, args) => {
    for (const chunk of args.chunks) {
      await ctx.db.insert("noteChunks", { ...chunk, userId: args.userId });
    }
    await bumpRetrievalRevision(ctx, args.userId);
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
    const previous = await ctx.db
      .query("noteChunks")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", args.userId).eq("filePath", args.filePath),
      )
      .collect();
    for (const chunk of previous) await ctx.db.delete(chunk._id);
    for (const chunk of args.chunks)
      await ctx.db.insert("noteChunks", { ...chunk, userId: args.userId });
    await bumpRetrievalRevision(ctx, args.userId);
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
    const chunks = await ctx.db
      .query("noteChunks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    // Return unique file paths with their hashes
    const fileMap = new Map<string, string>();
    for (const chunk of chunks) {
      fileMap.set(chunk.filePath, chunk.fileHash);
    }
    return Object.fromEntries(fileMap);
  },
});
