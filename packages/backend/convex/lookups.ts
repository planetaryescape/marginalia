import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { requireArticle } from "./access";
import { mutation } from "./functions";
import { dictionaryActive, indexDictionaryLookup } from "./lib/dictionaryIndex";
import { validateIndex } from "./lib/readerBodies";

const MAX_WORD = 200;
const MAX_SENTENCE = 1000;
const MAX_SENSE = 300;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) => {
  // Preserve the legacy code-unit clipping identity, but never persist a split
  // surrogate at the boundary (Convex strings must be valid Unicode).
  return text.length > max
    ? `${text
        .slice(0, max - 1)
        .replace(/[\uD800-\uDBFF]$/, "")
        .trimEnd()}…`
    : text;
};

/** Quotes, brackets and sentence punctuation around a term; `+ # . -` inside or after it are part of the term. */
const AROUND = /^[\s.,;:!?"'“”‘’()[\]{}<>«»]+|[\s.,;:!?"'“”‘’()[\]{}<>«»]+$/g;

/** "Elastic," and "elastic" are one headword; "C++" and "C#" are not. */
export function wordKeyOf(word: string) {
  return word.toLowerCase().replace(AROUND, "");
}

/**
 * Records one completed Define. Retrying the same lookup (Regenerate, a
 * dropped connection) updates the sense instead of adding a second entry.
 */
export const record = mutation({
  args: {
    articleId: v.id("articles"),
    word: v.string(),
    sentence: v.string(),
    paragraphIndex: v.optional(v.number()),
    unitIndex: v.optional(v.number()),
    occurrence: v.optional(v.number()),
    sense: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await dictionaryActive(ctx, ctx.readerId)))
      throw new Error("Library is inactive");
    for (const text of [args.word, args.sentence, args.sense])
      if (new TextEncoder().encode(text).length > 64 * 1024)
        throw new Error("Lookup input exceeds 64 KiB");
    const article = await requireArticle(ctx, args.articleId, ctx.readerId);
    validateIndex(args.unitIndex, "unit");
    validateIndex(args.paragraphIndex, "paragraph");
    validateIndex(args.occurrence, "occurrence");
    const word = clip(collapse(args.word), MAX_WORD);
    const wordKey = wordKeyOf(word);
    const sense = clip(collapse(args.sense), MAX_SENSE);
    if (!wordKey || !sense)
      throw new Error("A lookup needs a word and a sense");
    const sentence = clip(collapse(args.sentence), MAX_SENTENCE);

    // All legacy rows are indexed too (their absent unit is `undefined`).
    // The complete equality range participates in Convex's transaction conflict
    // detection, so concurrent retries cannot both insert an occurrence.
    const repeat = await ctx.db
      .query("lookups")
      .withIndex("by_occurrence", (q) =>
        q
          .eq("userId", ctx.readerId)
          .eq("articleId", args.articleId)
          .eq("unitIndex", args.unitIndex)
          .eq("wordKey", wordKey)
          .eq("paragraphIndex", args.paragraphIndex)
          .eq("occurrence", args.occurrence)
          .eq("sentence", sentence),
      )
      .first();
    if (repeat) {
      await ctx.db.patch("lookups", repeat._id, {
        sense,
        articleTitle: article.title,
      });
      await indexDictionaryLookup(ctx, {
        ...repeat,
        sense,
        articleTitle: article.title,
      });
      return repeat._id;
    }
    const id = await ctx.db.insert("lookups", {
      userId: ctx.readerId,
      articleId: args.articleId,
      word,
      wordKey,
      sentence,
      paragraphIndex: args.paragraphIndex,
      unitIndex: args.unitIndex,
      occurrence: args.occurrence,
      sense,
      articleTitle: article.title,
      createdAt: Date.now(),
    });
    const row = await ctx.db.get("lookups", id);
    if (row) await indexDictionaryLookup(ctx, row);
    return id;
  },
});

const GONE_BATCH = 16;

/**
 * After an article is deleted, marks the reader's lookups of it so the
 * dictionary stops linking to it. A batch at a time, rescheduling itself.
 */
export const markArticleGone = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { userId, articleId, cursor = null }) => {
    const page = await ctx.db
      .query("lookups")
      .withIndex("by_user_article", (q) =>
        q.eq("userId", userId).eq("articleId", articleId),
      )
      .paginate({ numItems: GONE_BATCH, cursor, maximumBytesRead: 256 * 1024 });
    for (const lookup of page.page)
      await ctx.db.patch("lookups", lookup._id, {
        articleGone: true,
        articleTitle: undefined,
      });
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.lookups.markArticleGone, {
        userId,
        articleId,
        cursor: page.continueCursor,
      });
  },
});
