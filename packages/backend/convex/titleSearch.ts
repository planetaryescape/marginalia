import { v } from "convex/values";
import { query } from "./functions";
import { host, readStatus } from "./lib/articleCard";
import {
  metadataReady,
  readLegacyDocument,
  resolveArticleCard,
  takeCards,
} from "./lib/articleMetadata";
import { isStrongTextMatch, requiredWords } from "./lib/textMatchStrength";

/**
 * Preserve the established ranking bound while searching small card records.
 */
export const MAX_TITLE_MATCHES = 5;
/** Candidates read in full. Article bodies reach about 900 KB, so five stay far below the 16 MiB read limit. */
export const MAX_TEXT_MATCHES = 5;
const MAX_QUERY = 200;
const STATUS_ORDER = { "Up next": 0, Reading: 1, Finished: 2 } as const;

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
    const source = (await metadataReady(ctx, userId))
      ? ctx.db
          .query("articleMetadata")
          .withSearchIndex("search_title", (q) =>
            q
              .search("title", text)
              .eq("userId", userId)
              .eq("extractionStatus", "extracted"),
          )
      : ctx.db
          .query("articles")
          .withSearchIndex("search_title", (q) =>
            q
              .search("title", text)
              .eq("userId", userId)
              .eq("extractionStatus", "extracted"),
          );
    const rows = await takeCards(ctx, userId, source, MAX_TITLE_MATCHES);
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
        url: row.url,
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

/**
 * The reader's articles whose text holds every typed word, for the topics that
 * name no title. Full-text search matches any shared term, so strength is
 * judged here, where the text is: a hit is returned only when every typed word
 * of three or more letters (stop words aside, the last as a prefix) appears as
 * a word in its title, excerpt or text. Same card shape and order as
 * `matchTitles`.
 */
export const matchText = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    // Strength is judged on the whole query; only the text sent to the index is capped.
    const required = requiredWords(args.query.trim());
    if (!required) return [];
    const indexText = args.query.normalize("NFC").trim().slice(0, MAX_QUERY);
    const userId = ctx.readerId;
    // Only `articles` holds the text; the card table keeps headers alone.
    const source = ctx.db
      .query("articles")
      .withSearchIndex("search_content", (q) =>
        q
          .search("content", indexText)
          .eq("userId", userId)
          .eq("extractionStatus", "extracted"),
      );
    const iterator = source[Symbol.asyncIterator]();
    const seenUrls = new Set<string>();
    const matches = [];
    try {
      for (let rank = 0; rank < MAX_TEXT_MATCHES; rank++) {
        const row = await readLegacyDocument(ctx, async () => {
          const next = await iterator.next();
          return next.done ? null : next.value;
        });
        if (!row) break;
        if (!isStrongTextMatch(required, row)) continue;
        const card = await resolveArticleCard(ctx, row);
        if (!card) continue;
        // The same page saved twice is one choice.
        if (seenUrls.has(card.url)) continue;
        seenUrls.add(card.url);
        matches.push({
          rank,
          articleId: card._id,
          title: card.title,
          author: card.author ?? null,
          source: host(card.url) ?? null,
          url: card.url,
          minutes: card.estimatedReadMinutes ?? null,
          status: await readStatus(ctx, userId, card._id),
        });
      }
    } finally {
      await iterator.return?.();
    }
    return matches
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.rank - b.rank,
      )
      .map(({ rank: _rank, ...match }) => match);
  },
});
