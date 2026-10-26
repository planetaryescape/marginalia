// The idea graph, write side: links the reader draws and notes written from
// the map.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { nodeKey, snippet } from "./lib/ideaGraph";
import { articleFor, linkRow, loadNode } from "./lib/ideaNodes";

async function createLink(
  ctx: MutationCtx,
  userId: string,
  from: string,
  to: string,
) {
  if (from === to) throw new ConvexError("An idea can't link to itself.");
  const [a, b] = await Promise.all([
    loadNode(ctx, userId, from),
    loadNode(ctx, userId, to),
  ]);
  if (!a || !b) throw new ConvexError("That idea isn't in your notes.");
  const existing = await linkRow(ctx, userId, from, to);
  if (existing) return existing._id;
  return ctx.db.insert("ideaLinks", {
    userId,
    from,
    to,
    createdAt: Date.now(),
  });
}

export const link = mutation({
  args: { from: v.string(), to: v.string() },
  handler: (ctx, args) => createLink(ctx, ctx.readerId, args.from, args.to),
});

export const unlink = mutation({
  args: { a: v.string(), b: v.string() },
  handler: async (ctx, args) => {
    const row = await linkRow(ctx, ctx.readerId, args.a, args.b);
    if (row) await ctx.db.delete("ideaLinks", row._id);
  },
});

/**
 * Saves a note written from the graph and links it to the idea it was
 * written beside, so it appears on the map at once. Notes belong to an
 * article, so a vault idea needs one Marginalia has connected it to.
 */
export const writeConnected = mutation({
  args: {
    from: v.string(),
    content: v.string(),
    contentPlain: v.string(),
    // What the note answers, when it is a reply
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.readerId;
    if (!args.contentPlain.trim())
      throw new ConvexError("Write something first.");
    const from = await loadNode(ctx, userId, args.from);
    if (!from) throw new ConvexError("That idea isn't in your notes.");
    const articleId = await articleFor(ctx, userId, from);
    if (!articleId)
      throw new ConvexError(
        "This vault note isn't tied to an article yet. Write from one of your notes instead.",
      );
    const now = Date.now();
    const noteId = await ctx.db.insert("userNotes", {
      userId,
      articleId,
      selectedText: "",
      prompt: args.prompt ? snippet(args.prompt, 300) : undefined,
      content: args.content,
      contentPlain: args.contentPlain,
      createdAt: now,
      updatedAt: now,
    });
    const key = nodeKey("note", noteId);
    await ctx.db.insert("ideaLinks", {
      userId,
      from: key,
      to: from.key,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.actions.embedUserNote.embed, {
      noteId,
    });
    return key;
  },
});

const SWEEP_BATCH = 100;

/**
 * Deletes the links to and from an idea that is gone, a bounded batch at a
 * time, and schedules itself again until none are left.
 */
export const sweep = internalMutation({
  args: { userId: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const from = await ctx.db
      .query("ideaLinks")
      .withIndex("by_user_from_to", (q) =>
        q.eq("userId", args.userId).eq("from", args.key),
      )
      .take(SWEEP_BATCH);
    const to = await ctx.db
      .query("ideaLinks")
      .withIndex("by_user_to", (q) =>
        q.eq("userId", args.userId).eq("to", args.key),
      )
      .take(SWEEP_BATCH - from.length);
    for (const row of [...from, ...to])
      await ctx.db.delete("ideaLinks", row._id);
    if (from.length + to.length >= SWEEP_BATCH)
      await ctx.scheduler.runAfter(0, internal.ideaLinks.sweep, args);
  },
});
