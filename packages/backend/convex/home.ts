import { paginationOptsValidator } from "convex/server";
import type { DatabaseReader } from "./_generated/server";
import { ownedArticleCard } from "./access";
import { query } from "./functions";
import {
  type ArticleCard,
  cardPagination,
  reserveLegacyPage,
  resolveArticleCards,
  takeCards,
  unreadSource,
} from "./lib/articleMetadata";
import { UNREAD_STATUSES } from "./lib/readingEligibility";
import { isReading } from "./lib/shelfArticle";

const BOOKS_ON_THE_SHELF = 5;

/** Current desk callers need counters, not the legacy hydrated overview. */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.db
      .query("readableQueueStats")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .unique();
    return {
      countsReady: stats?.ready ?? false,
      annotatedTotal: stats?.ready ? stats.annotated : null,
      waiting: stats?.ready ? stats.waiting : null,
      pending: stats?.ready ? stats.pending : null,
      fits: {
        5: stats?.ready ? stats.fits5 : null,
        10: stats?.ready ? stats.fits10 : null,
        20: stats?.ready ? stats.fits20 : null,
        30: stats?.ready ? stats.waiting : null,
      },
    };
  },
});

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function queuedEntry(a: ArticleCard) {
  return {
    _id: a._id,
    title: a.title,
    author: a.author,
    source: a.uploadedFileName ? "PDF" : hostOf(a.url),
    minutes: a.estimatedReadMinutes,
    excerpt: a.excerpt?.slice(0, 180),
    fromReader: Boolean(a.readerDocumentId),
  };
}

function bookEntry(a: ArticleCard) {
  return {
    _id: a._id,
    title: a.title,
    author: a.author,
    source: `Book · ${a.bookUnitCount ?? 0} parts`,
    minutes: undefined,
    excerpt: a.excerpt?.slice(0, 180),
    fromReader: false,
  };
}

/** Everything the home page shows, without shipping article bodies to the client. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const [unread, stats, notes, books] = await Promise.all([
      unreadCards(ctx, 10),
      ctx.db
        .query("readableQueueStats")
        .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
        .unique(),
      ctx.db
        .query("userNotes")
        .withIndex("by_user_recent", (q) => q.eq("userId", ctx.readerId))
        .order("desc")
        .take(1),
      unfinishedCardBooks(ctx),
    ]);
    // A book keeps no text on its article row and isn't in the unread queue,
    // so the shelf lists it from its own row
    const bookEntries = books.map(({ article: a }) => bookEntry(a));

    const latest = notes[0];
    const latestNoteArticle = latest
      ? await ownedArticleCard(ctx, latest.articleId, ctx.readerId)
      : null;

    return {
      countsReady: stats?.ready ?? false,
      annotatedTotal: stats?.ready ? stats.annotated : unread.length,
      waiting: stats?.ready ? stats.waiting : null,
      pending: stats?.ready ? stats.pending : null,
      fits: {
        5: stats?.ready ? stats.fits5 : null,
        10: stats?.ready ? stats.fits10 : null,
        20: stats?.ready ? stats.fits20 : null,
        30: stats?.ready ? stats.waiting : null,
      },
      upNext: [...bookEntries, ...unread.map(queuedEntry)].slice(0, 10),
      latestNote: latest
        ? {
            articleId: latest.articleId,
            articleTitle: latestNoteArticle?.title,
            selectedText: latest.selectedText,
            text: latest.contentPlain.slice(0, 220),
            prompt: latest.prompt,
            createdAt: latest.createdAt,
          }
        : null,
    };
  },
});

// Preserve the established paging size. During migration legacy body reads
// share the transaction-wide fallback budget with the first page's books.
const UP_NEXT_PAGE_MAX = 8;
const UP_NEXT_PAGE_BYTES = 3_000_000;

/**
 * The Up next shelf, a page at a time, with Convex's own cursors. One index
 * range holds everything unread and unarchived; readable queued
 * articles are picked from it. Unfinished books ride on the first page only.
 */
export const upNextPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const paging = await cardPagination(ctx, ctx.readerId, paginationOpts);
    if (paging.legacy) reserveLegacyPage(ctx, UP_NEXT_PAGE_BYTES);
    const result = paging.wrap(
      await (
        await unreadSource(ctx, ctx.readerId, undefined, paging.legacy)
      ).paginate({
        ...paging.opts,
        numItems: Math.min(paginationOpts.numItems, UP_NEXT_PAGE_MAX),
        maximumBytesRead: UP_NEXT_PAGE_BYTES,
      }),
    );
    const books =
      paginationOpts.cursor === null ? await unfinishedCardBooks(ctx) : [];
    const withReading = (article: ArticleCard) =>
      isReading(ctx, ctx.readerId, article).then((reading) => ({
        article,
        reading,
      }));
    const [bookRows, pageRows] = await Promise.all([
      Promise.all(books.map(({ article }) => withReading(article))),
      Promise.all(
        (await resolveArticleCards(ctx, result.page)).map(withReading),
      ),
    ]);
    return {
      ...result,
      page: [
        ...bookRows.map(({ article, reading }) => ({
          ...bookEntry(article),
          reading,
        })),
        ...pageRows.map(({ article, reading }) => ({
          ...queuedEntry(article),
          reading,
        })),
      ],
    };
  },
});

async function unfinishedCardBooks(ctx: {
  db: DatabaseReader;
  readerId: string;
}) {
  const books = await ctx.db
    .query("books")
    .withIndex("by_userId_and_finished", (q) =>
      q.eq("userId", ctx.readerId).eq("finished", false),
    )
    .order("desc")
    .take(BOOKS_ON_THE_SHELF);
  const found: { article: ArticleCard }[] = [];
  for (const book of books) {
    const article = await ownedArticleCard(ctx, book.articleId, ctx.readerId);
    if (article && article.finishedAt === undefined) found.push({ article });
  }
  return found;
}

async function unreadCards(
  ctx: { db: DatabaseReader; readerId: string },
  limit: number,
) {
  const rows: ArticleCard[] = [];
  for (const status of UNREAD_STATUSES) {
    rows.push(
      ...(await takeCards(
        ctx,
        ctx.readerId,
        await unreadSource(ctx, ctx.readerId, status),
        limit,
      )),
    );
  }
  return rows
    .sort(
      (a, b) => b._creationTime - a._creationTime || (a._id < b._id ? -1 : 1),
    )
    .slice(0, limit);
}
