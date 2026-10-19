import { compareValues } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";
import {
  TAG_KEY_BYTES,
  TAG_METADATA_BYTES,
  vocabularyState,
} from "./tagVocabulary";

export const MAX_TAG_ALIASES = 64;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
type ReadCtx = Pick<QueryCtx, "db">;

export function aliasProjection(tag: Doc<"tags">) {
  // Stored aliases are matched by EXACT equality, not normalised again. A raw
  // alias longer than any eligible query key cannot equal that key (UTF-8).
  const aliases = [
    ...new Set(tag.aliases.filter((a) => bytes(a) <= TAG_KEY_BYTES)),
  ];
  const overflow =
    bytes(tag.userId) > TAG_KEY_BYTES ||
    bytes(tag.key) > TAG_KEY_BYTES ||
    aliases.length > MAX_TAG_ALIASES ||
    aliases.reduce((n, a) => n + bytes(a), 0) > TAG_METADATA_BYTES;
  return { aliases: overflow ? [] : aliases, overflow };
}

export function aliasState(ctx: ReadCtx, userId: string) {
  return ctx.db
    .query("tagAliasState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** Canonical before/after is transaction-local proof, including replace. Counts,
 * status and vectors do not change alias identity; don't touch the projection. */
export async function syncTagAliases(
  ctx: MutationCtx,
  before: Doc<"tags"> | null,
  after: Doc<"tags"> | null,
) {
  if (
    before &&
    after &&
    before.userId === after.userId &&
    before.key === after.key &&
    JSON.stringify(before.aliases) === JSON.stringify(after.aliases)
  )
    return;
  const source = after ?? before;
  if (!source) return;
  const prior = await ctx.db
    .query("tagAliasSources")
    .withIndex("by_tagId", (q) => q.eq("tagId", source._id))
    .unique();
  if (prior) {
    const rows = await ctx.db
      .query("tagAliases")
      .withIndex("by_tagId", (q) => q.eq("tagId", source._id))
      .take(MAX_TAG_ALIASES + 1);
    if (rows.length > MAX_TAG_ALIASES)
      throw new Error("Tag alias fanout exceeded");
    for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.delete(prior._id);
    // During account purge state/rows can already be partially removed. Do not
    // resurrect metadata or assume its counters still describe retained rows.
    if (await metadataLibraryRetained(ctx, prior.userId)) {
      const state = await aliasState(ctx, prior.userId);
      if (!state) throw new Error("Missing tag alias state");
      if (prior.overflow)
        await ctx.db.patch(state._id, { overflow: state.overflow - 1 });
    }
  }
  if (!after || !(await metadataLibraryRetained(ctx, after.userId))) return;
  let state = await aliasState(ctx, after.userId);
  if (!state) {
    // Deliberately never infer an empty legacy baseline. Even a new library
    // needs explicit alias migration/verification before alias reads cut over.
    const id = await ctx.db.insert("tagAliasState", {
      userId: after.userId,
      ready: false,
      backfilled: false,
      overflow: 0,
      cursor: null,
    });
    state = await ctx.db.get(id);
  }
  if (!state) throw new Error("Missing tag alias state");
  const projection = aliasProjection(after);
  await ctx.db.insert("tagAliasSources", {
    userId: after.userId,
    tagId: after._id,
    overflow: projection.overflow,
  });
  for (const alias of projection.aliases)
    await ctx.db.insert("tagAliases", {
      userId: after.userId,
      tagId: after._id,
      key: after.key,
      alias,
      sourceCreationTime: after._creationTime,
    });
  if (projection.overflow)
    await ctx.db.patch(state._id, { overflow: state.overflow + 1 });
}

/** One physical canonical row per call, no jobs, vectors rewritten, or readiness
 * cutover. Main exposes/runs this only after installing all generic writer hooks. */
export async function migrateTagAliases(ctx: MutationCtx, userId: string) {
  if (!(await metadataLibraryRetained(ctx, userId)))
    return { done: true, migrated: 0 };
  let state = await aliasState(ctx, userId);
  if (!state) {
    const id = await ctx.db.insert("tagAliasState", {
      userId,
      ready: false,
      backfilled: false,
      overflow: 0,
      cursor: null,
    });
    state = await ctx.db.get(id);
  }
  if (!state) throw new Error("Missing tag alias state");
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
  for (const tag of page.page) await syncTagAliases(ctx, null, tag);
  await ctx.db.patch(state._id, {
    cursor: page.continueCursor,
    backfilled: page.isDone,
  });
  return { done: page.isDone, migrated: page.page.length };
}

/** Same-snapshot winner/equality gate against the deployed, authoritative vector-
 * free payload projection. It is already canonically complete only when its own
 * readiness/overflow checks pass. Never scan canonical vectors to cut over.
 * Oversized libraries remain unready; callers must not combine paginations. */
export async function verifyAndActivateTagAliases(
  ctx: MutationCtx,
  userId: string,
) {
  if (
    bytes(userId) > TAG_KEY_BYTES ||
    !(await metadataLibraryRetained(ctx, userId))
  )
    return false;
  const state = await aliasState(ctx, userId);
  if (!state?.backfilled || state.overflow) return false;
  const vocabulary = await vocabularyState(ctx, userId);
  if (!vocabulary?.ready || vocabulary.overflow) return false;
  const page = await ctx.db
    .query("tagVocabularyPayloads")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .paginate({
      cursor: null,
      numItems: 1024,
      maximumRowsRead: 1024,
      maximumBytesRead: 9_000_000,
    });
  if (!page.isDone) return false;
  // Match Map semantics in canonical index order: direct overwrites, alias fills
  // only absent. Validate every eligible alias, including candidates/inactive.
  const expected = new Map<string, Doc<"tagVocabularyPayloads">>();
  const canonical = page.page.sort(
    (a, b) =>
      compareValues(a.key, b.key) ||
      a.sourceCreationTime - b.sourceCreationTime ||
      compareValues(a.tagId, b.tagId),
  );
  const directKeys = new Set(canonical.map((tag) => tag.key));
  for (const tag of canonical) {
    expected.set(tag.key, tag);
    for (const alias of tag.aliases)
      if (bytes(alias) <= TAG_KEY_BYTES && !expected.has(alias))
        expected.set(alias, tag);
  }
  // Independent cumulative bounds BEFORE winner lookups: at most 1024 queries,
  // 4MB of bounded winner rows, plus the 9MB payload page (one <=~26KB row may
  // cross its byte boundary). 1024 bytes covers each row's fixed fields/IDs.
  if (expected.size > 1024) return false;
  let lookupBytes = 0;
  for (const [key, tag] of expected)
    lookupBytes += bytes(userId) + bytes(key) + bytes(tag.key) + 1024;
  if (lookupBytes > 4_000_000) return false;
  for (const [key, tag] of expected) {
    const direct = directKeys.has(key)
      ? await ctx.db
          .query("tagVocabulary")
          .withIndex(
            "by_userId_and_key_and_sourceCreationTime_and_tagId",
            (q) => q.eq("userId", userId).eq("key", key),
          )
          .order("desc")
          .first()
      : null;
    const alias = directKeys.has(key)
      ? null
      : await ctx.db
          .query("tagAliases")
          .withIndex(
            "by_userId_and_alias_and_key_and_sourceCreationTime_and_tagId",
            (q) => q.eq("userId", userId).eq("alias", key),
          )
          .first();
    const winner = direct ?? alias;
    if (
      winner?.tagId !== tag.tagId ||
      winner.key !== tag.key ||
      winner.sourceCreationTime !== tag.sourceCreationTime
    )
      throw new Error("Tag alias winner verification failed");
  }
  await ctx.db.patch(state._id, { ready: true });
  return true;
}

/** Compact account metadata slot. No pagination, stable caller positions. */
export async function purgeTagAliases(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (await metadataLibraryRetained(ctx, userId))
    throw new Error("Cannot purge retained tag aliases");
  const aliases = await ctx.db
    .query("tagAliases")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(32);
  for (const row of aliases) await ctx.db.delete(row._id);
  if (aliases.length) return aliases.length;
  const sources = await ctx.db
    .query("tagAliasSources")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(32);
  for (const row of sources) await ctx.db.delete(row._id);
  if (sources.length) return sources.length;
  const state = await aliasState(ctx, userId);
  if (!state) return 0;
  await ctx.db.delete(state._id);
  return 1;
}
