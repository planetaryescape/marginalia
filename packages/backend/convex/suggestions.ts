import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { z } from "zod";
import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { ownedArticleCard } from "./access";
import { query } from "./functions";
import { needsAnnotationStart } from "./lib/annotationPolicy";
import {
  type ArticleCard,
  bookPartCard,
  cardPagination,
  metadataReady,
  readLegacyDocument,
  reserveLegacyPage,
  resolveArticleCard,
  resolveArticleCards,
  takeCards,
  windowSource,
} from "./lib/articleMetadata";
import { type BookCandidate, bookReason, nextUnitIndex } from "./lib/bookPicks";
import { WORDS_PER_MINUTE } from "./lib/constants";
import { TASTE_MAX, type Taste } from "./lib/taste";
import { loadTaste, tasteReason } from "./taste";

// Nearest articles on each side of the window. Scoring weighs closeness at two
// points a minute against at most ten for recency, so anything further out than
// this rarely wins. Candidates now come from physically small card records.
const NEIGHBOURS = 12;

// A saved article that fits scores as if it were this much closer to the window.
// Closeness is worth two points a minute, so four points is two minutes: a saved
// article beats an unsaved one one or two minutes closer, and not one three
// minutes closer. Recency can still outweigh it, as it should for new articles.
const SAVED_BOOST = 4;

// Annotation work does not gate reading. Retain existing status cursors and
// append readable skipped text; the first picks share the primary card budget.
const OFFERED = ["annotated", "deferred", "failed", "skipped"] as const;
type Offered = (typeof OFFERED)[number];

// Keep the established candidate/ranking bounds across the storage migration.
const DEFERRED_NEIGHBOURS = 4;
// 12 annotated/skipped, 4 deferred and 2 failed per side: 36 small candidates.
const FAILED_NEIGHBOURS = 2;

// A book in progress is the reader's own choice, so it earns the same lift as a
// saved article when its next part fits
const BOOK_BOOST = SAVED_BOOST;
// Unfinished books considered per request, newest first. Only their next
// part's title and minutes are read, never the whole outline.
const BOOKS_CONSIDERED = 5;

type Reader = { db: DatabaseReader; readerId: string };

/**
 * Each unfinished book's next part, when it fits the window (D-DES-055). A part
 * further on is never offered in its place, so a book has at most one pick.
 */
async function bookPicks(ctx: Reader, minutes: number) {
  const picks: {
    article: ArticleCard;
    candidate: BookCandidate;
    reason: string;
    started: boolean;
  }[] = [];
  const books = await ctx.db
    .query("books")
    .withIndex("by_userId_and_finished", (q) =>
      q.eq("userId", ctx.readerId).eq("finished", false),
    )
    .order("desc")
    .take(BOOKS_CONSIDERED);
  const ready = await metadataReady(ctx, ctx.readerId);
  for (const book of books) {
    // Preserve the old pre-migration journey: its one body/outline read also
    // supplies the next part, rather than adding five large book-unit joins.
    const legacy = ready
      ? null
      : await readLegacyDocument(ctx, () =>
          ctx.db.get("articles", book.articleId),
        );
    const article = ready
      ? await ownedArticleCard(ctx, book.articleId, ctx.readerId)
      : legacy?.userId === ctx.readerId
        ? await resolveArticleCard(ctx, legacy)
        : null;
    if (!article || article.finishedAt !== undefined) continue;
    const unitIndex = nextUnitIndex(book);
    const oldUnit = legacy?.bookOutline?.[unitIndex];
    const unit = ready
      ? await bookPartCard(ctx, ctx.readerId, book.articleId, unitIndex)
      : oldUnit;
    const candidate =
      unit && unit.minutes <= minutes && unitIndex < book.unitCount
        ? {
            unitIndex,
            title: unit.title,
            minutes: unit.minutes,
            of: legacy?.bookOutline?.length ?? book.unitCount,
          }
        : null;
    if (candidate)
      picks.push({
        article,
        candidate,
        reason: bookReason(book, candidate.unitIndex),
        started: book.furthestUnit >= 0 || book.finishedThrough >= 0,
      });
  }
  return picks;
}

function toBookSuggestion(pick: Awaited<ReturnType<typeof bookPicks>>[number]) {
  const { article, candidate, reason, started } = pick;
  return {
    _id: article._id,
    title: `${article.title} · Part ${candidate.unitIndex + 1} of ${candidate.of}`,
    author: article.author,
    url: article.url,
    imageUrl: article.imageUrl,
    estimatedReadMinutes: candidate.minutes,
    publishedAt: undefined,
    excerpt: undefined,
    feedId: undefined,
    deferred: false,
    reason,
    book: {
      unitIndex: candidate.unitIndex,
      unitTitle: candidate.title,
      started,
    },
  };
}

async function shorterOrEqual(
  ctx: Reader,
  status: Offered,
  minutes: number,
  limit: number,
) {
  const source = await windowSource(
    ctx,
    ctx.readerId,
    status,
    "lte",
    minutes,
    "desc",
  );
  return takeCards(ctx, ctx.readerId, source, limit);
}

