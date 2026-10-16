import { paginationOptsValidator } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { ownedArticle } from "./access";
import { query } from "./functions";
import { unfinishedBooks } from "./lib/unfinishedBooks";
import { unreadQueue, unreadQueuePage } from "./lib/unreadQueue";

const BOOKS_ON_THE_SHELF = 5;

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

/**
 * The Up next shelf, a page at a time. It takes Convex's pagination options so
 * `usePaginatedQuery` can drive it, but the cursor is the creation time of the
 * last row shown (see `unreadQueuePage`). Unfinished books ride on the first
 * page only.
 */
export const upNextPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { cursor, endCursor, numItems } = paginationOpts;
    const time = (value: string | null | undefined) => {
      const n = value ? Number(value) : Number.NaN;
      return Number.isFinite(n) ? n : null;
    };
    const after = time(cursor);
    const { rows, isDone } = await unreadQueuePage(ctx, {
      after,
      through: time(endCursor),
      numItems,
    });
    const books =
      cursor === null ? await unfinishedBooks(ctx, BOOKS_ON_THE_SHELF) : [];
    const last = rows.at(-1);
    return {
      page: [
        ...books.map(({ article }) => bookEntry(article)),
        ...rows.map(queuedEntry),
      ],
      isDone,
      continueCursor: last ? String(last._creationTime) : (cursor ?? ""),
    };
  },
});
