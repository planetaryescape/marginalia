import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { ownedArticle } from "../access";

// A shelf row draws a title, author and length, so the article's content and
// HTML (up to ~900 KB each) never need to leave the server.
export function shelfArticle(a: Doc<"articles">) {
  return {
    _id: a._id,
    title: a.title,
    url: a.url,
    author: a.author,
    estimatedReadMinutes: a.estimatedReadMinutes,
    annotationStatus: a.annotationStatus,
    finishedAt: a.finishedAt,
  };
}

// One shelf page reads at most this many saved or loved rows, and each row
// fetches one whole article of up to ~900 KB: 12 x 900 KB = ~10.8 MB, under
// Convex's 16 MiB read limit with room for the small shelf rows themselves.
export const SHELF_PAGE_ROWS = 12;

// Shelf ids and counts read small rows only, so this bound is about response
// size, not the read limit.
export const SHELF_ID_BOUND = 2000;

/** Each row with its article slimmed; rows whose article is gone or not the reader's are dropped. */
export async function withShelfArticles<
  T extends { articleId: Id<"articles"> },
>(ctx: { db: DatabaseReader; readerId: string }, rows: T[]) {
  const items = await Promise.all(
    rows.map(async (row) => {
      const article = await ownedArticle(ctx, row.articleId, ctx.readerId);
      return article ? { ...row, article: shelfArticle(article) } : null;
    }),
  );
  return items.filter((item) => item !== null);
}
