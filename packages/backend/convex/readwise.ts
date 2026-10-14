import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { libraryIsActive, requireArticle } from "./access";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./functions";
import { ownerDeploymentReadwiseToken } from "./lib/ownerTransition";
import { encryptProviderKey } from "./lib/providerKeys";
import {
  cleanReadwiseToken,
  readwiseTokenFor,
  validateReadwiseToken,
} from "./lib/readwise";
import { requireReaderLimit } from "./limits";
import { updateQueueStats } from "./readingQueue";

const NOT_CONNECTED = "Readwise isn't connected";

async function savedTokenRow(ctx: Pick<QueryCtx, "db">, userId: string) {
  return ctx.db
    .query("readwiseCredentials")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * How this library reaches Readwise: its own saved token, the owner's
 * transition token, or not at all. Never touches key material.
 */
export async function readwiseConnection(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
): Promise<
  { source: "saved"; last4: string } | { source: "deployment" } | null
> {
  const row = await savedTokenRow(ctx, userId);
  if (row) return { source: "saved", last4: row.last4 };
  return ownerDeploymentReadwiseToken(userId, false)
    ? { source: "deployment" }
    : null;
}

async function settingsRow(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function patchSettings(
  ctx: MutationCtx,
  userId: string,
  patch: Partial<Doc<"userSettings">>,
) {
  const row = await settingsRow(ctx, userId);
  const next = { ...patch, updatedAt: Date.now() };
  if (row) await ctx.db.patch("userSettings", row._id, next);
  else await ctx.db.insert("userSettings", { ...next, userId });
}

export const status = query({
  args: {},
  handler: async (ctx) => {
    const row = await settingsRow(ctx, ctx.readerId);
    const sync = await ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .unique();
    const queue = await ctx.db
      .query("readingQueueStats")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .unique();
    const connection = await readwiseConnection(ctx, ctx.readerId);
    return {
      connected: connection !== null,
      source: connection?.source ?? null,
      last4: connection?.source === "saved" ? connection.last4 : null,
      syncedAt: row?.readwiseSyncedAt ?? null,
      checkedAt: row?.readwiseCheckedAt ?? null,
      error: sync ? (sync.error ?? null) : (row?.readwiseError ?? null),
      progress: sync
        ? {
            active: sync.active,
            backfilling: !sync.backfilledAt,
            phase:
              ["Inbox", "Later", "Shortlist", "Highlights", "Archive"][
                sync.phase
              ] ?? "Complete",
            scanned: sync.scanned,
            imported: sync.imported,
            linked: sync.linked,
            skipped: sync.skipped,
            highlights: sync.highlights,
          }
        : null,
      pendingAnnotations: queue?.ready ? queue.pending : null,
    };
  },
});

/** Sealed token for actions that call Readwise; "inactive" for closed libraries. */
export const sealedToken = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.null(),
    v.literal("inactive"),
    v.object({ ciphertext: v.string(), iv: v.string() }),
  ),
  handler: async (ctx, args) => {
    if (!(await libraryIsActive(ctx, args.userId))) return "inactive" as const;
    const row = await savedTokenRow(ctx, args.userId);
    return row ? { ciphertext: row.ciphertext, iv: row.iv } : null;
  },
});

export const connect = action({
  args: { token: v.string() },
  returns: v.object({ last4: v.string() }),
  handler: async (ctx, args) => {
    await requireReaderLimit(ctx, ctx.readerId, "readwiseConnect");
    const token = cleanReadwiseToken(args.token);
    // Seal first: a server without its encryption key never sends the token anywhere
    const sealed = await encryptProviderKey(token, ctx.readerId, "readwise");
    await validateReadwiseToken(token);
    const last4 = token.slice(-4);
    await ctx.runMutation(internal.readwise.storeToken, {
      userId: ctx.readerId,
      ...sealed,
      last4,
    });
    await ctx.scheduler.runAfter(0, internal.actions.readwiseSync.sync, {
      userId: ctx.readerId,
    });
    return { last4 };
  },
});

export const storeToken = internalMutation({
  args: {
    userId: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    last4: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const fields = {
      ciphertext: args.ciphertext,
      iv: args.iv,
      last4: args.last4,
      updatedAt: now,
      validatedAt: now,
    };
    const existing = await savedTokenRow(ctx, args.userId);
    if (existing)
      await ctx.db.patch("readwiseCredentials", existing._id, fields);
    else
      await ctx.db.insert("readwiseCredentials", {
        userId: args.userId,
        createdAt: now,
        ...fields,
      });
    return null;
  },
});

