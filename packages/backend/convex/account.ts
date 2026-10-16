import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { revokeSessions } from "./access";
import { internalMutation, type MutationCtx, mutation } from "./functions";
import { DEFAULT_USER_ID } from "./lib/constants";

export const DELETE_CONFIRMATION = "DELETE";

/**
 * A reader deletes their own account: access ends now, and their library,
 * credentials and sign-in records are purged in the background.
 */
export const deleteMine = mutation({
  args: { confirmation: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (ctx.readerId === DEFAULT_USER_ID)
      throw new ConvexError("The owner's account can't be deleted here.");
    if (args.confirmation !== DELETE_CONFIRMATION)
      throw new ConvexError(`Type ${DELETE_CONFIRMATION} to confirm.`);
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", ctx.readerId))
      .unique();
    if (!reader) throw new ConvexError("Account not found.");
    await ctx.db.patch("readers", reader._id, {
      status: "disabled",
      deletingAt: reader.deletingAt ?? Date.now(),
    });
    await revokeSessions(ctx, reader.authId);
    await ctx.scheduler.runAfter(0, internal.account.purge, {
      userId: reader.libraryId,
      authId: reader.authId,
      email: reader.email,
      step: 0,
    });
    return null;
  },
});

interface Target {
  userId: string;
  authId: string;
  email?: string;
}
type Rows = { _id: Id<TableNames> }[];
// Each step deletes one bounded batch and reports how many rows it removed,
// or WAIT to check again after WAIT_MS
type Step = (ctx: MutationCtx, target: Target) => Promise<number>;
const WAIT = -1;
const WAIT_MS = 5_000;
// How long the purge leaves a ChatGPT connection for its revocation action
const REVOKE_GRACE_MS = 2 * 60_000;

const BATCH = 64;
// Articles carry full text and an embedding, so smaller batches stay within limits
const ARTICLE_BATCH = 16;

function rows(
  batch: (ctx: MutationCtx, userId: string) => Promise<Rows>,
): Step {
  return async (ctx, { userId }) => {
    const found = await batch(ctx, userId);
    for (const row of found) await ctx.db.delete(row._id);
    return found.length;
  };
}

function authRows(
  model: "passkey" | "twoFactor" | "account" | "session",
): Step {
  return async (ctx, { authId }) => {
    const result = await ctx.runMutation(
      components.betterAuth.adapter.deleteMany,
      {
        input: { model, where: [{ field: "userId", value: authId }] },
        paginationOpts: { numItems: BATCH, cursor: null },
      },
    );
    return result.count;
  };
}

