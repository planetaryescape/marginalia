import { paginationOptsValidator } from "convex/server";
import { ownedArticle } from "./access";
import { query } from "./functions";

/** Lookups per page. */
export const DICTIONARY_PAGE = 40;
// Lookups recorded before `articleTitle` was copied onto them read their
// article, whose document can be close to a megabyte. This many per page; the
// backfill removes the need.
const TITLE_FALLBACKS = 8;

/**
 * The reader's lookups, newest first, a page at a time, each with its
 * article's title. The title comes from the lookup itself; article bodies
 * never leave the server. The room loads pages up to a cap of 2,000 lookups
 * and sorts them itself.
 */
export const page = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db
      .query("lookups")
      .withIndex("by_user_created", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, DICTIONARY_PAGE),
      });
    const fetched = new Map<string, string | null>();
    const rows = [];
    for (const row of result.page) {
      let articleTitle = row.articleTitle ?? null;
      let articleGone = row.articleGone === true;
      if (articleTitle === null && !articleGone) {
        if (!fetched.has(row.articleId) && fetched.size < TITLE_FALLBACKS)
          fetched.set(
            row.articleId,
            (await ownedArticle(ctx, row.articleId, ctx.readerId))?.title ??
              null,
          );
        const looked = fetched.get(row.articleId);
        // Past the limit the title is unknown, not gone
        if (looked !== undefined) {
          articleTitle = looked;
          articleGone = looked === null;
        }
      }
      rows.push({
        _id: row._id,
        articleId: row.articleId,
        articleTitle,
        articleGone,
        word: row.word,
        wordKey: row.wordKey,
        sentence: row.sentence,
        paragraphIndex: row.paragraphIndex,
        sense: row.sense,
        createdAt: row.createdAt,
      });
    }
    return { ...result, page: rows };
  },
});
