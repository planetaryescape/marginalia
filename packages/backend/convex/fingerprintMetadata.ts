import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";
import {
  fingerprintState,
  syncFingerprintSource,
} from "./lib/fingerprintMetadata";
import { metadataLibraryRetained } from "./lib/shelfCounts";

export const status = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const retained = await metadataLibraryRetained(ctx, userId);
    const state = retained ? await fingerprintState(ctx, userId) : null;
    return {
      retained,
      ready: state?.phase === "done",
      phase: state?.phase ?? null,
    };
  },
});

/** Explicit, resumable, metadata-only. One paginate per transaction, with a
 * 512 KiB target + at most one 1 MiB source overshoot, <=32 small stamp writes.
 * Live writers already publish atomically, so cursor interleavings cannot lose
 * inserts, changes, ownership transfers or deletions. No source is rewritten.
 * Disabled-but-retained libraries may migrate; deleting/absent ones may not. */
export const backfill = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    if (!(await metadataLibraryRetained(ctx, userId)))
      return { complete: false, retained: false };
    let state = await fingerprintState(ctx, userId);
    if (!state) {
      const id = await ctx.db.insert("marginaliaFingerprintState", {
        userId,
        phase: "articles",
        cursor: null,
      });
      state = await ctx.db.get(id);
    }
    if (!state) throw new Error("Missing fingerprint migration state");
    const { phase, cursor } = state;
    if (phase === "done") return { complete: true, retained: true };
    const page = await (phase === "highlights"
      ? ctx.db
          .query("highlights")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
      : ctx.db.query(phase).withIndex("by_user", (q) => q.eq("userId", userId))
    ).paginate({ cursor, numItems: 32, maximumBytesRead: 512 * 1024 });
    for (const row of page.page)
      await syncFingerprintSource(ctx, phase, null, row);
    const next = {
      articles: "userNotes",
      userNotes: "highlights",
      highlights: "companionThreads",
      companionThreads: "noteChunks",
      noteChunks: "done",
    } as const;
    await ctx.db.patch(state._id, {
      phase: page.isDone ? next[phase] : phase,
      cursor: page.isDone ? null : page.continueCursor,
    });
    return { complete: page.isDone && next[phase] === "done", retained: true };
  },
});
