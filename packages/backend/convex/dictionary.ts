import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ownedArticleCard } from "./access";
import { internalMutation, mutation, query } from "./functions";
import {
  boundedDictionaryText,
  dictionaryActive,
  dictionaryState,
  foldDictionary,
  indexDictionaryLookup,
  SEARCH_BYTES,
} from "./lib/dictionaryIndex";

/** Lookups per page. */
export const DICTIONARY_PAGE = 40;
// Older lookups need title cards. Cap joins, including guarded near-limit
// source fallbacks for libraries whose metadata has not been backfilled.
const TITLE_FALLBACKS = 8;

function pageSize(requested: number, max: number) {
  if (!Number.isSafeInteger(requested) || requested < 1)
    throw new Error("Page size must be a positive integer");
  return Math.min(requested, max);
}

/**
 * The reader's lookups, newest first, a page at a time, each with its
 * article's title. The title comes from the lookup itself; article bodies
 * never leave the server. Legacy cached clients retain this contract. Current
 * clients use headwords/senses; this endpoint is not a complete dictionary.
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
        numItems: pageSize(paginationOpts.numItems, DICTIONARY_PAGE),
        maximumBytesRead: 256 * 1024,
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
            (await ownedArticleCard(ctx, row.articleId, ctx.readerId))?.title ??
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
        unitIndex: row.unitIndex,
        sense: row.sense,
        createdAt: row.createdAt,
      });
    }
    return { ...result, page: rows };
  },
});

const HEADWORDS = 40;
const SEARCH_SCAN = 100;
const SENSES = 4;
const READ_BYTES = 256 * 1024;
const encoder = new TextEncoder();

function validateCursor(cursor: string | null) {
  if (cursor !== null && encoder.encode(cursor).length > 32_000)
    throw new Error("Dictionary cursor is too long");
}

/** Alphabetic keyset pages. Search scans at most 100 small derived chunks;
 * an empty unfinished page is NOT evidence of no matching word. */