async function longer(
  ctx: Reader,
  status: Offered,
  minutes: number,
  limit: number,
) {
  const source = await windowSource(ctx, ctx.readerId, status, "gt", minutes);
  return takeCards(ctx, ctx.readerId, source, limit);
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
    const reads: ArticleCard[][] = [];
    for (const status of OFFERED) {
      const limit =
        status === "annotated" || status === "skipped"
          ? NEIGHBOURS
          : status === "deferred"
            ? DEFERRED_NEIGHBOURS
            : FAILED_NEIGHBOURS;
      // Skipped text fills unused primary slots, preserving the 36-card read
      // ceiling and the existing annotated/deferred/failed priority.
      const shorterLimit =
        status === "skipped" ? NEIGHBOURS - reads[0].length : limit;
      const longerLimit =
        status === "skipped" ? NEIGHBOURS - reads[1].length : limit;
      reads.push(
        shorterLimit
          ? await shorterOrEqual(ctx, status, targetMinutes, shorterLimit)
          : [],
      );
      reads.push(
        longerLimit
          ? await longer(ctx, status, targetMinutes, longerLimit)
          : [],
      );
    }
    const candidates: ArticleCard[] = reads.flat();

    const saved = await savedAmong(ctx, candidates);
    // Tag links only, never an article's text, so the 12/4/2 neighbour budget holds
    const taste = await loadTaste(ctx, candidates);

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
      const fits = readMin <= targetMinutes;
      const boost = fits && saved.has(a._id) ? SAVED_BOOST : 0;
      // Taste is bounded and only moves an article that fits, so fit still wins
      const liked = fits ? taste.get(a._id) : undefined;
      return {
        article: a,
        readMin,
        taste: liked,
        score: timeFit * 2 + recency + boost + (liked?.term ?? 0) * TASTE_MAX,
        fitsWindow: readMin <= targetMinutes * 1.3,
      };
    });
    // Equal scores fall back to the id, so the pick never depends on which
    // range or storage order an article was read from
    const offers = [
      ...scored.map(({ article, readMin, fitsWindow, score, taste }) => ({
        score,
        id: article._id as string,
        taste,
        suggestion: toSuggestion(article, readMin, targetMinutes, fitsWindow),
      })),
      ...(await bookPicks(ctx, targetMinutes)).map((pick) => ({
        score:
          -Math.abs(pick.candidate.minutes - targetMinutes) * 2 + BOOK_BOOST,
        id: pick.article._id as string,
        taste: undefined as Taste | undefined,
        suggestion: toBookSuggestion(pick),
      })),
    ];
    offers.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    return Promise.all(
      offers.slice(0, 3).map(async (offer) => ({
        ...offer.suggestion,
        // What taste noticed, when it has something to say; else length and window
        reason:
          (await tasteReason(ctx, offer.taste)) ?? offer.suggestion.reason,
      })),
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
 * that no page repeats or skips one. Taste shapes only the deck's first picks
 * (forWindow): re-ranking inside a page would make the order depend on where
 * Convex splits it.
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
    const paging = await cardPagination(ctx, ctx.readerId, {
      ...args.paginationOpts,
      cursor: inner,
      endCursor: end.status === status ? end.inner : null,
    });
    if (paging.legacy) reserveLegacyPage(ctx, 3_000_000);
    const page = paging.wrap(
      await (
        await windowSource(
          ctx,
          ctx.readerId,
          status,
          "lte",
          targetMinutes,
          "desc",
          paging.legacy,
        )
      ).paginate({
        ...paging.opts,
        numItems: Math.min(args.paginationOpts.numItems, 8),
        maximumBytesRead: 3_000_000,
      }),
    );
    const following = OFFERED[OFFERED.indexOf(status) + 1];
    const next =
      following && page.isDone
        ? writeCursor(following, null)
        : writeCursor(status, page.continueCursor);
    // The index only bounds articles that have an estimate. One without it is
    // measured by word count here, so it can still be too long for the window.
    // Filtering the page keeps the cursor and isDone: an empty page is a
    // normal result and the client asks for the next one.
    // A book's next part rides on the first page; the deck drops repeats
    const books =
      status === "annotated" && !args.paginationOpts.cursor
        ? (await bookPicks(ctx, targetMinutes)).map(toBookSuggestion)
        : [];
    return {
      ...page,
      isDone: following ? false : page.isDone,
      continueCursor: next,
      splitCursor: page.splitCursor
        ? writeCursor(status, page.splitCursor)
        : page.splitCursor,
      page: [
        ...(await resolveArticleCards(ctx, page.page))
          .filter((a) => a.bookUnitCount === undefined)
          .map((a) => ({ article: a, readMin: readMinutesOf(a) }))
          .filter(({ readMin }) => readMin <= targetMinutes)
          .map(({ article, readMin }) =>
            toSuggestion(article, readMin, targetMinutes, true),
          ),
        ...books,
      ],
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
    const reads: ArticleCard[][] = [];
    for (const status of OFFERED) {
      reads.push(
        await takeCards(
          ctx,
          ctx.readerId,
          await windowSource(ctx, ctx.readerId, status, "lt", 0),
          UNESTIMATED_SCAN,
        ),
      );
      reads.push(
        await takeCards(
          ctx,
          ctx.readerId,
          await windowSource(ctx, ctx.readerId, status, "gte", 0),
          1,
        ),
      );
    }
    let best: { article: ArticleCard; readMin: number } | undefined;
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
  candidates: ArticleCard[],
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
function readMinutesOf(a: ArticleCard): number {
  return (
    a.estimatedReadMinutes ??
    (Math.ceil((a.wordCount ?? 0) / WORDS_PER_MINUTE) || 1)
  );
}

function toSuggestion(
  a: ArticleCard,
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
    book: null as {
      unitIndex: number;
      unitTitle: string;
      started: boolean;
    } | null,
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
