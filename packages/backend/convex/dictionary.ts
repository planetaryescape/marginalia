import { paginationOptsValidator } from "convex/server";
import { ownedArticle } from "./access";
import { query } from "./functions";

/** Lookups per page; each page reads one document per distinct article in it. */
export const DICTIONARY_PAGE = 40;

/**
 * The reader's lookups, newest first, a page at a time, each with its
 * article's title. Only the title leaves the server: article bodies never do.
 * The room loads pages up to a cap of 2,000 lookups and sorts them itself.
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
    const titles = new Map<string, Promise<string | null>>();
    const titleOf = (id: (typeof result.page)[number]["articleId"]) => {
      let title = titles.get(id);
      if (!title) {
        title = ownedArticle(ctx, id, ctx.readerId).then(
          (a) => a?.title ?? null,
        );
        titles.set(id, title);
      }
      return title;
    };
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) => ({
          _id: row._id,
          articleId: row.articleId,
          // Null once the article is deleted: the entry stays, the link goes
          articleTitle: await titleOf(row.articleId),
          word: row.word,
          wordKey: row.wordKey,
          sentence: row.sentence,
          paragraphIndex: row.paragraphIndex,
          sense: row.sense,
          createdAt: row.createdAt,
        })),
      ),
    };
  },
});