/** Every table that holds a library's rows, then its reader and auth records. */
const STEPS: Step[] = [
  rows((ctx, u) =>
    ctx.db
      .query("articleInteractions")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readingActivity")
      .withIndex("by_user_started", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("paragraphDwell")
      .withIndex("by_user_article", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("feedStats")
      .withIndex("by_user_feed", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("feedStatsBackfill")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("tasteProfiles")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("preAnnotations")
      .withIndex("by_user_chosenAt", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("suggestionKeeps")
      .withIndex("by_user_kind_subject", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("tagMergeSuggestions")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("annotations")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("ideaLinks")
      .withIndex("by_user_to", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("edgeReasons")
      .withIndex("by_user_pair", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("reflections")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("highlights")
      .withIndex("by_userId_and_readerHighlightId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("userNotes")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("companionThreads")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("lookups")
      .withIndex("by_user_created", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("summaries")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("impressions")
      .withIndex("by_user_updated", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("savedArticles")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("lovedArticles")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("noteChunks")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("marginaliaPasses")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // A book's units carry its text, like articles do
  rows((ctx, u) =>
    ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) => q.eq("userId", u))
      .take(ARTICLE_BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("books")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // An import still reading owns an uploaded file, which goes with it
  async (ctx, { userId }) => {
    const imports = await ctx.db
      .query("documentImports")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .take(BATCH);
    for (const row of imports) {
      try {
        await ctx.storage.delete(row.storageId);
      } catch {
        // Already deleted when the import finished or failed
      }
      await ctx.db.delete(row._id);
    }
    return imports.length;
  },
  rows((ctx, u) =>
    ctx.db
      .query("uploadGrants")
      .withIndex("by_userId_and_issuedAt", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("articles")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(ARTICLE_BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("feeds")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readingQueueStats")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readwiseSyncState")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("providerCredentials")
      .withIndex("by_userId_and_provider", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readwiseCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("apiTokens")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // Revoke the ChatGPT refresh token with OpenAI first, best effort: the
  // action deletes the row, and after REVOKE_GRACE_MS the purge does anyway
  async (ctx, { userId }) => {
    const row = await ctx.db
      .query("chatgptConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!row) return 0;
    const now = Date.now();
    if (row.ciphertext && !row.revokeRequestedAt) {
      await ctx.db.patch("chatgptConnections", row._id, {
        revokeRequestedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.chatgpt.revokeForDeletion, {
        userId,
      });
      return WAIT;
    }
    if (row.revokeRequestedAt && now - row.revokeRequestedAt < REVOKE_GRACE_MS)
      return WAIT;
    await ctx.db.delete("chatgptConnections", row._id);
    return 1;
  },
  rows((ctx, u) =>
    ctx.db
      .query("articleTags")
      .withIndex("by_user", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("reannotateState")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("catchUpState")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("chatgptAuthAttempts")
      .withIndex("by_userId", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  rows((ctx, u) =>
    ctx.db
      .query("readerLimits")
      .withIndex("by_userId_and_bucket", (q) => q.eq("userId", u))
      .take(BATCH),
  ),
  // The invite they used and the request that led to it
  async (ctx, { authId, email }) => {
    if (!email) return 0;
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(BATCH);
    const requests = await ctx.db
      .query("accessRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(BATCH);
    for (const row of invites)
      if (row.consumedBy === authId || !row.consumedBy)
        await ctx.db.delete(row._id);
    for (const row of requests) await ctx.db.delete(row._id);
    return 0;
  },
  rows((ctx, u) =>
    ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", u))
      .take(BATCH),
  ),
  authRows("passkey"),
  authRows("twoFactor"),
  authRows("session"),
  authRows("account"),
  async (ctx, { authId }) => {
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "user", where: [{ field: "_id", value: authId }] },
    });
    return 0;
  },
];

/**
 * Deletes one batch, then reschedules itself until every step is empty.
 * Idempotent and resumable: re-running any step only finds what is left.
 */
export const purge = internalMutation({
  args: {
    userId: v.string(),
    authId: v.string(),
    email: v.optional(v.string()),
    step: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.userId === DEFAULT_USER_ID)
      throw new Error("The owner's library is never purged");
    const owner = await ctx.db
      .query("readerAccess")
      .withIndex("by_key", (q) => q.eq("key", "owner"))
      .unique();
    if (owner?.authId && owner.authId === args.authId)
      throw new Error("The owner's account is never purged");
    // A live reader is never purged; once their row is gone, re-running
    // only sweeps up anything left behind
    for (const reader of [
      await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", args.userId))
        .first(),
      await ctx.db
        .query("readers")
        .withIndex("by_authId", (q) => q.eq("authId", args.authId))
        .first(),
    ])
      if (
        reader &&
        (reader.authId !== args.authId ||
          reader.libraryId !== args.userId ||
          !reader.deletingAt)
      )
        throw new Error("This account isn't being deleted");
    let step = args.step;
    let removed = 0;
    while (step < STEPS.length) {
      removed = await STEPS[step](ctx, args);
      if (removed !== 0) break;
      step++;
    }
    if (step < STEPS.length)
      await ctx.scheduler.runAfter(
        removed === WAIT ? WAIT_MS : 0,
        internal.account.purge,
        {
          ...args,
          step,
        },
      );
    return null;
  },
});
