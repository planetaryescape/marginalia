import { getConvexSize } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";
import { aliasProjection, MAX_TAG_ALIASES } from "./tagAliases";
import {
  TAG_KEY_BYTES,
  TAG_METADATA_BYTES,
  tagProjection,
} from "./tagVocabulary";

export const TAG_VECTOR_COUNT = 768;
export const TAG_VECTOR_BYTES = 8_000_000;
export const TAG_SOURCE_BYTES = 65_536;
export const TAG_ASSIGN_PROPOSALS = 8;
export const TAG_ASSIGN_KEY_BYTES = 64;
type ReadCtx = Pick<QueryCtx, "db">;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;

export function vectorState(ctx: ReadCtx, userId: string) {
  return ctx.db
    .query("tagVectorState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

function projection(tag: Doc<"tags">) {
  return {
    userId: tag.userId,
    tagId: tag._id,
    key: tag.key,
    sourceCreationTime: tag._creationTime,
    embedding: tag.embedding,
  };
}

function overflow(tag: Doc<"tags">) {
  // Reserve room for status/nearest identity changes and eight added query keys.
  // The vocabulary payload must stay complete throughout the proposal loop.
  const reserved = TAG_ASSIGN_PROPOSALS * (TAG_ASSIGN_KEY_BYTES + 4);
  const text = tag.description ? `${tag.name}: ${tag.description}` : tag.name;
  const aliases = aliasProjection(tag);
  return (
    getConvexSize(tag) + 256 + reserved > TAG_SOURCE_BYTES ||
    aliases.overflow ||
    aliases.aliases.length + TAG_ASSIGN_PROPOSALS > MAX_TAG_ALIASES ||
    tagProjection(tag).overflow ||
    bytes(JSON.stringify({ name: tag.name, aliases: tag.aliases, text })) +
      reserved >
      TAG_METADATA_BYTES ||
    bytes(tag.key) > TAG_KEY_BYTES ||
    bytes(tag.userId) > TAG_KEY_BYTES
  );
}

async function ensureState(ctx: MutationCtx, userId: string) {
  const current = await vectorState(ctx, userId);
  if (current) return current;
  const id = await ctx.db.insert("tagVectorState", {
    userId,
    ready: false,
    backfilled: false,
    cursor: null,
    count: 0,
    vectorBytes: 0,
    overflow: 0,
  });
  const state = await ctx.db.get(id);
  if (!state) throw new Error("Missing tag vector state");
  return state;
}

/** Generic canonical hook. No count/status/nearest-only vector IO. */
export async function syncTagVectors(
  ctx: MutationCtx,
  before: Doc<"tags"> | null,
  after: Doc<"tags"> | null,
) {
  const sameVector =
    before &&
    after &&
    before.userId === after.userId &&
    before.key === after.key &&
    before._creationTime === after._creationTime &&
    equalEmbedding(before.embedding, after.embedding);
  if (
    sameVector &&
    before.name === after.name &&
    before.description === after.description &&
    equalStrings(before.aliases, after.aliases)
  )
    return;
  const source = after ?? before;
  if (!source) return;
  const prior = await ctx.db
    .query("tagVectorSources")
    .withIndex("by_tagId", (q) => q.eq("tagId", source._id))
    .unique();
  const retained = after && (await metadataLibraryRetained(ctx, after.userId));
  const next = retained ? projection(after) : null;
  const nextBytes = next ? getConvexSize(next) + 256 : 0;
  const nextOverflow = !!(retained && overflow(after));
  if (sameVector && prior && retained) {
    if (prior.overflow !== nextOverflow) {
      await ctx.db.patch(prior._id, { overflow: nextOverflow });
      const state = await ensureState(ctx, after.userId);
      await ctx.db.patch(state._id, {
        overflow:
          state.overflow + Number(nextOverflow) - Number(prior.overflow),
      });
    }
    return;
  }
  const row = await ctx.db
    .query("tagVectors")
    .withIndex("by_tagId", (q) => q.eq("tagId", source._id))
    .unique();
  if (row) await ctx.db.delete(row._id);
  if (prior) {
    await ctx.db.delete(prior._id);
    if (await metadataLibraryRetained(ctx, prior.userId)) {
      const state = await ensureState(ctx, prior.userId);
      await ctx.db.patch(state._id, {
        count: state.count - 1,
        vectorBytes: state.vectorBytes - prior.vectorBytes,
        overflow: state.overflow - Number(prior.overflow),
      });
    }
  }
  if (!retained || !next) return;
  const state = await ensureState(ctx, after.userId);
  await ctx.db.insert("tagVectors", next);
  await ctx.db.insert("tagVectorSources", {
    userId: after.userId,
    tagId: after._id,
    vectorBytes: nextBytes,
    overflow: nextOverflow,
  });
  await ctx.db.patch(state._id, {
    count: state.count + 1,
    vectorBytes: state.vectorBytes + nextBytes,
    overflow: state.overflow + Number(nextOverflow),
  });
}

function equalStrings(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function equalEmbedding(a?: readonly number[], b?: readonly number[]) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.length === b.length &&
      a.every((v, i) => Object.is(v, b[i])))
  );
}

