import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./functions";
import { WORDS_PER_MINUTE } from "./lib/constants";

// Nearest articles on each side of the window. Scoring weighs closeness at two
// points a minute against at most ten for recency, so anything further out than
// this rarely wins, and every article read here is a whole document with its body.
const NEIGHBOURS = 12;

/**
 * The best three unread articles for a reading window. A query rather than an
 * action: it stays in the database's runtime, reads only the articles nearest
 * the window's length and is cached until the library changes.
 */
export const forWindow = query({
  args: { requestedMinutes: v.number() },
  handler: async (ctx, args) => {
    const targetMinutes = args.requestedMinutes;
    if (
      !Number.isFinite(targetMinutes) ||
      targetMinutes <= 0 ||
      targetMinutes > 180
    ) {
      throw new Error("Choose a reading window between 1 and 180 minutes.");
    }
    const [shorter, longer] = await Promise.all([
      ctx.db
        .query("articles")
        .withIndex(
          "by_userId_and_bibleTranslation_and_annotationStatus_and_finishedAt_and_minutes",
          (q) =>
            q
              .eq("userId", ctx.readerId)
              .eq("bible.translation", undefined)
              .eq("annotationStatus", "annotated")
              .eq("finishedAt", undefined)
              .lte("estimatedReadMinutes", targetMinutes),
        )
        .order("desc")
        .take(NEIGHBOURS),
      ctx.db
        .query("articles")
        .withIndex(
          "by_userId_and_bibleTranslation_and_annotationStatus_and_finishedAt_and_minutes",
          (q) =>
            q
              .eq("userId", ctx.readerId)
              .eq("bible.translation", undefined)
              .eq("annotationStatus", "annotated")
              .eq("finishedAt", undefined)
              .gt("estimatedReadMinutes", targetMinutes),
        )
        .take(NEIGHBOURS),
    ]);
    // Articles without an estimate sort below every number, so the shorter
    // side still reaches them in a library that has nothing else
    const candidates: Doc<"articles">[] = [...shorter, ...longer].filter(
      (a) => !a.bible,
    );

    const now = Date.now();
    const scored = candidates.map((a) => {
      const readMin =
        a.estimatedReadMinutes ??
        (Math.ceil((a.wordCount ?? 0) / WORDS_PER_MINUTE) || 1);
      const timeFit = -Math.abs(readMin - targetMinutes);
      let recency = 0;
      if (a.publishedAt) {
        const daysOld = (now - a.publishedAt) / (1000 * 60 * 60 * 24);
        recency = Math.max(0, 10 - daysOld * 0.1);
      }
      return {
        article: a,
        readMin,
        score: timeFit * 2 + recency,
        fitsWindow: readMin <= targetMinutes * 1.3,
      };
    });
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, 3).map(({ article: a, readMin, fitsWindow }) => ({
      _id: a._id,
      title: a.title,
      author: a.author,
      url: a.url,
      imageUrl: a.imageUrl,
      estimatedReadMinutes: readMin,
      publishedAt: a.publishedAt,
      excerpt: a.excerpt,
      feedId: a.feedId,
      reason: generateReason(readMin, targetMinutes, fitsWindow),
    }));
  },
});

function generateReason(
  readMin: number,
  targetMinutes: number,
  fitsWindow: boolean,
): string {
  if (fitsWindow && Math.abs(readMin - targetMinutes) <= 2) {
    return `Fits your ${targetMinutes}-minute window`;
  }
  if (fitsWindow) {
    return `${readMin} min read — within your window`;
  }
  if (readMin < targetMinutes) {
    return `${readMin} min — shorter than requested, but worth your time`;
  }
  return `${readMin} min — longer than requested`;
}
