import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  libraryIsActive,
  ownedArticleCard as ownedArticle,
  requireArticle,
} from "./access";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { DEFAULT_USER_ID } from "./lib/constants";
import {
  colorFitsKind,
  HIGHLIGHTER_COLORS,
  type MarkKind,
  markColor,
  PEN_COLORS,
} from "./lib/markColours";
import { assertBytes, markPresentation } from "./lib/readerBodies";

export const listByArticle = query({
  args: {
    articleId: v.id("articles"),
    // For a book: only the marks in this part
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return [];
    const unitIndex = args.unitIndex;
    // The part is part of the index, so the cap applies within it
    const rows = await (unitIndex === undefined
      ? ctx.db
          .query("highlights")
          .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
          .take(500)
      : ctx.db
          .query("highlights")
          .withIndex("by_article_and_unitIndex", (q) =>
            q.eq("articleId", args.articleId).eq("unitIndex", unitIndex),
          )
          .take(500));
    return presentLegacyColors(ctx, ctx.readerId, rows);
  },
});

/**
 * The reader's marks across every article, newest inserted first (index order), one page at a time.
 * Each row carries a 1536-number embedding, so the projection below is what
 * keeps the vector off the wire, though each read still loads the whole document, so keep pages at 50 or fewer.
 */
const MAX_PAGE = 50;

export const listMine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("highlights")
      .withIndex("by_userId", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      // Each document is read whole, embedding and all, so the server caps the page
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, MAX_PAGE),
      });
    return {
      ...page,
      page: (await presentLegacyColors(ctx, ctx.readerId, page.page)).map(
        (row) => ({
          _id: row._id,
          articleId: row.articleId,
          kind: row.kind,
          color: row.color,
          text: row.text,
          paragraphIndex: row.paragraphIndex,
          unitIndex: row.unitIndex,
          createdAt: row.createdAt,
        }),
      ),
    };
  },
});

export const listByArticleInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) =>
    ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(500),
});

export const listPresentationByArticle = query({
  args: {
    articleId: v.id("articles"),
    unitIndex: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId)))
      return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("highlights")
      .withIndex("by_article_and_unitIndex", (q) =>
        q.eq("articleId", args.articleId).eq("unitIndex", args.unitIndex),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(50, args.paginationOpts.numItems)),
        maximumBytesRead: 2_000_000,
      });
    return {
      ...page,
      page: (
        await presentLegacyColors(
          ctx,
          ctx.readerId,
          page.page.filter((row) => row.userId === ctx.readerId),
        )
      ).map(markPresentation),
    };
  },
});

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    // Left out, the mark follows the reader's current highlighter or pen setting
    color: v.optional(markColor),
    text: v.string(),
    paragraphIndex: v.optional(v.number()),
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const article = await requireArticle(ctx, args.articleId, ctx.readerId);
    assertBytes(args.text, 32_000, "Marked passage");
    if (args.color && !colorFitsKind(args.kind, args.color))
      throw new Error("That colour is not for this kind of mark");
    const legacyDefault =
      args.color === undefined
        ? await legacyDefaultFor(ctx, ctx.readerId, args.kind)
        : null;
    const highlightId = await ctx.db.insert("highlights", {
      ...args,
      licensedQuote: article.bible?.displayVersionId ? true : undefined,
      color: args.color ?? legacyDefault?.color,
      userId: ctx.readerId,
      source: "marginalia",
      createdAt: Date.now(),
    });
    // Mirrors the mark to Readwise Reader when the article came from there
    await ctx.scheduler.runAfter(
      0,
      internal.actions.readwiseSync.pushHighlight,
      {
        highlightId,
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.actions.embedReaderActivity.embedHighlight,
      {
        highlightId,
      },
    );
    return highlightId;
  },
});

export const setColor = mutation({
  args: { highlightId: v.id("highlights"), color: markColor },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row?.userId !== ctx.readerId) throw new Error("Highlight not found");
    if (!colorFitsKind(row.kind, args.color))
      throw new Error("That colour is not for this kind of mark");
    await ctx.db.patch("highlights", args.highlightId, { color: args.color });
  },
});

