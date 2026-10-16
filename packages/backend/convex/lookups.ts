import { v } from "convex/values";
import { requireArticle } from "./access";
import { mutation } from "./functions";

const MAX_WORD = 200;
const MAX_SENTENCE = 1000;
const MAX_SENSE = 300;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

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
    occurrence: v.optional(v.number()),
    sense: v.string(),
  },
  handler: async (ctx, args) => {
    const article = await requireArticle(ctx, args.articleId, ctx.readerId);
    const word = clip(collapse(args.word), MAX_WORD);
    const wordKey = wordKeyOf(word);
    const sense = clip(collapse(args.sense), MAX_SENSE);
    if (!wordKey || !sense)
      throw new Error("A lookup needs a word and a sense");
    const sentence = clip(collapse(args.sentence), MAX_SENTENCE);

    const sameWord = await ctx.db
      .query("lookups")
      .withIndex("by_user_word", (q) =>
        q.eq("userId", ctx.readerId).eq("wordKey", wordKey),
      )
      .take(200);
    const repeat = sameWord.find(
      (row) =>
        row.articleId === args.articleId &&
        row.paragraphIndex === args.paragraphIndex &&
        row.occurrence === args.occurrence &&
        row.sentence === sentence,
    );
    if (repeat) {
      await ctx.db.patch("lookups", repeat._id, {
        sense,
        articleTitle: article.title,
      });
      return repeat._id;
    }
    return ctx.db.insert("lookups", {
      userId: ctx.readerId,
      articleId: args.articleId,
      word,
      wordKey,
      sentence,
      paragraphIndex: args.paragraphIndex,
      occurrence: args.occurrence,
      sense,
      articleTitle: article.title,
      createdAt: Date.now(),
    });
  },
});
