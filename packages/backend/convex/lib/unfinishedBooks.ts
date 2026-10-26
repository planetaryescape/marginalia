import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";

/**
 * The reader's newest unfinished books with their article rows. The progress
 * rows carry the finished flag, so finished and archived books are never
 * read, and a long shelf of them can't crowd out a book being read.
 */
export async function unfinishedBooks(
  ctx: { db: DatabaseReader; readerId: string },
  want: number,
): Promise<{ book: Doc<"books">; article: Doc<"articles"> }[]> {
  const books = await ctx.db
    .query("books")
    .withIndex("by_userId_and_finished", (q) =>
      q.eq("userId", ctx.readerId).eq("finished", false),
    )
    .order("desc")
    .take(want);
  const found: { book: Doc<"books">; article: Doc<"articles"> }[] = [];
  for (const book of books) {
    const article = await ctx.db.get("articles", book.articleId);
    if (
      article?.userId === ctx.readerId &&
      article.finishedAt === undefined &&
      article.bookOutline
    )
      found.push({ book, article });
  }
  return found;
}
