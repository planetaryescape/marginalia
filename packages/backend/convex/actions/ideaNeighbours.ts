"use node";

// Vector search only runs in actions, so the embedding signal for the idea
// graph is fetched here and handed back to the graph query as keys (which that
// query re-checks as the reader's own).
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../functions";
import { nodeKey, SIMILARITY_FLOOR } from "../lib/ideaGraph";

const LIMITS = { notes: 6, highlights: 6, answers: 4, vault: 8 } as const;
const RETURNED = 12;

export interface SimilarHit {
  key: string;
  via?: string;
}

export const similar = action({
  args: { key: v.string(), via: v.optional(v.string()) },
  handler: async (ctx, args): Promise<SimilarHit[]> => {
    // For a vault idea, from the passage it is shown by
    const vector: number[] | null = await ctx.runQuery(
      internal.ideaGraph.embeddingOf,
      { userId: ctx.readerId, key: args.key, via: args.via },
    );
    // Not embedded yet (or no embedding key): the other signals still draw the map
    if (!vector) return [];
    const [notes, marks, answers, vault] = await Promise.all([
      ctx.vectorSearch("userNotes", "by_embedding", {
        vector,
        limit: LIMITS.notes,
        filter: (q) => q.eq("userId", ctx.readerId),
      }),
      ctx.vectorSearch("highlights", "by_embedding", {
        vector,
        limit: LIMITS.highlights,
        filter: (q) => q.eq("userId", ctx.readerId),
      }),
      ctx.vectorSearch("companionThreads", "by_embedding", {
        vector,
        limit: LIMITS.answers,
        filter: (q) => q.eq("userId", ctx.readerId),
      }),
      ctx.vectorSearch("noteChunks", "by_embedding", {
        vector,
        limit: LIMITS.vault,
        filter: (q) => q.eq("userId", ctx.readerId),
      }),
    ]);
    const files: Record<string, string> = await ctx.runQuery(
      internal.ideaGraph.vaultFiles,
      { userId: ctx.readerId, chunkIds: vault.map((hit) => hit._id) },
    );
    // A vault hit is the file, shown by the passage that matched
    const hits: { key: string; via?: string; score: number }[] = [
      ...notes.map((hit) => ({
        key: nodeKey("note", hit._id),
        score: hit._score,
      })),
      ...marks.map((hit) => ({
        key: nodeKey("highlight", hit._id),
        score: hit._score,
      })),
      ...answers.map((hit) => ({
        key: nodeKey("answer", hit._id),
        score: hit._score,
      })),
      ...vault.flatMap((hit) =>
        files[hit._id]
          ? [
              {
                key: nodeKey("vault", files[hit._id]),
                via: hit._id as string,
                score: hit._score,
              },
            ]
          : [],
      ),
    ];
    return hits
      .filter((hit) => hit.key !== args.key && hit.score >= SIMILARITY_FLOOR)
      .sort((a, b) => b.score - a.score)
      .filter((hit, i, all) => all.findIndex((h) => h.key === hit.key) === i)
      .slice(0, RETURNED)
      .map(({ key, via }) => ({ key, via }));
  },
});
