import { compareValues } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { aliasState } from "./tagAliases";
import {
  MAX_TAGS_PER_ARTICLE,
  matchTagEmbedding,
  normaliseTag,
} from "./tagMatching";
import {
  TAG_ASSIGN_KEY_BYTES,
  TAG_ASSIGN_PROPOSALS,
  TAG_VECTOR_BYTES,
  TAG_VECTOR_COUNT,
  vectorState,
} from "./tagVectors";
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
  let aliases: Awaited<ReturnType<typeof aliasState>> | undefined;
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
    // A direct row always wins, even when it is a candidate. Never select an
    // active alias instead of falling back to the full candidate/nearest path.
    if (winner) {
      if (!winner.active || winner.overflow) return null;
      winners.set(key, winner);
      continue;
    }
    if (new TextEncoder().encode(userId).byteLength > TAG_KEY_BYTES)
      return null;
    if (aliases === undefined) aliases = await aliasState(ctx, userId);
    if (!aliases?.ready || aliases.overflow) return null;
    const alias = await ctx.db
      .query("tagAliases")
      .withIndex(
        "by_userId_and_alias_and_key_and_sourceCreationTime_and_tagId",
        (q) => q.eq("userId", userId).eq("alias", key),
      )
      .first();
    if (!alias) return null;
    const node = await ctx.db
      .query("tagVocabulary")
      .withIndex("by_tagId", (q) => q.eq("tagId", alias.tagId))
      .unique();
    if (
      !node?.active ||
      node.overflow ||
      node.userId !== userId ||
      node.key !== alias.key ||
      node.sourceCreationTime !== alias.sourceCreationTime
    )
      return null;
    winners.set(key, node);
  }

  const tags: Doc<"tags">[] = [];
  const hydrated = new Map<Id<"tags">, Doc<"tags">>();
  for (const [key, winner] of winners) {
    const tag = hydrated.get(winner.tagId) ?? (await ctx.db.get(winner.tagId));
    // Atomic writers guarantee this invariant. Never authorize stale/foreign
    // metadata, or add a whole scan after vector hydration on corruption.
    if (
      !tag ||
      tag.userId !== userId ||
      tag.key !== winner.key ||
      (tag.key !== key && !tag.aliases.includes(key)) ||
      tag._creationTime !== winner.sourceCreationTime ||
      tag.status !== "active"
    )
      throw new Error("Tag assignment metadata is inconsistent");
    if (!hydrated.has(tag._id)) tags.push(tag);
    hydrated.set(tag._id, tag);
  }
  // A proposal-ordered subset can reverse overlapping alias winners when the
  // unchanged matcher rebuilds its Map. Reconstitute canonical key-index order.
  if (aliases)
    tags.sort(
      (a, b) =>
        compareValues(a.key, b.key) ||
        a._creationTime - b._creationTime ||
        compareValues(a._id, b._id),
    );
  return tags;
}

/** Preflight is exclusively small state rows and input bytes. Once selected,
 * this path must never fall back after a vector/canonical read. */
export async function boundedAssignmentView(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  proposals: readonly {
    name: string;
    description?: string;
    embedding?: readonly number[];
  }[],
) {
  if (
    proposals.length > TAG_ASSIGN_PROPOSALS ||
    proposals.some(
      (p) =>
        new TextEncoder().encode(normaliseTag(p.name)).byteLength >
          TAG_ASSIGN_KEY_BYTES ||
        new TextEncoder().encode(p.name).byteLength > TAG_KEY_BYTES ||
        (p.description &&
          new TextEncoder().encode(p.description).byteLength > TAG_KEY_BYTES) ||
        (p.embedding && p.embedding.length > 1536),
    )
  )
    return null;
  const state = await vectorState(ctx, userId);
  if (
    !state?.ready ||
    state.overflow ||
    state.count > TAG_VECTOR_COUNT ||
    state.vectorBytes > TAG_VECTOR_BYTES
  )
    return null;
  const vocabulary = await vocabularyState(ctx, userId);
  if (!vocabulary?.ready || vocabulary.overflow) return null;
  const aliases = await aliasState(ctx, userId);
  if (!aliases?.ready || aliases.overflow) return null;
  const rows = await ctx.db
    .query("tagVectors")
    .withIndex("by_userId_and_key_and_sourceCreationTime_and_tagId", (q) =>
      q.eq("userId", userId),
    )
    .take(TAG_VECTOR_COUNT + 1);
  if (rows.length !== state.count)
    throw new Error("Incomplete tag vector projection");
  const vectors = rows.map((row) => ({
    id: row.tagId,
    embedding: row.embedding,
  }));
  const ids = new Set(vectors.map((row) => row.id));
  const cache = new Map<Id<"tags">, Doc<"tags">>();
  return {
    has(id: Id<"tags">) {
      return ids.has(id);
    },
    add(tag: Doc<"tags">) {
      // Legacy known.push: new rows go LAST, including first-NaN behavior.
      ids.add(tag._id);
      vectors.push({ id: tag._id, embedding: tag.embedding });
      cache.set(tag._id, tag);
    },
    async get(id: Id<"tags">) {
      if (!ids.has(id)) return undefined;
      const cached = cache.get(id);
      if (cached) return cached;
      const tag = await ctx.db.get(id);
      if (!tag || tag.userId !== userId)
        throw new Error("Tag assignment metadata is inconsistent");
      cache.set(id, tag);
      return tag;
    },
    async match(
      proposal: { key: string; embedding?: readonly number[] },
      exclude?: Id<"tags">,
    ) {
      // Writers publish alias/key changes in this same mutation, so each query
      // sees prior proposals. Never cache a semantic answer across iterations.
      const direct = await ctx.db
        .query("tagVocabulary")
        .withIndex("by_userId_and_key_and_sourceCreationTime_and_tagId", (q) =>
          q.eq("userId", userId).eq("key", proposal.key),
        )
        .order("desc")
        .take(2);
      let winner = direct.find((row) => row.tagId !== exclude)?.tagId;
      if (!winner) {
        const alias = await ctx.db
          .query("tagAliases")
          .withIndex(
            "by_userId_and_alias_and_key_and_sourceCreationTime_and_tagId",
            (q) => q.eq("userId", userId).eq("alias", proposal.key),
          )
          .take(2);
        winner = alias.find((row) => row.tagId !== exclude)?.tagId;
      }
      if (winner) {
        if (!ids.has(winner))
          throw new Error("Unknown exact tag projection winner");
        return { kind: "existing" as const, tagId: winner };
      }
      return matchTagEmbedding(
        proposal,
        exclude ? vectors.filter((row) => row.id !== exclude) : vectors,
      );
    },
  };
}