export const headwords = query({
  args: {
    after: v.union(v.string(), v.null()),
    query: v.string(),
    letter: v.optional(v.string()),
  },
  handler: async (ctx, { after, query: text, letter }) => {
    validateCursor(after);
    if (encoder.encode(text).length > SEARCH_BYTES)
      throw new Error("Search is limited to 256 UTF-8 bytes");
    if (letter !== undefined && !/^(#|[A-Z])$/.test(letter))
      throw new Error("Invalid dictionary letter");
    // `done` ends this index scan, not an unfinished legacy migration.
    // An absent state is conservatively partial until prepare/first write.
    const partial =
      (await dictionaryState(ctx, ctx.readerId))?.complete !== true;
    const needle = foldDictionary(text.trim());
    if (!needle) {
      const rows =
        letter === undefined
          ? await ctx.db
              .query("dictionaryHeadwords")
              .withIndex("by_user_order", (q) =>
                q.eq("userId", ctx.readerId).gt("orderKey", after ?? ""),
              )
              .take(HEADWORDS + 1)
          : await ctx.db
              .query("dictionaryHeadwords")
              .withIndex("by_user_letter_order", (q) =>
                q
                  .eq("userId", ctx.readerId)
                  .eq("letter", letter)
                  .gt("orderKey", after ?? ""),
              )
              .take(HEADWORDS + 1);
      const page = rows.slice(0, HEADWORDS);
      const done = rows.length <= HEADWORDS;
      return {
        page,
        done,
        after: done ? null : page[page.length - 1].orderKey,
        scanned: page.length,
        partial,
      };
    }
    const chunks =
      letter === undefined
        ? await ctx.db
            .query("dictionarySearch")
            .withIndex("by_user_scan", (q) =>
              q.eq("userId", ctx.readerId).gt("scanKey", after ?? ""),
            )
            .take(SEARCH_SCAN + 1)
        : await ctx.db
            .query("dictionarySearch")
            .withIndex("by_user_letter_scan", (q) =>
              q
                .eq("userId", ctx.readerId)
                .eq("letter", letter)
                .gt("scanKey", after ?? ""),
            )
            .take(SEARCH_SCAN + 1);
    const page = [];
    const seen = new Set<string>();
    const manifests = new Map<
      Id<"lookups">,
      Doc<"dictionaryOccurrences"> | null
    >();
    let next = after;
    let scanned = 0;
    for (const chunk of chunks.slice(0, SEARCH_SCAN)) {
      scanned++;
      next = chunk.scanKey;
      if (!manifests.has(chunk.lookupId))
        manifests.set(
          chunk.lookupId,
          await ctx.db
            .query("dictionaryOccurrences")
            .withIndex("by_lookup", (q) => q.eq("lookupId", chunk.lookupId))
            .unique(),
        );
      if (manifests.get(chunk.lookupId)?.generation !== chunk.generation)
        continue;
      if (!chunk.foldedWord.includes(needle) && !chunk.text.includes(needle))
        continue;
      if (seen.has(chunk.headwordId)) continue;
      const head = await ctx.db.get("dictionaryHeadwords", chunk.headwordId);
      if (
        !head ||
        head.userId !== ctx.readerId ||
        (letter && head.letter !== letter)
      )
        continue;
      seen.add(head._id);
      page.push(head);
      if (page.length === HEADWORDS) break;
    }
    // If the final scanned headword was already emitted, skip its remaining
    // chunks. This keeps one grouped headword across continuation pages.
    const last = chunks[scanned - 1];
    if (last && manifests.get(last.lookupId)?.generation !== last.generation)
      next = `${last.scanKey.slice(0, last.scanKey.lastIndexOf("~"))}~~`;
    if (last && seen.has(last.headwordId)) {
      const head = page.find((h) => h._id === last.headwordId);
      if (head) next = `${head.orderKey}~~`;
    }
    const done = scanned === chunks.length;
    return { page, done, after: done ? null : next, scanned, partial };
  },
});

function validateMonth(monthStart: number, monthEnd: number) {
  if (
    !Number.isFinite(monthStart) ||
    !Number.isFinite(monthEnd) ||
    monthEnd <= monthStart ||
    monthEnd - monthStart > 32 * 86400000
  )
    throw new Error("Invalid calendar month");
}

/** Bounded first count page; explicit continuation can finish any month.
 * Boundaries are supplied by the browser, preserving local calendar months. */
export const summary = query({
  args: { monthStart: v.number(), monthEnd: v.number() },
  handler: async (ctx, { monthStart, monthEnd }) => {
    validateMonth(monthStart, monthEnd);
    const state = await dictionaryState(ctx, ctx.readerId);
    const month = await ctx.db
      .query("dictionaryHeadwords")
      .withIndex("by_user_firstSeen", (q) =>
        q
          .eq("userId", ctx.readerId)
          .gte("firstSeen", monthStart)
          .lt("firstSeen", monthEnd),
      )
      .paginate({ numItems: 256, cursor: null, maximumBytesRead: READ_BYTES });
    const letters = await Promise.all(
      ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(async (letter) => ({
        letter,
        hasWords: !!(await ctx.db
          .query("dictionaryHeadwords")
          .withIndex("by_user_letter_order", (q) =>
            q.eq("userId", ctx.readerId).eq("letter", letter),
          )
          .first()),
      })),
    );
    // One legacy lookup proves that an absent state isn't a fresh account.
    const fresh = state
      ? false
      : !(await ctx.db
          .query("lookups")
          .withIndex("by_user_created", (q) => q.eq("userId", ctx.readerId))
          .first());
    return {
      total: state?.total ?? 0,
      complete: state?.complete ?? fresh,
      month: month.page.length,
      monthCursor: month.isDone ? null : month.continueCursor,
      monthComplete: month.isDone && (state?.complete ?? fresh),
      letters,
    };
  },
});

export const monthCount = query({
  args: {
    monthStart: v.number(),
    monthEnd: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { monthStart, monthEnd, paginationOpts }) => {
    validateMonth(monthStart, monthEnd);
    validateCursor(paginationOpts.cursor);
    const result = await ctx.db
      .query("dictionaryHeadwords")
      .withIndex("by_user_firstSeen", (q) =>
        q
          .eq("userId", ctx.readerId)
          .gte("firstSeen", monthStart)
          .lt("firstSeen", monthEnd),
      )
      .paginate({
        cursor: paginationOpts.cursor,
        numItems: pageSize(paginationOpts.numItems, 256),
        maximumBytesRead: READ_BYTES,
      });
    return {
      count: result.page.length,
      done: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
      partial: (await dictionaryState(ctx, ctx.readerId))?.complete !== true,
    };
  },
});

/** Only the chosen headword loads occurrence bodies, four at a time. */
export const senses = query({
  args: { wordKey: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { wordKey, paginationOpts }) => {
    validateCursor(paginationOpts.cursor);
    if (encoder.encode(wordKey).length > 1600)
      throw new Error("Headword is too long");
    const result = await ctx.db
      .query("lookups")
      .withIndex("by_user_word_created_order", (q) =>
        q.eq("userId", ctx.readerId).eq("wordKey", wordKey),
      )
      .paginate({
        cursor: paginationOpts.cursor,
        numItems: pageSize(paginationOpts.numItems, SENSES),
        maximumBytesRead: READ_BYTES,
      });
    const articles = new Map<
      Id<"articles">,
      Awaited<ReturnType<typeof ownedArticleCard>>
    >();
    const page = [];
    for (const row of result.page) {
      // At most four card joins; unmigrated/deferred sources retain their
      // guarded full-document fallback. Alphabet/search do not join articles.
      if (!row.articleGone && !articles.has(row.articleId))
        articles.set(
          row.articleId,
          await ownedArticleCard(ctx, row.articleId, ctx.readerId),
        );
      const article = articles.get(row.articleId);
      page.push({
        _id: row._id,
        word: row.word,
        wordKey: row.wordKey,
        sense: row.sense,
        sentence: row.sentence,
        createdAt: row.createdAt,
        paragraphIndex: row.paragraphIndex,
        unitIndex: row.unitIndex,
        articleId: row.articleId,
        articleGone: row.articleGone === true || !article,
        articleTitle:
          row.articleGone || !article
            ? null
            : boundedDictionaryText(row.articleTitle ?? article.title, 1024),
      });
    }
    return {
      ...result,
      page,
      partial: (await dictionaryState(ctx, ctx.readerId))?.complete !== true,
    };
  },
});

async function backfillDictionaryPage(ctx: MutationCtx, userId: string) {
  if (!(await dictionaryActive(ctx, userId)))
    return { complete: false, inactive: true, processed: 0 };
  let state = await dictionaryState(ctx, userId);
  if (state?.complete) return { complete: true, inactive: false, processed: 0 };
  if (!state) {
    const id = await ctx.db.insert("dictionaryState", {
      userId,
      total: 0,
      complete: false,
      cursor: null,
    });
    state = await ctx.db.get("dictionaryState", id);
  }
  if (!state) throw new Error("Dictionary state missing");
  const result = await ctx.db
    .query("lookups")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .paginate({
      cursor: state.cursor,
      numItems: 16,
      maximumBytesRead: READ_BYTES,
    });
  for (const row of result.page) {
    // Mixed old clients call the same record mutation, which already adopts
    // legacy occurrences. Replayed backfill must not count them again.
    if (!row.dictionaryHeadwordId || !row.dictionarySenseOrder)
      await indexDictionaryLookup(ctx, row);
  }
  await ctx.db.patch("dictionaryState", state._id, {
    cursor: result.continueCursor,
    complete: result.isDone,
  });
  return {
    complete: result.isDone,
    inactive: false,
    processed: result.page.length,
  };
}

/** Explicit only: no deploy hook, cron, or automatically scheduled drain.
 * Main may call repeatedly with a library ID after backend-first deployment. */
export const backfillPage = internalMutation({
  args: { userId: v.string() },
  handler: (ctx, { userId }) => backfillDictionaryPage(ctx, userId),
});

/** The reader may explicitly advance preparation while a legacy library is
 * being migrated. Progress lives server-side, so retries/resume are idempotent. */
export const preparePage = mutation({
  args: {},
  handler: (ctx) => backfillDictionaryPage(ctx, ctx.readerId),
});

/** Optional explicit compaction after a large historical sense was revised.
 * Only obsolete derived chunks are removed, never lookup history. */
export const cleanupPage = internalMutation({
  args: { userId: v.string(), after: v.union(v.string(), v.null()) },
  handler: async (ctx, { userId, after }) => {
    validateCursor(after);
    if (!(await dictionaryActive(ctx, userId)))
      return { done: true, after: null, removed: 0 };
    const chunks = await ctx.db
      .query("dictionarySearch")
      .withIndex("by_user_scan", (q) =>
        q.eq("userId", userId).gt("scanKey", after ?? ""),
      )
      .take(65);
    let removed = 0;
    for (const chunk of chunks.slice(0, 64)) {
      const manifest = await ctx.db
        .query("dictionaryOccurrences")
        .withIndex("by_lookup", (q) => q.eq("lookupId", chunk.lookupId))
        .unique();
      if (!manifest || manifest.generation !== chunk.generation) {
        await ctx.db.delete("dictionarySearch", chunk._id);
        removed++;
      }
    }
    return {
      done: chunks.length <= 64,
      after: chunks.length <= 64 ? null : chunks[63].scanKey,
      removed,
    };
  },
});
