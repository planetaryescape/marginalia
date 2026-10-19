import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { vocabularyState } from "./tagVocabulary";

/** Reuse atomic tag projections only when they cover the whole library. */
export async function reportingTags(ctx: QueryCtx, userId: string) {
  const state = await vocabularyState(ctx, userId);
  const ready = state?.ready && state.overflow === 0;
  const names = new Map<Id<"tags">, string>();
  const nodes = new Map<Id<"tags">, Doc<"tagVocabulary">>();
  return {
    async activeIds(limit: number): Promise<Set<Id<"tags">>> {
      if (ready) {
        // Canonical by_user_status uses source _creationTime, NOT the metadata
        // node's _creationTime (nodes are recreated by count/status changes).
        const rows = await ctx.db
          .query("tagVocabulary")
          .withIndex(
            "by_userId_and_active_and_sourceCreationTime_and_tagId",
            (q) => q.eq("userId", userId).eq("active", true),
          )
          .take(limit);
        for (const row of rows) nodes.set(row.tagId, row);
        return new Set(rows.map((row) => row.tagId));
      }
      const rows = await ctx.db
        .query("tags")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", "active"),
        )
        .take(limit);
      for (const row of rows) names.set(row._id, row.name);
      return new Set(rows.map((row) => row._id));
    },
    async name(tagId: Id<"tags">): Promise<string | null> {
      const cached = names.get(tagId);
      if (cached !== undefined) return cached;
      if (ready) {
        const node =
          nodes.get(tagId) ??
          (await ctx.db
            .query("tagVocabulary")
            .withIndex("by_tagId", (q) => q.eq("tagId", tagId))
            .unique());
        if (!node || node.userId !== userId || !node.active) return null;
        const payload = await ctx.db.get(node.payloadId);
        if (payload?.userId === userId && payload.tagId === tagId)
          return payload.name;
        // An unsupported/incomplete projection must not invent an empty name.
      }
      const tag = await ctx.db.get("tags", tagId);
      return tag?.userId === userId && tag.status === "active"
        ? tag.name
        : null;
    },
  };
}
