import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { query } from "./functions";
import { needsAnnotationStart } from "./lib/annotationPolicy";
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

// Annotated articles come first, then the long ones still waiting for their
// marginalia (D-DES-056), then ones whose annotation failed: all are readable,
// and the desk starts the marginalia of the last two ahead of time.
const OFFERED = ["annotated", "deferred", "failed"] as const;
type Offered = (typeof OFFERED)[number];

// Deferred articles are long and each read is a whole document with its body,
// so fewer of them are read per side.
const DEFERRED_NEIGHBOURS = 6;

type Reader = { db: DatabaseReader; readerId: string };

function shorterOrEqual(
  ctx: Reader,
  status: Offered,
  minutes: number,
  limit: number,
) {
  return ctx.db
    .query("articles")
    .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
      q
        .eq("userId", ctx.readerId)
        .eq("annotationStatus", status)
        .eq("finishedAt", undefined)
        .lte("estimatedReadMinutes", minutes),
    )
    .order("desc")
    .take(limit);
}

function longer(ctx: Reader, status: Offered, minutes: number, limit: number) {
  return ctx.db
    .query("articles")
    .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
      q
        .eq("userId", ctx.readerId)
        .eq("annotationStatus", status)
        .eq("finishedAt", undefined)
        .gt("estimatedReadMinutes", minutes),
    )
    .take(limit);
}

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
    const reads = await Promise.all(
      OFFERED.flatMap((status) => {
        const limit = status === "annotated" ? NEIGHBOURS : DEFERRED_NEIGHBOURS;
        return [
          shorterOrEqual(ctx, status, targetMinutes, limit),
          longer(ctx, status, targetMinutes, limit),
        ];
      }),
    );
    // Articles without an estimate sort below every number, so the shorter
    // side still reaches them in a library that has nothing else
    const candidates: Doc<"articles">[] = reads.flat();

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
    // Equal scores fall back to the id, so the pick never depends on which
    // range or storage order an article was read from
    scored.sort(
      (a, b) => b.score - a.score || a.article._id.localeCompare(b.article._id),
    );

    return scored
      .slice(0, 3)
      .map(({ article, readMin, fitsWindow }) =>
        toSuggestion(article, readMin, targetMinutes, fitsWindow),
      );
  },
});

// One page is one status's index range. A cursor says which status it is in,
// so the annotated articles page first and the deferred, then failed, ones
// follow, in an order that never shifts under a client appending pages.
const pageCursor = z.tuple([z.enum(OFFERED), z.string().nullable()]);

function readCursor(cursor: string | null | undefined) {
  if (!cursor) {
    const status: Offered = "annotated";
    return { status, inner: null };
  }
  const [status, inner] = pageCursor.parse(JSON.parse(cursor));
  return { status, inner };
}

function writeCursor(status: Offered, inner: string | null | undefined) {
  return JSON.stringify([status, inner ?? null]);
}

/**
 * Every unread article that fits the window, closest length first, one page at
 * a time: annotated articles, then the deferred ones. The client appends pages
 * to the list it already shows, so the order must not shift between pages.
 * Articles of equal length are ordered by the index key; the paging test checks
 * that no page repeats or skips one.
 */
export const moreForWindow = query({
  args: {
    requestedMinutes: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const targetMinutes = args.requestedMinutes;
    assertWindow(targetMinutes);
    const { status, inner } = readCursor(args.paginationOpts.cursor);
    const end = readCursor(args.paginationOpts.endCursor);
    const page = await ctx.db
      .query("articles")
      .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
        q
          .eq("userId", ctx.readerId)
          .eq("annotationStatus", status)
          .eq("finishedAt", undefined)
          .lte("estimatedReadMinutes", targetMinutes),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        cursor: inner,
        // A page pinned to the hand-over into the next status has no end here
        endCursor: end.status === status ? end.inner : null,
      });
    const following = OFFERED[OFFERED.indexOf(status) + 1];
    const next =
      following && page.isDone
        ? writeCursor(following, null)
        : writeCursor(status, page.continueCursor);
    // The index only bounds articles that have an estimate. One without it is
    // measured by word count here, so it can still be too long for the window.
    // Filtering the page keeps the cursor and isDone: an empty page is a
    // normal result and the client asks for the next one.
    return {
      ...page,
      isDone: following ? false : page.isDone,
      continueCursor: next,
      splitCursor: page.splitCursor
        ? writeCursor(status, page.splitCursor)
        : page.splitCursor,
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
    const reads = await Promise.all(
      OFFERED.flatMap((status) => [
        ctx.db
          .query("articles")
          .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
            q
              .eq("userId", ctx.readerId)
              .eq("annotationStatus", status)
              .eq("finishedAt", undefined)
              .lt("estimatedReadMinutes", 0),
          )
          .take(UNESTIMATED_SCAN),
        ctx.db
          .query("articles")
          .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
            q
              .eq("userId", ctx.readerId)
              .eq("annotationStatus", status)
              .eq("finishedAt", undefined)
              .gte("estimatedReadMinutes", 0),
          )
          .order("asc")
          .first()
          .then((article) => (article ? [article] : [])),
      ]),
    );
    let best: { article: Doc<"articles">; readMin: number } | undefined;
    for (const article of reads.flat()) {
      const readMin = readMinutesOf(article);
      // A tie keeps the lower id, so storage order never decides it
      if (
        !best ||
        readMin < best.readMin ||
        (readMin === best.readMin && article._id < best.article._id)
      )
        best = { article, readMin };
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
    // Not annotated yet (long, or a failed first try); the desk asks for its
    // marginalia ahead of time
    deferred: needsAnnotationStart(a),
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
