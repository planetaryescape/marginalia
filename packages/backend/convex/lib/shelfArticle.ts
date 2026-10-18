import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { ownedArticleCard } from "../access";

// A shelf row draws a title, author and length, so the article's content and
// HTML (up to ~900 KB each) never need to leave the server.
export function shelfArticle(
  a: Pick<
    Doc<"articles">,
    | "_id"
    | "title"
    | "url"
    | "author"
    | "estimatedReadMinutes"
    | "annotationStatus"
    | "finishedAt"
  >,
) {
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

// Keep stable paging while joining physically small owned card records.
export const SHELF_PAGE_ROWS = 12;

// Compatibility-only ID endpoint. Visible cards query their own membership;
// exact counts use initialized counters, not this bound.
export const SHELF_ID_BOUND = 2000;

/**
 * Reading is the state of an article the reader has opened and not finished,
 * the same state Up next and the shelves label "Reading" (02, the states).
 */
export async function isReading(
  ctx: { db: DatabaseReader },
  userId: string,
  article: Pick<Doc<"articles">, "_id" | "finishedAt">,
): Promise<boolean> {
  if (article.finishedAt !== undefined) return false;
  const opened = await ctx.db
    .query("articleInteractions")
    .withIndex("by_user_article_action", (q) =>
      q
        .eq("userId", userId)
        .eq("articleId", article._id)
        .eq("action", "opened"),
    )
    .first();
  return opened !== null;
}

/** Each row with its article slimmed; rows whose article is gone or not the reader's are dropped. */
export async function withShelfArticles<
  T extends { articleId: Id<"articles"> },
>(ctx: { db: DatabaseReader; readerId: string }, rows: T[]) {
  const items = await Promise.all(
    rows.map(async (row) => {
      const article = await ownedArticleCard(ctx, row.articleId, ctx.readerId);
      if (!article) return null;
      const reading = await isReading(ctx, ctx.readerId, article);
      return { ...row, article: { ...shelfArticle(article), reading } };
    }),
  );
  return items.filter((item) => item !== null);
}