// Legacy rows carry vectors and may predate text limits. Bound both dimensions.
const STAMP_BATCH = 32;
// Large enough to admit even a near-limit legacy document, still bounded.
const STAMP_BYTES = 2_000_000;

function legacyDefaultFor(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  kind: MarkKind,
) {
  return ctx.db
    .query("legacyMarkDefaults")
    .withIndex("by_userId_and_kind", (q) =>
      q.eq("userId", userId).eq("kind", kind),
    )
    .unique();
}

/** Cached clients do not have the new fallback hook. Expose the canonical
 * colour as soon as chosen, without pretending all physical rows are stamped.
 * Once every loaded row is explicit, steady-state reads need no metadata. */
async function presentLegacyColors(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  rows: Doc<"highlights">[],
): Promise<Doc<"highlights">[]> {
  if (!rows.some((row) => row.color === undefined)) return rows;
  const [highlight, underline] = await Promise.all([
    legacyDefaultFor(ctx, userId, "highlight"),
    legacyDefaultFor(ctx, userId, "underline"),
  ]);
  return rows.map((row) =>
    row.color !== undefined
      ? row
      : {
          ...row,
          color: (row.kind === "highlight" ? highlight : underline)?.color,
        },
  );
}

async function canStamp(ctx: Pick<QueryCtx, "db">, userId: string) {
  if (!(await libraryIsActive(ctx, userId))) return false;
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
    .first();
  return reader?.deletingAt === undefined;
}

/** Cheap identity + canonical baselines, never highlight bodies or vectors. */
export const legacyDefaults = query({
  args: {},
  handler: async (ctx) => {
    const [highlight, underline] = await Promise.all([
      legacyDefaultFor(ctx, ctx.readerId, "highlight"),
      legacyDefaultFor(ctx, ctx.readerId, "underline"),
    ]);
    const highlighter = HIGHLIGHTER_COLORS.find(
      (color) => color === highlight?.color,
    );
    const pen = PEN_COLORS.find((color) => color === underline?.color);
    return {
      readerId: ctx.readerId,
      highlighter:
        highlight && highlighter
          ? {
              color: highlighter,
              version: highlight.version,
              ready: highlight.status === "done",
            }
          : null,
      pen:
        underline && pen
          ? {
              color: pen,
              version: underline.version,
              ready: underline.status === "done",
            }
          : null,
    };
  },
});

/**
 * Compatible entry point for old clients. The first call establishes version
 * 1 atomically. Later devices join that same job, never their own colour.
 * Only real hydrated browser preferences may initialize it (new hook contract).
 */
export const stampUncoloured = mutation({
  args: {
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    color: markColor,
    // A fence for an offline mutation replayed after an account switch, not
    // an authorization source. Ownership still comes only from ctx.readerId.
    expectedReaderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!colorFitsKind(args.kind, args.color))
      throw new Error("That colour is not for this kind of mark");
    if (
      args.expectedReaderId !== undefined &&
      args.expectedReaderId !== ctx.readerId
    )
      throw new Error(
        "The signed-in reader changed; retry from the current reader.",
      );
    if (!(await canStamp(ctx, ctx.readerId))) return;
    let job = await legacyDefaultFor(ctx, ctx.readerId, args.kind);
    if (!job) {
      const id = await ctx.db.insert("legacyMarkDefaults", {
        userId: ctx.readerId,
        kind: args.kind,
        color: args.color,
        version: 1,
        status: "running",
        cursor: null,
      });
      job = await ctx.db.get(id);
    }
    if (!job || job.status === "done") return;
    if (job.scheduledId) {
      const scheduled = await ctx.db.system.get(job.scheduledId);
      if (
        scheduled?.state.kind === "pending" ||
        scheduled?.state.kind === "inProgress"
      )
        return;
    }
    await stampPage(ctx, job, job.cursor);
  },
});

export const stampUncolouredPage = internalMutation({
  args: {
    userId: v.string(),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    color: markColor,
    cursor: v.string(),
  },
  handler: async (ctx, args) => {
    // An already-queued pre-version-1 page can join existing work, but cannot
    // initialize metadata or revive it after account purge. Ignore its colour.
    const job = await legacyDefaultFor(ctx, args.userId, args.kind);
    if (job && job.status === "running") await stampPage(ctx, job, job.cursor);
  },
});

