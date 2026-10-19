"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { embedTexts } from "../lib/embeddings";
import { noteIndexFence } from "../lib/noteIndex";
import { loadReaderAI } from "../lib/router";

export const embed = internalAction({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.userNotes.requestIndex, args);
  },
});

export const runClaimed = internalAction({
  args: noteIndexFence,
  handler: async (ctx, args) => {
    if (!(await ctx.runMutation(internal.userNotes.checkIndexClaim, args)))
      return;
    let dispatched = false;
    try {
      const target = (
        await loadReaderAI(ctx, args.userId, { text: false })
      ).embedder();
      if (!target) {
        await ctx.runMutation(internal.userNotes.failIndex, {
          ...args,
          status: "unavailable",
          dispatched,
        });
        return;
      }
      // Resolve credentials first, then fence canonical input/ownership/lease
      // immediately before spending. Duplicate action delivery cannot dispatch.
      const input = await ctx.runMutation(internal.userNotes.checkIndexClaim, {
        ...args,
        dispatch: true,
      });
      if (!input) return;
      dispatched = true;
      const [embedding] = await embedTexts(target, [input]);
      if (!embedding) throw new Error("Missing embedding");
      await ctx.runMutation(internal.userNotes.setEmbedding, {
        ...args,
        embedding,
        contentPlain: "", // Kept only for old queued payload compatibility.
      });
    } catch {
      // Never log a provider response: it can contain note text or credentials.
      // Caught failures are terminal; only a lost action gets lease recovery.
      await ctx.runMutation(internal.userNotes.failIndex, {
        ...args,
        status: "failed",
        dispatched,
      });
    }
  },
});
