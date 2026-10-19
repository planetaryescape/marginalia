import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { MAX_TAGS_PER_ARTICLE, normaliseTag } from "./tagMatching";
import { TAG_KEY_BYTES, vocabularyState } from "./tagVocabulary";

/** null means use the unchanged full matcher, without speculative vector reads. */
export async function exactActiveAssignmentTags(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  proposals: readonly { name: string }[],
): Promise<Doc<"tags">[] | null> {
  // Longer/unsupported proposal lists keep legacy MAX3/duplicate/nearest rules.
  if (proposals.length > MAX_TAGS_PER_ARTICLE) return null;
  const state = await vocabularyState(ctx, userId);
  if (!state?.ready || state.overflow) return null;

  const winners = new Map<string, Doc<"tagVocabulary">>();
  for (const proposal of proposals) {
    const key = normaliseTag(proposal.name);
    if (!key || winners.has(key)) continue;
    if (new TextEncoder().encode(key).byteLength > TAG_KEY_BYTES) return null;
    // Match Map's LAST direct-key row, before considering status. Node creation
    // time changes on count updates; canonical creation time + ID do not.
    const winner = await ctx.db
      .query("tagVocabulary")
      .withIndex("by_userId_and_key_and_sourceCreationTime_and_tagId", (q) =>
        q.eq("userId", userId).eq("key", key),
      )
      .order("desc")
      .first();
    if (!winner?.active || winner.overflow) return null;
    winners.set(key, winner);
  }

  const tags: Doc<"tags">[] = [];
  for (const [key, winner] of winners) {
    const tag = await ctx.db.get(winner.tagId);
    // Atomic writers guarantee this invariant. Never authorize stale/foreign
    // metadata, or add a whole scan after vector hydration on corruption.
    if (
      !tag ||
      tag.userId !== userId ||
      tag.key !== key ||
      tag.status !== "active"
    )
      throw new Error("Tag assignment metadata is inconsistent");
    tags.push(tag);
  }
  return tags;
}
