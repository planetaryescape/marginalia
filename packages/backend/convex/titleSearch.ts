import { v } from "convex/values";
import { query } from "./functions";
import { host, readStatus } from "./lib/articleCard";

/**
 * Candidates read per search. Search results are whole documents and an
 * article row can be close to a megabyte, so this stays far below the 16 MiB
 * read limit; fields are projected before anything is returned.
 */
export const MAX_TITLE_MATCHES = 5;
const MAX_QUERY = 200;
const STATUS_ORDER = { Unread: 0, Started: 1, Read: 2 } as const;

/**
 * The reader's articles whose title matches the typed words, in the shape of
 * `library/find`'s matches. The picker shows a strong one as its first card
 * while the query is still being embedded. Same eligibility as find: the
 * reader's own extracted articles, one per page, unread before read.
 */
export const matchTitles = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const text = args.query.trim().slice(0, MAX_QUERY);
    if (text.length < 2) return [];
    const userId = ctx.readerId;
    const rows = await ctx.db
      .query("articles")
      .withSearchIndex("search_title", (q) =>
        q
          .search("title", text)
          .eq("userId", userId)
          .eq("extractionStatus", "extracted"),
      )
      .take(MAX_TITLE_MATCHES);
    const seenUrls = new Set<string>();
    const matches = [];
    for (const [rank, row] of rows.entries()) {
      // The same page saved twice is one choice.
      if (seenUrls.has(row.url)) continue;
      seenUrls.add(row.url);
      matches.push({
        rank,
        articleId: row._id,
        title: row.title,
        author: row.author ?? null,
        source: host(row.url) ?? null,
        minutes: row.estimatedReadMinutes ?? null,
        status: await readStatus(ctx, userId, row._id),
      });
    }
    return matches
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.rank - b.rank,
      )
      .map(({ rank: _rank, ...match }) => match);
  },
});
