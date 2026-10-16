import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./functions";

/** The librarian cites a handful of articles; more than this is not an answer to show as rows. */
export const MAX_CITED = 8;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // Older imported entries can have malformed URLs.
    return null;
  }
}

/**
 * The library's own articles behind the `/read/<id>` links in a librarian
 * answer. The ids come from model text, so each is checked as an article id
 * and as belonging to this reader; anything else is dropped, never an error.
 */
export const byIds = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const rows = [];
    const seen = new Set<string>();
    for (const raw of args.ids.slice(0, MAX_CITED)) {
      const id = ctx.db.normalizeId("articles", raw);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const article = await ctx.db.get("articles", id as Id<"articles">);
      if (article?.userId !== ctx.readerId) continue;
      rows.push({
        articleId: article._id,
        title: article.title,
        source: hostOf(article.url) ?? article.author ?? null,
        minutes: article.estimatedReadMinutes ?? null,
      });
    }
    return rows;
  },
});