export const stampLegacyPage = internalMutation({
  args: {
    jobId: v.id("legacyMarkDefaults"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job) await stampPage(ctx, job, args.cursor);
  },
});

async function stampPage(
  ctx: MutationCtx,
  job: Doc<"legacyMarkDefaults">,
  cursor: string | null,
) {
  if (
    job.status !== "running" ||
    job.cursor !== cursor ||
    !(await canStamp(ctx, job.userId))
  )
    return;
  const page = await ctx.db
    .query("highlights")
    .withIndex("by_userId_and_kind_and_color", (q) =>
      q.eq("userId", job.userId).eq("kind", job.kind).eq("color", undefined),
    )
    .paginate({
      numItems: STAMP_BATCH,
      maximumRowsRead: STAMP_BATCH,
      maximumBytesRead: STAMP_BYTES,
      cursor,
    });
  for (const row of page.page)
    await ctx.db.patch("highlights", row._id, { color: job.color });
  const scheduledId = page.isDone
    ? undefined
    : await ctx.scheduler.runAfter(0, internal.highlights.stampLegacyPage, {
        jobId: job._id,
        cursor: page.continueCursor,
      });
  await ctx.db.patch(job._id, {
    status: page.isDone ? "done" : "running",
    cursor: page.continueCursor,
    scheduledId,
  });
}

/** Account purge step: main's account.ts wires this in, never an independent
 * deletion workflow. Disabled/deleting accounts cannot restart queued jobs. */
export async function purgeLegacyMarkDefaults(
  ctx: MutationCtx,
  userId: string,
): Promise<number> {
  if (userId === DEFAULT_USER_ID || (await canStamp(ctx, userId)))
    throw new Error("An active library's legacy defaults cannot be purged");
  const rows = await ctx.db
    .query("legacyMarkDefaults")
    .withIndex("by_userId_and_kind", (q) => q.eq("userId", userId))
    .take(32);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

/**
 * Repair: clears a stored colour so the mark follows the reader's default
 * again. Used once on 2026-10-16 to undo marks stamped from a test browser
 * whose default was not the reader's own.
 */
export const clearStoredColour = internalMutation({
  args: { userId: v.string(), ids: v.array(v.id("highlights")) },
  handler: async (ctx, args) => {
    // Clearing after baseline initialization would either immediately refill
    // these rows or render them in that baseline anyway. Repair with explicit
    // per-mark setColor instead; never silently reset an immutable baseline.
    const rows = await Promise.all(
      args.ids.slice(0, 200).map((id) => ctx.db.get(id)),
    );
    const kinds = new Set(
      rows.flatMap((row) => (row?.userId === args.userId ? [row.kind] : [])),
    );
    for (const kind of kinds)
      if (await legacyDefaultFor(ctx, args.userId, kind))
        throw new Error(
          "Canonical legacy colour already exists; repair these marks with explicit setColor. Clearing does not reset the version-1 baseline.",
        );
    let cleared = 0;
    for (const row of rows) {
      if (row?.userId !== args.userId || row.color === undefined) continue;
      await ctx.db.patch("highlights", row._id, { color: undefined });
      cleared++;
    }
    return cleared;
  },
});

export const remove = mutation({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row?.userId !== ctx.readerId) throw new Error("Highlight not found");
    await ctx.db.delete("highlights", args.highlightId);
    // Only marks that started in Marginalia are removed from Reader; deleting an
    // imported Reader highlight here never deletes it there
    if (row.readerHighlightId && row.source !== "reader") {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.readwiseSync.deleteHighlight,
        {
          userId: row.userId,
          readerHighlightId: row.readerHighlightId,
        },
      );
    }
  },
});

export const getByIdInternal = internalQuery({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args) => ctx.db.get("highlights", args.highlightId),
});

export const setEmbedding = internalMutation({
  args: { highlightId: v.id("highlights"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row) {
      await ctx.db.patch("highlights", args.highlightId, {
        embedding: args.embedding,
        embeddedAt: Date.now(),
      });
    }
  },
});

/** One library's rows still without an embedding, from its 500 oldest. */
export const listUnembedded = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("highlights")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(500);
    return rows
      .filter((r) => !r.embedding && !r.licensedQuote)
      .map((r) => r._id);
  },
});
