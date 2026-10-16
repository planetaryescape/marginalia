import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { query } from "./functions";
import { WORDS_PER_MINUTE } from "./lib/constants";

// Nearest articles on each side of the window. Scoring weighs closeness at two
// points a minute against at most ten for recency, so anything further out than
// this rarely wins, and every article read here is a whole document with its body.
const NEIGHBOURS = 12;

// A saved article that fits scores as if it were this much closer to the window.
// Closeness is worth two points a minute, so four points is two minutes: a saved
// article beats an unsaved one one or two minutes closer, and not one three
// minutes closer. Recency can still outweigh it, as it should for new articles.
const SAVED_BOOST = 4;

/**
 * The best three unread articles for a reading window. A query rather than an
 * action: it stays in the database's runtime, reads only the articles nearest
 * the window's length and is cached until the library changes.
 */
export const forWindow = query({
  args: { requestedMinutes: v.number() },
  handler: async (ctx, args) => {
    const targetMinutes = args.requestedMinutes;
    assertWindow(targetMinutes);
    const [shorter, longer] = await Promise.all([
      ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
          q
            .eq("userId", ctx.readerId)
            .eq("annotationStatus", "annotated")
            .eq("finishedAt", undefined)
            .lte("estimatedReadMinutes", targetMinutes),
        )
        .order("desc")
        .take(NEIGHBOURS),
      ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
          q
            .eq("userId", ctx.readerId)
            .eq("annotationStatus", "annotated")
            .eq("finishedAt", undefined)
            .gt("estimatedReadMinutes", targetMinutes),
        )
        .take(NEIGHBOURS),
    ]);
    // Articles without an estimate sort below every number, so the shorter
    // side still reaches them in a library that has nothing else
    const candidates: Doc<"articles">[] = [...shorter, ...longer];

    const saved = await savedAmong(ctx, candidates);

    const now = Date.now();
    const scored = candidates.map((a) => {
      const readMin = readMinutesOf(a);
      const timeFit = -Math.abs(readMin - targetMinutes);
      let recency = 0;
      if (a.publishedAt) {
        const daysOld = (now - a.publishedAt) / (1000 * 60 * 60 * 24);
        recency = Math.max(0, 10 - daysOld * 0.1);
      }
      // Only an article that fits gets the boost, so it never lifts one past the window
      const boost =
        readMin <= targetMinutes && saved.has(a._id) ? SAVED_BOOST : 0;
      return {
        article: a,
        readMin,
        score: timeFit * 2 + recency + boost,
        fitsWindow: readMin <= targetMinutes * 1.3,
      };
    });
    scored.sort((a, b) => b.score - a.score);

    return scored
      .slice(0, 3)
      .map(({ article, readMin, fitsWindow }) =>
        toSuggestion(article, readMin, targetMinutes, fitsWindow),
      );
  },
});

/**
 * Every unread article that fits the window, closest length first, one page at
 * a time. The client appends pages to the list it already shows, so the order
 * must not shift between pages. Articles of equal length are ordered by the
 * index key; the paging test checks that no page repeats or skips one.
 */
export const moreForWindow = query({
  args: {
    requestedMinutes: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const targetMinutes = args.requestedMinutes;
    assertWindow(targetMinutes);
    const page = await ctx.db
      .query("articles")
      .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
        q
          .eq("userId", ctx.readerId)
          .eq("annotationStatus", "annotated")
          .eq("finishedAt", undefined)
          .lte("estimatedReadMinutes", targetMinutes),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    // The index only bounds articles that have an estimate. One without it is
    // measured by word count here, so it can still be too long for the window.
    // Filtering the page keeps the cursor and isDone: an empty page is a
    // normal result and the client asks for the next one.
    return {
      ...page,
      page: page.page
        .map((a) => ({ article: a, readMin: readMinutesOf(a) }))
        .filter(({ readMin }) => readMin <= targetMinutes)
        .map(({ article, readMin }) =>
          toSuggestion(article, readMin, targetMinutes, true),
        ),
    };
  },
});

/**
 * The single shortest unread article, by the same length `readMinutesOf` gives
 * the deck, offered when nothing fits the reader's window.
 *
 * Read bounds: the index sorts estimates ascending, so the first estimated
 * article is the shortest estimate and one read finds it exactly. Articles
 * without an estimate sort before every estimate and have no length in the
 * index, so they are read in a batch of UNESTIMATED_SCAN. A library with more
 * unestimated unread articles than that gets the shortest of the first batch,
 * in the index's creation-time order.
 */
const UNESTIMATED_SCAN = 100;

export const shortestUnread = query({
  args: {},
  handler: async (ctx) => {
    const [unestimated, shortestEstimated] = await Promise.all([
      ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
          q
            .eq("userId", ctx.readerId)
            .eq("annotationStatus", "annotated")
            .eq("finishedAt", undefined)
            .lt("estimatedReadMinutes", 0),
        )
        .take(UNESTIMATED_SCAN),
      ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
          q
            .eq("userId", ctx.readerId)
            .eq("annotationStatus", "annotated")
            .eq("finishedAt", undefined)
            .gte("estimatedReadMinutes", 0),
        )
        .order("asc")
        .first(),
    ]);
    let best: { article: Doc<"articles">; readMin: number } | undefined;
    for (const article of shortestEstimated
      ? [...unestimated, shortestEstimated]
      : unestimated) {
      const readMin = readMinutesOf(article);
      if (!best || readMin < best.readMin) best = { article, readMin };
    }
    if (!best) return null;
    return {
      _id: best.article._id,
      title: best.article.title,
      estimatedReadMinutes: best.readMin,
    };
  },
});

/** The candidates the reader has saved. Each lookup is scoped to the reader, so another reader's saves never count. */
async function savedAmong(
  ctx: { db: DatabaseReader; readerId: string },
  candidates: Doc<"articles">[],
): Promise<Set<Id<"articles">>> {
  const rows = await Promise.all(
    candidates.map((a) =>
      ctx.db
        .query("savedArticles")
        .withIndex("by_user_article", (q) =>
          q.eq("userId", ctx.readerId).eq("articleId", a._id),
        )
        .first(),
    ),
  );
  return new Set(
    candidates.filter((_, i) => rows[i] !== null).map((a) => a._id),
  );
}

function assertWindow(targetMinutes: number) {
  if (
    !Number.isFinite(targetMinutes) ||
    targetMinutes <= 0 ||
    targetMinutes > 180
  ) {
    throw new Error("Choose a reading window between 1 and 180 minutes.");
  }
}

// Articles without an estimate fall back to their word count, as scoring does
function readMinutesOf(a: Doc<"articles">): number {
  return (
    a.estimatedReadMinutes ??
    (Math.ceil((a.wordCount ?? 0) / WORDS_PER_MINUTE) || 1)
  );
}

function toSuggestion(
  a: Doc<"articles">,
  readMin: number,
  targetMinutes: number,
  fitsWindow: boolean,
) {
  return {
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
  };
}

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