/** One canonical row per transaction; never implicitly activates an empty index. */
export async function migrateTagVectors(ctx: MutationCtx, userId: string) {
  if (!(await metadataLibraryRetained(ctx, userId)))
    return { done: true, migrated: 0 };
  const state = await ensureState(ctx, userId);
  if (state.backfilled) return { done: true, migrated: 0 };
  const page = await ctx.db
    .query("tags")
    .withIndex("by_user_key", (q) => q.eq("userId", userId))
    .paginate({
      cursor: state.cursor,
      numItems: 1,
      maximumRowsRead: 1,
      maximumBytesRead: 1_000_000,
    });
  for (const tag of page.page) await syncTagVectors(ctx, null, tag);
  await ctx.db.patch(state._id, {
    cursor: page.continueCursor,
    backfilled: page.isDone,
  });
  return { done: page.isDone, migrated: page.page.length };
}

/** One same-snapshot canonical equality proof. Large canonical baselines refuse
 * activation rather than mistaking a partial byte-bounded page for completion. */
export async function verifyAndActivateTagVectors(
  ctx: MutationCtx,
  userId: string,
) {
  if (!(await metadataLibraryRetained(ctx, userId))) return false;
  const state = await vectorState(ctx, userId);
  if (
    !state?.backfilled ||
    state.overflow ||
    state.count > TAG_VECTOR_COUNT ||
    state.vectorBytes > TAG_VECTOR_BYTES
  )
    return false;
  const page = await ctx.db
    .query("tags")
    .withIndex("by_user_key", (q) => q.eq("userId", userId))
    .paginate({
      cursor: null,
      numItems: TAG_VECTOR_COUNT + 1,
      maximumRowsRead: TAG_VECTOR_COUNT + 1,
      maximumBytesRead: 8_000_000,
    });
  if (!page.isDone || page.page.length !== state.count) return false;
  let totalBytes = 0;
  for (const tag of page.page) {
    const row = await ctx.db
      .query("tagVectors")
      .withIndex("by_tagId", (q) => q.eq("tagId", tag._id))
      .unique();
    const source = await ctx.db
      .query("tagVectorSources")
      .withIndex("by_tagId", (q) => q.eq("tagId", tag._id))
      .unique();
    const size = getConvexSize(projection(tag)) + 256;
    if (
      !row ||
      row.userId !== userId ||
      row.key !== tag.key ||
      row.sourceCreationTime !== tag._creationTime ||
      !equalEmbedding(row.embedding, tag.embedding) ||
      !source ||
      source.userId !== userId ||
      source.overflow ||
      overflow(tag) ||
      source.vectorBytes !== size
    )
      throw new Error("Tag vector equality verification failed");
    totalBytes += size;
  }
  if (totalBytes !== state.vectorBytes)
    throw new Error("Tag vector byte verification failed");
  await ctx.db.patch(state._id, { ready: true });
  return true;
}

export async function purgeTagVectors(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge retained tag vectors");
  const vectors = await ctx.db
    .query("tagVectors")
    .withIndex("by_userId_and_key_and_sourceCreationTime_and_tagId", (q) =>
      q.eq("userId", userId),
    )
    .take(16);
  for (const row of vectors) await ctx.db.delete(row._id);
  if (vectors.length) return vectors.length;
  const sources = await ctx.db
    .query("tagVectorSources")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(32);
  for (const row of sources) await ctx.db.delete(row._id);
  if (sources.length) return sources.length;
  const state = await vectorState(ctx, userId);
  if (!state) return 0;
  await ctx.db.delete(state._id);
  return 1;
}
