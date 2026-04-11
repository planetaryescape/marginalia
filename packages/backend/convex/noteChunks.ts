import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_USER_ID } from "./lib/constants";

export const getByIdInternal = internalQuery({
  args: { chunkId: v.id("noteChunks") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.chunkId);
  },
});

export const listByFile = internalQuery({
  args: { filePath: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("noteChunks")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("filePath", args.filePath),
      )
      .collect();
  },
});

export const getFileHash = internalQuery({
  args: { filePath: v.string() },
  handler: async (ctx, args) => {
    const chunk = await ctx.db
      .query("noteChunks")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("filePath", args.filePath),
      )
      .first();
    return chunk?.fileHash ?? null;
  },
});

export const deleteByFile = internalMutation({
  args: { filePath: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("noteChunks")
      .withIndex("by_user_file", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("filePath", args.filePath),
      )
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
  },
});

export const insertBatch = internalMutation({
  args: {
    chunks: v.array(
      v.object({
        userId: v.string(),
        filePath: v.string(),
        fileName: v.string(),
        chunkIndex: v.number(),
        content: v.string(),
        tags: v.optional(v.array(v.string())),
        embedding: v.array(v.float64()),
        fileHash: v.string(),
        indexedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const chunk of args.chunks) {
      await ctx.db.insert("noteChunks", chunk);
    }
  },
});

export const count = query({
  args: {},
  handler: async (ctx) => {
    const chunks = await ctx.db
      .query("noteChunks")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .collect();
    return chunks.length;
  },
});

export const allFilePaths = internalQuery({
  args: {},
  handler: async (ctx) => {
    const chunks = await ctx.db
      .query("noteChunks")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .collect();
    // Return unique file paths with their hashes
    const fileMap = new Map<string, string>();
    for (const chunk of chunks) {
      fileMap.set(chunk.filePath, chunk.fileHash);
    }
    return Object.fromEntries(fileMap);
  },
});
