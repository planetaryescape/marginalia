import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ownedArticle, requireReader } from "./access";
import { DEFAULT_USER_ID } from "./lib/constants";
import {
  MAX_PREPARED_BYTES,
  PREPARED_FORMAT,
  type PreparedReference,
  representationHash,
  sourceHash,
} from "./lib/preparedRepresentation";

const scopeArgs = {
  userId: v.string(),
  articleId: v.string(),
  unitIndex: v.optional(v.number()),
};
const reference = {
  format: v.literal(PREPARED_FORMAT),
  sourceHash: v.string(),
  representationHash: v.string(),
};

async function liveSource(
  ctx: QueryCtx,
  args: { userId: string; articleId: string; unitIndex?: number },
) {
  if ((await requireReader(ctx)) !== args.userId) return null;
  if (args.userId !== DEFAULT_USER_ID) {
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.userId))
      .unique();
    if (reader?.status !== "active" || reader.deletingAt !== undefined)
      return null;
  }
  const id = ctx.db.normalizeId("articles", args.articleId);
  const article = id && (await ownedArticle(ctx, id, args.userId));
  if (!article) return null;
  if (args.unitIndex !== undefined) {
    if (
      !Number.isInteger(args.unitIndex) ||
      args.unitIndex < 0 ||
      !article.bookUnitCount
    )
      return null;
    const unit = await ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", article._id)
          .eq("index", args.unitIndex ?? -1),
      )
      .unique();
    return unit
      ? {
          articleId: article._id,
          hash: await sourceHash(unit.content, unit.contentHtml),
        }
      : null;
  }
  if (article.bookUnitCount) return null;
  return {
    articleId: article._id,
    hash: await sourceHash(article.content, article.contentHtml),
  };
}

export const prepare = internalMutation({
  args: {
    ...scopeArgs,
    sourceHash: v.string(),
    paragraphs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const source = await liveSource(ctx, args);
    if (!source || source.hash !== args.sourceHash) return null;
    const bytes = new TextEncoder().encode(
      JSON.stringify(args.paragraphs),
    ).byteLength;
    if (
      !args.paragraphs.length ||
      args.paragraphs.length > 4000 ||
      args.paragraphs.some((p) => p.length > 300_000) ||
      bytes > MAX_PREPARED_BYTES
    )
      throw new Error("Prepared representation too large");
    const hash = await representationHash(args.paragraphs);
    const old = await ctx.db
      .query("preparedArticles")
      .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", source.articleId)
          .eq("unitIndex", args.unitIndex),
      )
      .unique();
    const ref: PreparedReference = {
      format: PREPARED_FORMAT,
      sourceHash: source.hash,
      representationHash: hash,
    };
    // One version per scope: retries and concurrent tabs cannot grow history.
    if (old?.sourceHash !== source.hash || old.representationHash !== hash) {
      const row = {
        userId: args.userId,
        articleId: source.articleId,
        unitIndex: args.unitIndex,
        ...ref,
        paragraphs: args.paragraphs,
        bytes,
      };
      if (old) await ctx.db.replace(old._id, row);
      else await ctx.db.insert("preparedArticles", row);
    }
    return ref;
  },
});

export const read = internalQuery({
  args: { ...scopeArgs, reference: v.object(reference) },
  handler: async (ctx, args) => {
    const source = await liveSource(ctx, args);
    if (!source || source.hash !== args.reference.sourceHash) return null;
    const row = await ctx.db
      .query("preparedArticles")
      .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", source.articleId)
          .eq("unitIndex", args.unitIndex),
      )
      .unique();
    return row?.sourceHash === source.hash &&
      row.representationHash === args.reference.representationHash
      ? row.paragraphs
      : null;
  },
});

export const PREPARED_PURGE_BATCH = 3;

/** <=3 rows / 2.85MB. Positive count requires a fresh transaction before other body work. */
export async function purgePreparedPage(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
  articleId?: Id<"articles">,
) {
  const query =
    articleId === undefined
      ? ctx.db
          .query("preparedArticles")
          .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
            q.eq("userId", userId),
          )
      : ctx.db
          .query("preparedArticles")
          .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
            q.eq("userId", userId).eq("articleId", articleId),
          );
  const rows = await query.take(PREPARED_PURGE_BATCH);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}