export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await savedTokenRow(ctx, ctx.readerId);
    if (row) await ctx.db.delete("readwiseCredentials", row._id);
    return null;
  },
});

export const syncNow = action({
  args: {},
  handler: async (ctx) => {
    const userId = ctx.readerId;
    if (!(await readwiseTokenFor(ctx, userId)))
      throw new ConvexError(NOT_CONNECTED);
    await ctx.scheduler.runAfter(0, internal.readingQueue.initialize, {
      userId,
    });
    const state: { syncedAt: number | null; nextRunAt: number } =
      await ctx.runQuery(internal.readwise.getSyncState, { userId });
    await ctx.scheduler.runAfter(
      Math.max(0, state.nextRunAt - Date.now()),
      internal.actions.readwiseSync.sync,
      { userId },
    );
  },
});

export const getSyncState = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const row = await settingsRow(ctx, args.userId);
    const sync = await ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    return {
      syncedAt: row?.readwiseSyncedAt ?? null,
      nextRunAt: sync?.nextRunAt ?? 0,
    };
  },
});

export const recordSync = internalMutation({
  args: {
    userId: v.string(),
    syncedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await patchSettings(ctx, args.userId, {
      readwiseCheckedAt: Date.now(),
      readwiseError: args.error,
      ...(args.syncedAt ? { readwiseSyncedAt: args.syncedAt } : {}),
    });
  },
});

export const findArticle = internalQuery({
  args: {
    userId: v.string(),
    readerDocumentId: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const linked = await ctx.db
      .query("articles")
      .withIndex("by_userId_and_readerDocumentId", (q) =>
        q
          .eq("userId", args.userId)
          .eq("readerDocumentId", args.readerDocumentId),
      )
      .first();
    if (linked || !args.url) return linked;
    // Already in Marginalia from a feed or a pasted URL
    const url = args.url;
    return ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", args.userId).eq("guid", url),
      )
      .first();
  },
});

export const linkArticle = internalMutation({
  args: { articleId: v.id("articles"), readerDocumentId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("articles", args.articleId, {
      readerDocumentId: args.readerDocumentId,
    });
  },
});

/** Archiving in Reader takes the article out of Marginalia's queue too. */
export const markArchived = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const before = await requireArticle(ctx, args.articleId, args.userId);
    if (before.finishedAt !== undefined) return false;
    await ctx.db.patch("articles", before._id, { finishedAt: Date.now() });
    const after = await ctx.db.get("articles", before._id);
    if (after) await updateQueueStats(ctx, before, after);
    return true;
  },
});

export const getArticleReaderId = internalQuery({
  args: { articleId: v.id("articles"), userId: v.string() },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (article?.userId !== args.userId) return null;
    return article.readerDocumentId ?? null;
  },
});

/** Imports a Reader highlight unless it (or the same passage) is already marked. */
export const importHighlight = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    readerHighlightId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, args.userId);
    const byId = await ctx.db
      .query("highlights")
      .withIndex("by_userId_and_readerHighlightId", (q) =>
        q
          .eq("userId", args.userId)
          .eq("readerHighlightId", args.readerHighlightId),
      )
      .first();
    if (byId) return false;
    const normalized = args.text.replace(/\s+/g, " ").trim();
    const onArticle = await ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .take(500);
    // A highlight pushed from Marginalia comes back from Reader on the next
    // sync, possibly before its Reader id was stored
    if (
      onArticle.some((h) => h.text.replace(/\s+/g, " ").trim() === normalized)
    ) {
      return false;
    }
    const highlightId = await ctx.db.insert("highlights", {
      userId: args.userId,
      articleId: args.articleId,
      kind: "highlight",
      text: normalized,
      source: "reader",
      readerHighlightId: args.readerHighlightId,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.embedReaderActivity.embedHighlight,
      {
        highlightId,
      },
    );
    return true;
  },
});

export const setHighlightReaderId = internalMutation({
  args: { highlightId: v.id("highlights"), readerHighlightId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("highlights", args.highlightId);
    if (row) {
      await ctx.db.patch("highlights", args.highlightId, {
        readerHighlightId: args.readerHighlightId,
      });
    }
  },
});
