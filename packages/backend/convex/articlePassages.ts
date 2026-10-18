import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { libraryIsActive, ownedArticle } from "./access";
import { rankPassages } from "./lib/articleAsk";

export const authorized = internalQuery({
  args: { userId: v.string(), articleId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("articles", args.articleId);
    return Boolean(
      id &&
        (await ownedArticle(ctx, id, args.userId)) &&
        (await libraryIsActive(ctx, args.userId)),
    );
  },
});

const identityArgs = {
  userId: v.string(),
  articleId: v.string(),
  contentHash: v.string(),
  model: v.string(),
};

/** The latest requested content/model owns publication; older work cannot win. */
export const prepare = internalMutation({
  args: { ...identityArgs, total: v.number() },
  handler: async (ctx, args) => {
    const articleId = ctx.db.normalizeId("articles", args.articleId);
    if (
      !articleId ||
      !(await ownedArticle(ctx, articleId, args.userId)) ||
      !(await libraryIsActive(ctx, args.userId))
    )
      return null;
    if (!Number.isInteger(args.total) || args.total < 1 || args.total > 1000)
      return null;
    const state = await ctx.db
      .query("articlePassageState")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", articleId),
      )
      .unique();
    if (
      state &&
      state.contentHash === args.contentHash &&
      state.model === args.model &&
      state.total === args.total
    )
      return {
        articleId,
        generation: state.generation,
        ready: state.count === state.total,
      };
    const generation = (state?.generation ?? 0) + 1;
    const next = {
      userId: args.userId,
      articleId,
      contentHash: args.contentHash,
      model: args.model,
      generation,
      count: 0,
      total: args.total,
    };
    if (state) await ctx.db.replace(state._id, next);
    else await ctx.db.insert("articlePassageState", next);
    await ctx.scheduler.runAfter(0, internal.articlePassages.prune, {
      userId: args.userId,
      articleId,
    });
    return { articleId, generation, ready: false };
  },
});

export const append = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    generation: v.number(),
    offset: v.number(),
    passages: v.array(
      v.object({
        startParagraph: v.number(),
        endParagraph: v.number(),
        fromOffset: v.number(),
        toOffset: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (
      !(await ownedArticle(ctx, args.articleId, args.userId)) ||
      !(await libraryIsActive(ctx, args.userId))
    )
      return false;
    const state = await ctx.db
      .query("articlePassageState")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .unique();
    if (!state || state.generation !== args.generation) return false;
    if (
      args.passages.length > 32 ||
      args.passages.some((p) => p.embedding.length > 1536)
    )
      throw new Error("Passage batch too large");
    if (state.count >= args.offset + args.passages.length) return true;
    if (
      state.count !== args.offset ||
      args.offset + args.passages.length > state.total
    )
      return false;
    for (const passage of args.passages)
      await ctx.db.insert("articlePassages", {
        userId: args.userId,
        articleId: args.articleId,
        generation: args.generation,
        contentHash: state.contentHash,
        model: state.model,
        ...passage,
      });
    const count = state.count + args.passages.length;
    await ctx.db.patch(state._id, { count });
    if (count === state.total)
      await ctx.scheduler.runAfter(0, internal.articlePassages.prune, {
        userId: args.userId,
        articleId: args.articleId,
      });
    return true;
  },
});

/** Exact cosine ranking, 32 physical vector reads per transaction, no vector DTO. */
export const rankPage = internalQuery({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    generation: v.number(),
    query: v.array(v.float64()),
    cursor: v.union(v.null(), v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, args.userId))) return null;
    const state = await ctx.db
      .query("articlePassageState")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .unique();
    if (
      !state ||
      state.generation !== args.generation ||
      state.count !== state.total
    )
      return null;
    const page = await ctx.db
      .query("articlePassages")
      .withIndex("by_userId_and_articleId_and_generation", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", args.articleId)
          .eq("generation", args.generation),
      )
      .paginate({ numItems: 32, cursor: args.cursor });
    return {
      ranked: rankPassages(
        page.page.map((p) => ({
          start: p.startParagraph,
          end: p.endParagraph,
          from: p.fromOffset,
          to: p.toOffset,
        })),
        page.page.map((p) => p.embedding),
        args.query,
      ),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const prune = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("articlePassageState")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .unique();
    if (!state) return;
    const rows = await ctx.db
      .query("articlePassages")
      .withIndex("by_userId_and_articleId_and_generation", (q) =>
        q
          .eq("userId", args.userId)
          .eq("articleId", args.articleId)
          .lt("generation", state.generation),
      )
      .take(32);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 32)
      await ctx.scheduler.runAfter(0, internal.articlePassages.prune, args);
  },
});

/** Rows per transaction: each carries a 1536-number vector. */
const DISCARD_BATCH = 64;

/**
 * The passages cached for an article, or null when the article isn't this
 * reader's. The article ID arrives from the browser as text, so it is checked
 * here against the reader. Rows from another version of the text or another
 * embedding model count as no cache.
 */
export const cached = internalQuery({
  args: {
    userId: v.string(),
    articleId: v.string(),
    contentHash: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const articleId = ctx.db.normalizeId("articles", args.articleId);
    if (!articleId || !(await ownedArticle(ctx, articleId, args.userId)))
      return null;
    const rows = await ctx.db
      .query("articlePassages")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", articleId),
      )
      .take(1_000);
    const current = rows.every(
      (row) => row.contentHash === args.contentHash && row.model === args.model,
    );
    return {
      articleId,
      passages: current
        ? rows
            .sort((a, b) => a.startParagraph - b.startParagraph)
            .map((row) => ({
              startParagraph: row.startParagraph,
              endParagraph: row.endParagraph,
              fromOffset: row.fromOffset,
              toOffset: row.toOffset,
              embedding: row.embedding,
            }))
        : [],
    };
  },
});

/** Replaces an article's cached passages with a fresh set. */
export const replace = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    contentHash: v.string(),
    model: v.string(),
    passages: v.array(
      v.object({
        startParagraph: v.number(),
        endParagraph: v.number(),
        fromOffset: v.number(),
        toOffset: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Legacy replacement cannot clobber a versioned cache built by new code.
    const versioned = await ctx.db
      .query("articlePassageState")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .unique();
    if (versioned) return;
    // A reader being deleted gets nothing new written for them
    if (
      !(await libraryIsActive(ctx, args.userId)) ||
      !(await ownedArticle(ctx, args.articleId, args.userId))
    )
      return;
    const old = await ctx.db
      .query("articlePassages")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .take(1_000);
    for (const row of old) await ctx.db.delete("articlePassages", row._id);
    for (const passage of args.passages)
      await ctx.db.insert("articlePassages", {
        userId: args.userId,
        articleId: args.articleId,
        contentHash: args.contentHash,
        model: args.model,
        ...passage,
      });
  },
});

/** Removes a deleted article's passages, a batch at a time. */
export const discard = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("articlePassageState")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .unique();
    if (state) await ctx.db.delete(state._id);
    const rows = await ctx.db
      .query("articlePassages")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .take(DISCARD_BATCH);
    for (const row of rows) await ctx.db.delete("articlePassages", row._id);
    if (rows.length === DISCARD_BATCH)
      await ctx.scheduler.runAfter(0, internal.articlePassages.discard, args);
  },
});
