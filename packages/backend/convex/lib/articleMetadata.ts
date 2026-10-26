import type {
  GenericDocument,
  OrderedQuery,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import { ConvexError, getDocumentSize } from "convex/values";
import { z } from "zod";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { biblePreferences } from "./bibleSettings";
import {
  readableArticleFilter,
  readableMetadataFilter,
  UNREAD_STATUSES,
} from "./readingEligibility";
import { metadataLibraryActive, metadataLibraryRetained } from "./shelfCounts";

function displayText(text: string, limit: number) {
  const prefix = text.slice(0, limit);
  const last = prefix.charCodeAt(prefix.length - 1);
  // A valid source string must not become an unpaired surrogate at the cap.
  return last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix;
}

// Display records are deliberately bounded, even for malformed imported headers.
export function articleProjection(a: Doc<"articles">) {
  return {
    articleId: a._id,
    userId: a.userId,
    sourceCreationTime: a._creationTime,
    title: displayText(a.title, 2048),
    // Empty + explicit deferred marker is not a different URL/identity.
    // Actual card callers resolve rare oversized originals under the shared
    // byte budget; ordinary cards never read their source body.
    url: a.url.length <= 8192 ? a.url : "",
    guid: a.guid.length <= 8192 ? a.guid : "",
    urlDeferred: a.url.length > 8192 ? true : undefined,
    guidDeferred: a.guid.length > 8192 ? true : undefined,
    author: a.author && displayText(a.author, 512),
    imageUrl: a.imageUrl && a.imageUrl.length <= 8192 ? a.imageUrl : undefined,
    excerpt: a.excerpt && displayText(a.excerpt, 512),
    feedId: a.feedId,
    publishedAt: a.publishedAt,
    estimatedReadMinutes: a.estimatedReadMinutes,
    wordCount: a.wordCount,
    extractionStatus: a.extractionStatus,
    annotationStatus: a.annotationStatus,
    annotationRetries: a.annotationRetries,
    annotationVersion: a.annotationVersion,
    hasContent: Boolean(a.content),
    finishedAt: a.finishedAt,
    bookUnitCount: a.bookUnitCount,
    bible: a.bible,
    uploadedFileName:
      a.uploadedFileName && displayText(a.uploadedFileName, 512),
    readerDocumentId:
      a.readerDocumentId && displayText(a.readerDocumentId, 512),
    createdAt: a.createdAt,
  };
}

export type ArticleCard = Omit<
  Doc<"articleMetadata">,
  "_id" | "_creationTime" | "articleId" | "sourceCreationTime"
> &
  Pick<Doc<"articles">, "_id" | "_creationTime">;

function articleCard(a: Doc<"articles"> | Doc<"articleMetadata">): ArticleCard {
  const { articleId, sourceCreationTime, ...fields } =
    "articleId" in a ? a : articleProjection(a);
  // Do not expose the derived table's system identity.
  return { ...fields, _id: articleId, _creationTime: sourceCreationTime };
}

export async function syncArticleMetadata(
  ctx: MutationCtx,
  before: Doc<"articles"> | null,
  after: Doc<"articles"> | null,
) {
  if (
    before &&
    after &&
    JSON.stringify(articleProjection(before)) ===
      JSON.stringify(articleProjection(after))
  )
    return;
  const id = after?._id ?? before?._id;
  if (!id) return;
  const old = await ctx.db
    .query("articleMetadata")
    .withIndex("by_articleId", (q) => q.eq("articleId", id))
    .unique();
  if (!after || !(await metadataLibraryRetained(ctx, after.userId))) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  const fields = articleProjection(after);
  if (old) await ctx.db.replace(old._id, fields);
  else await ctx.db.insert("articleMetadata", fields);
}

export async function syncBookPartCard(
  ctx: MutationCtx,
  before: Doc<"bookUnits"> | null,
  after: Doc<"bookUnits"> | null,
) {
  const unit = after ?? before;
  if (!unit) return;
  const fields = after ? bookPartProjection(after) : null;
  const prior = before ? bookPartProjection(before) : null;
  if (fields && prior && JSON.stringify(fields) === JSON.stringify(prior))
    return;
  const old = await ctx.db
    .query("bookPartCards")
    .withIndex("by_unitId", (q) => q.eq("unitId", unit._id))
    .unique();
  const parent = fields
    ? await ctx.db
        .query("articleMetadata")
        .withIndex("by_articleId", (q) => q.eq("articleId", fields.articleId))
        .unique()
    : null;
  if (
    !fields ||
    parent?.userId !== fields.userId ||
    !(await metadataLibraryRetained(ctx, fields.userId))
  ) {
    if (old) await ctx.db.delete(old._id);
    return;
  }
  if (old) await ctx.db.replace(old._id, { ...fields, unitId: unit._id });
  else await ctx.db.insert("bookPartCards", { ...fields, unitId: unit._id });
}

function bookPartProjection(unit: Doc<"bookUnits">) {
  return {
    userId: unit.userId,
    articleId: unit.articleId,
    index: unit.index,
    title: displayText(unit.title, 2048),
    minutes: unit.estimatedReadMinutes,
  };
}

export async function metadataReady(ctx: Pick<QueryCtx, "db">, userId: string) {
  return (
    (
      await ctx.db
        .query("libraryMetadataState")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique()
    )?.articlesReady === true
  );
}

/** Account creation calls this in its transaction, after registering the reader.
 * Never declare a populated legacy library initialized from a guessed zero. */
export async function initializeEmptyMetadata(
  ctx: MutationCtx,
  userId: string,
) {
  if (!(await metadataLibraryActive(ctx, userId))) return false;
  const populated = await Promise.all([
    ctx.db
      .query("articles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first(),
    ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) =>
        q.eq("userId", userId),
      )
      .first(),
    ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first(),
    ctx.db
      .query("lovedArticles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first(),
  ]);
  if (populated.some(Boolean)) return false;
  const state = await ctx.db
    .query("libraryMetadataState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (state) return state.phase === "done";
  await ctx.db.insert("libraryMetadataState", {
    userId,
    articlesReady: true,
    phase: "done",
    cursor: null,
  });
  const counts = await ctx.db
    .query("shelfCounts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (counts)
    await ctx.db.patch(counts._id, { saved: 0, loved: 0, ready: true });
  else
    await ctx.db.insert("shelfCounts", {
      userId,
      saved: 0,
      loved: 0,
      ready: true,
    });
  return true;
}

// Transaction-local bytes only, not a personal-data/auth cache. Reserve a full
// document before every read, then charge its actual Convex storage size.
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const LEGACY_BYTES = 10 * MAX_DOCUMENT_BYTES;
type LegacyBudget = {
  used: number;
  reserved: number;
  physicalUsed: number;
  physicalReserved: number;
  physicalLimit: number;
  limit: number;
  tail: Promise<void>;
};
const legacyReads = new WeakMap<QueryCtx["db"], LegacyBudget>();
function legacyBudget(ctx: Pick<QueryCtx, "db">) {
  let budget = legacyReads.get(ctx.db);
  if (!budget) {
    budget = {
      used: 0,
      reserved: 0,
      physicalUsed: 0,
      physicalReserved: 0,
      physicalLimit: Number.POSITIVE_INFINITY,
      limit: LEGACY_BYTES,
      tail: Promise.resolve(),
    };
    legacyReads.set(ctx.db, budget);
  }
  return budget;
}
function reserveLegacyBytes(
  ctx: Pick<QueryCtx, "db">,
  bytes: number,
  body = true,
) {
  const budget = legacyBudget(ctx);
  if (
    budget.physicalUsed + budget.physicalReserved + bytes >
    budget.physicalLimit
  )
    throw new ConvexError(
      "Reporting data exceeds this request's read budget. No partial result was returned.",
    );
  if (body && budget.used + budget.reserved + bytes > budget.limit)
    throw new ConvexError(
      "Article headers exceed this request's read budget. Request fewer articles.",
    );
  if (body) budget.reserved += bytes;
  budget.physicalReserved += bytes;
  return (actual: number) => {
    if (body) {
      budget.reserved -= bytes;
      budget.used += actual;
    }
    budget.physicalReserved -= bytes;
    budget.physicalUsed += actual;
  };
}

/** A body-reading caller may leave less headroom after its other physical reads.
 * Tighten the same queued authority; never increase the default legacy policy. */
export function limitLegacyReadBytes(ctx: Pick<QueryCtx, "db">, bytes: number) {
  const budget = legacyBudget(ctx);
  budget.limit = Math.min(budget.limit, Math.max(0, bytes));
}

export function readLegacyDocument<T extends GenericDocument>(
  ctx: Pick<QueryCtx, "db">,
  read: () => Promise<T | null>,
): Promise<T | null> {
  return readBudgetedDocument(ctx, read, true);
}

/** Legacy reports reserve 3 MiB for authentication before entering the handler
 * (owner row, reader row, and live-session component lookup, each <= 1 MiB).
 * Source scans, compact joins and prose/title bodies share this authority; body
 * reads ALSO retain the existing 10 MiB policy. No independent fallback pool. */
export function readReportingDocument<T extends GenericDocument>(
  ctx: Pick<QueryCtx, "db">,
  read: () => Promise<T | null>,
): Promise<T | null> {
  const budget = legacyBudget(ctx);
  budget.physicalLimit = Math.min(
    budget.physicalLimit,
    13 * MAX_DOCUMENT_BYTES,
  );
  return readBudgetedDocument(ctx, read, false);
}

function readBudgetedDocument<T extends GenericDocument>(
  ctx: Pick<QueryCtx, "db">,
  read: () => Promise<T | null>,
  body: boolean,
): Promise<T | null> {
  const budget = legacyBudget(ctx);
  // Queue body reads and retained-report reads so worst-case reservations do
  // not overlap. Unrelated compact identity joins keep their existing behavior.
  const result = budget.tail.then(async () => {
    const charge = reserveLegacyBytes(ctx, MAX_DOCUMENT_BYTES, body);
    let row: T | null = null;
    try {
      row = await read();
      return row;
    } finally {
      charge(row ? getDocumentSize(row) : 0);
    }
  });
  budget.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** A paginated filtered range may read non-returned rows. Reserve its entire
 * physical byte ceiling plus one document of overshoot, not just page.length. */
export function reserveLegacyPage(
  ctx: Pick<QueryCtx, "db">,
  maximumBytesRead: number,
) {
  const reserved = maximumBytesRead + MAX_DOCUMENT_BYTES;
  reserveLegacyBytes(ctx, reserved)(reserved);
}

export async function resolveArticleCard(
  ctx: Pick<QueryCtx, "db">,
  row: Doc<"articles"> | Doc<"articleMetadata">,
): Promise<ArticleCard | null> {
  const card = articleCard(row);
  if (card.bible && !(await biblePreferences(ctx, card.userId)).enabled)
    return null;
  if (!("articleId" in row)) return { ...card, url: row.url, guid: row.guid };
  if (!row.urlDeferred && !row.guidDeferred) return card;
  const original = await readLegacyDocument(ctx, () =>
    ctx.db.get("articles", row.articleId),
  );
  return original?.userId === row.userId
    ? { ...card, url: original.url, guid: original.guid }
    : null;
}

export async function resolveArticleCards(
  ctx: Pick<QueryCtx, "db">,
  rows: (Doc<"articles"> | Doc<"articleMetadata">)[],
) {
  const cards: ArticleCard[] = [];
  // Serial only for rare deferred originals; this shares the same byte ledger.
  for (const row of rows) {
    const card = await resolveArticleCard(ctx, row);
    if (card) cards.push(card);
  }
  return cards;
}

export async function ownedArticleCard(
  ctx: Pick<QueryCtx, "db">,
  articleId: Id<"articles">,
  userId: string,
): Promise<ArticleCard | null> {
  const row = await ctx.db
    .query("articleMetadata")
    .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
    .unique();
  if (row) return row.userId === userId ? resolveArticleCard(ctx, row) : null;
  if (await metadataReady(ctx, userId)) return null;
  const article = await readLegacyDocument(ctx, () => ctx.db.get(articleId));
  return article?.userId === userId ? resolveArticleCard(ctx, article) : null;
}

export async function bookPartCard(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  articleId: Id<"articles">,
  index: number,
) {
  const row = await ctx.db
    .query("bookPartCards")
    .withIndex("by_userId_and_articleId_and_index", (q) =>
      q.eq("userId", userId).eq("articleId", articleId).eq("index", index),
    )
    .unique();
  if (row) return row;
  const state = await ctx.db
    .query("libraryMetadataState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (state && state.phase !== "articles" && state.phase !== "parts")
    return null;
  const unit = await readLegacyDocument(ctx, () =>
    ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) =>
        q.eq("userId", userId).eq("articleId", articleId).eq("index", index),
      )
      .unique(),
  );
  return unit
    ? { title: unit.title, minutes: unit.estimatedReadMinutes }
    : null;
}

type CardQuery =
  | OrderedQuery<DataModel["articles"]>
  | OrderedQuery<DataModel["articleMetadata"]>;

export async function windowSource(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  status: Doc<"articles">["annotationStatus"],
  relation: "lt" | "lte" | "gt" | "gte",
  minutes: number,
  order: "asc" | "desc" = "asc",
  legacy?: boolean,
): Promise<CardQuery> {
  // Keep the two concrete schema builders typed, rather than casting between
  // table identities. Both ranges use the same public eligibility predicate.
  const ready =
    legacy === undefined ? await metadataReady(ctx, userId) : !legacy;
  return ready
    ? ctx.db
        .query("articleMetadata")
        .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
          q
            .eq("userId", userId)
            .eq("annotationStatus", status)
            .eq("finishedAt", undefined)
            [relation]("estimatedReadMinutes", minutes),
        )
        .order(order)
        .filter(readableMetadataFilter)
    : ctx.db
        .query("articles")
        .withIndex("by_user_annotationStatus_finishedAt_minutes", (q) =>
          q
            .eq("userId", userId)
            .eq("annotationStatus", status)
            .eq("finishedAt", undefined)
            [relation]("estimatedReadMinutes", minutes),
        )
        .order(order)
        .filter(readableArticleFilter);
}

export async function unreadSource(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  status?: (typeof UNREAD_STATUSES)[number],
  legacy?: boolean,
): Promise<CardQuery> {
  const ready =
    legacy === undefined ? await metadataReady(ctx, userId) : !legacy;
  if (status)
    return ready
      ? ctx.db
          .query("articleMetadata")
          .withIndex("by_user_annotationStatus_finishedAt", (q) =>
            q
              .eq("userId", userId)
              .eq("annotationStatus", status)
              .eq("finishedAt", undefined),
          )
          .order("desc")
          .filter(readableMetadataFilter)
      : ctx.db
          .query("articles")
          .withIndex("by_user_annotationStatus_finishedAt", (q) =>
            q
              .eq("userId", userId)
              .eq("annotationStatus", status)
              .eq("finishedAt", undefined),
          )
          .order("desc")
          .filter(readableArticleFilter);
  return ready
    ? ctx.db
        .query("articleMetadata")
        .withIndex("by_user_finishedAt", (q) =>
          q.eq("userId", userId).eq("finishedAt", undefined),
        )
        .order("desc")
        .filter((q) =>
          q.and(
            readableMetadataFilter(q),
            q.or(
              ...UNREAD_STATUSES.map((status) =>
                q.eq(q.field("annotationStatus"), status),
              ),
            ),
          ),
        )
    : ctx.db
        .query("articles")
        .withIndex("by_user_finishedAt", (q) =>
          q.eq("userId", userId).eq("finishedAt", undefined),
        )
        .order("desc")
        .filter((q) =>
          q.and(
            readableArticleFilter(q),
            q.or(
              ...UNREAD_STATUSES.map((status) =>
                q.eq(q.field("annotationStatus"), status),
              ),
            ),
          ),
        );
}

const cursorPrefix = "article-cards-v1:";
const cursorValue = z.tuple([z.enum(["legacy", "metadata"]), z.string()]);
function decodeCardCursor(cursor: string | null | undefined) {
  if (cursor == null) return null;
  if (!cursor.startsWith(cursorPrefix))
    return { source: "legacy" as const, cursor };
  const [source, inner] = cursorValue.parse(
    JSON.parse(cursor.slice(cursorPrefix.length)),
  );
  return { source, cursor: inner };
}

/** A pinned old page must keep its original physical index across rollout.
 * Cursors remain opaque to both old and new clients. */
export async function cardPagination(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  opts: PaginationOptions,
) {
  const start = decodeCardCursor(opts.cursor);
  const end = decodeCardCursor(opts.endCursor);
  if (start && end && start.source !== end.source)
    throw new Error("Pagination source changed. Reload the shelf.");
  const source =
    start?.source ??
    end?.source ??
    ((await metadataReady(ctx, userId)) ? "metadata" : "legacy");
  const encode = (cursor: string) =>
    cursorPrefix + JSON.stringify([source, cursor]);
  return {
    legacy: source === "legacy",
    opts: {
      ...opts,
      cursor: start?.cursor ?? null,
      endCursor: end?.cursor ?? null,
    },
    wrap(
      page: PaginationResult<Doc<"articles"> | Doc<"articleMetadata">>,
    ): PaginationResult<Doc<"articles"> | Doc<"articleMetadata">> {
      return {
        ...page,
        continueCursor: encode(page.continueCursor),
        splitCursor: page.splitCursor
          ? encode(page.splitCursor)
          : page.splitCursor,
      };
    },
  };
}

export async function takeCards(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  source: CardQuery,
  limit: number,
): Promise<ArticleCard[]> {
  if (await metadataReady(ctx, userId))
    return resolveArticleCards(ctx, await source.take(limit));
  const rows: (Doc<"articles"> | Doc<"articleMetadata">)[] = [];
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (rows.length < limit) {
      const row = await readLegacyDocument<
        Doc<"articles"> | Doc<"articleMetadata">
      >(ctx, async () => {
        const next = await iterator.next();
        return next.done ? null : next.value;
      });
      if (!row) break;
      rows.push(row);
    }
  } finally {
    await iterator.return?.();
  }
  return resolveArticleCards(ctx, rows);
}
