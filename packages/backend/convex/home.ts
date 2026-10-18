import { paginationOptsValidator } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { ownedArticle } from "./access";
import { query } from "./functions";
import { isReading } from "./lib/shelfArticle";
import { unfinishedBooks } from "./lib/unfinishedBooks";
import { unreadQueue } from "./lib/unreadQueue";

const BOOKS_ON_THE_SHELF = 5;

/** Current desk callers need counters, not the legacy hydrated overview. */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.db
      .query("readingQueueStats")
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

function queuedEntry(a: Doc<"articles">) {
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

function bookEntry(a: Doc<"articles">) {
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
      unreadQueue(ctx, 10),
      ctx.db
        .query("readingQueueStats")
        .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
        .unique(),
      ctx.db
        .query("userNotes")
        .withIndex("by_user_recent", (q) => q.eq("userId", ctx.readerId))
        .order("desc")
        .take(1),
      unfinishedBooks(ctx, BOOKS_ON_THE_SHELF),
    ]);
    // A book keeps no text on its article row and isn't in the unread queue,
    // so the shelf lists it from its own row
    const bookEntries = books.map(({ article: a }) => bookEntry(a));

    const latest = notes[0];
    const latestNoteArticle = latest
      ? await ownedArticle(ctx, latest.articleId, ctx.readerId)
      : null;

    return {
      countsReady: stats?.ready ?? false,
      annotatedTotal: stats?.annotated ?? unread.length,
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

// A page ends at this many articles or bytes read, whichever comes first, and
// the client asks for the next. An article row can be close to a megabyte, so
// the byte limit is what keeps a page under Convex's 16 MiB read limit.
const UP_NEXT_PAGE_MAX = 8;
const UP_NEXT_PAGE_BYTES = 8_000_000;

/**
 * The Up next shelf, a page at a time, with Convex's own cursors. One index
 * range holds everything unread and unarchived; annotated and deferred
 * articles are picked from it. Unfinished books ride on the first page only.
 */
export const upNextPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db
      .query("articles")
      .withIndex("by_user_finishedAt", (q) =>
        q.eq("userId", ctx.readerId).eq("finishedAt", undefined),
      )
      .order("desc")
      .filter((q) =>
        q.or(
          q.eq(q.field("annotationStatus"), "annotated"),
          q.eq(q.field("annotationStatus"), "deferred"),
        ),
      )
      .paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, UP_NEXT_PAGE_MAX),
        maximumBytesRead: UP_NEXT_PAGE_BYTES,
      });
    const books =
      paginationOpts.cursor === null
        ? await unfinishedBooks(ctx, BOOKS_ON_THE_SHELF)
        : [];
    const withReading = (article: Doc<"articles">) =>
      isReading(ctx, ctx.readerId, article).then((reading) => ({
        article,
        reading,
      }));
    const [bookRows, pageRows] = await Promise.all([
      Promise.all(books.map(({ article }) => withReading(article))),
      Promise.all(result.page.map(withReading)),
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
