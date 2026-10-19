import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { libraryIsActive, ownedArticleCard, requireArticle } from "./access";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./functions";
import { findImportArticle } from "./lib/articleIdentity";
import {
  hasHighlightText,
  highlightIdentityState,
  normalizeHighlightText,
  syncHighlightIdentity,
} from "./lib/highlightIdentity";
import { ownerDeploymentReadwiseToken } from "./lib/ownerTransition";
import { encryptProviderKey } from "./lib/providerKeys";
import { assertBytes } from "./lib/readerBodies";
import {
  cleanReadwiseToken,
  readwiseTokenFor,
  validateReadwiseToken,
} from "./lib/readwise";
import { metadataLibraryRetained } from "./lib/shelfCounts";
import { sha256Hex } from "./lib/tokens";
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
    return findImportArticle(ctx, args.userId, args.url);
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

/** Explicit/lazy migration, one source page per transaction. A missing state is
 * never an empty baseline. Live writers must publish identities atomically. */
export const prepareHighlightIdentities = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, { userId, articleId }) => {
    if (
      !(await metadataLibraryRetained(ctx, userId)) ||
      !(await ownedArticleCard(ctx, articleId, userId))
    )
      return { ready: false, unavailable: true };
    let state = await highlightIdentityState(ctx, articleId);
    if (state && state.userId !== userId) {
      // The parent was authorized in this same transaction. Never adopt a
      // previous owner's cursor/readiness, even if stale derived state exists.
      await ctx.db.delete(state._id);
      state = null;
    }
    if (state?.ready) return { ready: true, unavailable: false };
    const page = await ctx.db
      .query("highlights")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", userId).eq("articleId", articleId),
      )
      .paginate({
        cursor: state?.cursor ?? null,
        numItems: 32,
        maximumBytesRead: 512 * 1024,
      });
    for (const row of page.page) await syncHighlightIdentity(ctx, null, row);
    const fields = {
      userId,
      articleId,
      cursor: page.isDone ? null : page.continueCursor,
      ready: page.isDone,
    };
    if (state) await ctx.db.replace(state._id, fields);
    else await ctx.db.insert("highlightIdentityState", fields);
    return { ready: page.isDone, unavailable: false };
  },
});

/** Explicit rollout verification only: compare one bounded source page and its
 * exact derived identities in the same snapshot, without touching any mark. */
export const verifyHighlightIdentities = internalQuery({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { userId, articleId, cursor }) => {
    if (
      !(await metadataLibraryRetained(ctx, userId)) ||
      !(await ownedArticleCard(ctx, articleId, userId))
    )
      return {
        ready: false,
        unavailable: true,
        matches: false,
        checked: 0,
        complete: true,
        cursor: null,
      };
    const state = await highlightIdentityState(ctx, articleId);
    if (!state?.ready || state.userId !== userId)
      return {
        ready: false,
        unavailable: false,
        matches: false,
        checked: 0,
        complete: true,
        cursor: null,
      };
    const page = await ctx.db
      .query("highlights")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", userId).eq("articleId", articleId),
      )
      .paginate({
        cursor: cursor ?? null,
        numItems: 32,
        maximumBytesRead: 512 * 1024,
      });
    let matches = true;
    for (const mark of page.page) {
      const identity = await ctx.db
        .query("highlightIdentities")
        .withIndex("by_highlightId", (q) => q.eq("highlightId", mark._id))
        .unique();
      if (
        identity?.userId !== userId ||
        identity.articleId !== articleId ||
        identity.textHash !==
          (await sha256Hex(normalizeHighlightText(mark.text)))
      )
        matches = false;
    }
    return {
      ready: true,
      unavailable: false,
      matches,
      checked: page.page.length,
      complete: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/** Old queued callers keep the same arguments and boolean result. Until the
 * explicit migration finishes, throw rather than falsely acknowledge a mark. */
export const importHighlight = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    readerHighlightId: v.string(),
    text: v.string(),
    syncToken: v.optional(v.string()),
    readerDocumentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await libraryIsActive(ctx, args.userId)))
      throw new Error("Article not found");
    const parent = await ownedArticleCard(ctx, args.articleId, args.userId);
    if (!parent) throw new Error("Article not found");
    if (args.readerDocumentId !== undefined) {
      // Cards cap this ID at 512 code units, or 511 after dropping a split
      // surrogate. A short incoming ID can match that truncated prefix too.
      const readerDocumentId =
        args.readerDocumentId.length > 512 ||
        (parent.readerDocumentId?.length ?? 0) >= 511
          ? (await ctx.db.get("articles", args.articleId))?.readerDocumentId
          : parent.readerDocumentId;
      if (readerDocumentId !== args.readerDocumentId)
        throw new Error("Reader highlight parent changed");
    }
    assertBytes(args.text, 1024 * 1024, "Reader passage");
    if (args.syncToken !== undefined) {
      const sync = await ctx.db
        .query("readwiseSyncState")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .unique();
      if (
        !sync?.active ||
        sync.phase !== 3 ||
        sync.token !== args.syncToken ||
        sync.leaseUntil <= Date.now()
      )
        throw new Error("Readwise highlight lease expired");
      if (sync.pageProcessedIds.includes(args.readerHighlightId)) return false;
    }
    const finish = async (added: boolean) => {
      if (args.syncToken !== undefined)
        await ctx.runMutation(internal.readwiseSyncState.recordDocument, {
          userId: args.userId,
          token: args.syncToken,
          documentId: args.readerHighlightId,
          outcome: added ? "highlight" : "ignored",
        });
      return added;
    };
    const normalized = normalizeHighlightText(args.text);
    if (!normalized) return finish(false);
    const state = await highlightIdentityState(ctx, args.articleId);
    if (!state?.ready || state.userId !== args.userId)
      throw new Error("Highlight identities are not ready; prepare and resume");
    const byId = await ctx.db
      // This identity is library-wide, whereas text readiness is per article.
      // Preserve the authoritative source index even before other articles migrate.
      .query("highlights")
      .withIndex("by_userId_and_readerHighlightId", (q) =>
        q
          .eq("userId", args.userId)
          .eq("readerHighlightId", args.readerHighlightId),
      )
      .first();
    if (byId) return finish(false);
    // A highlight pushed from Marginalia comes back from Reader on the next
    // sync, possibly before its Reader id was stored
    if (await hasHighlightText(ctx, args.userId, args.articleId, normalized)) {
      return finish(false);
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
    return finish(true);
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
