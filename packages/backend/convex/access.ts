import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

const SIGN_IN = "Sign in to your private reader.";

// Bind the subject to this deployment's issuer, not just an arbitrary user ID.
async function deploymentIdentity(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (
    !identity ||
    identity.issuer !== process.env.CONVEX_SITE_URL ||
    typeof identity.sessionId !== "string"
  )
    return null;
  return { subject: identity.subject, sessionId: identity.sessionId };
}

// A still-valid JWT must not outlive a sign-out or revoked session.
async function hasLiveSession(
  ctx: QueryCtx,
  identity: { subject: string; sessionId: string },
) {
  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [
      { field: "_id", value: identity.sessionId },
      { field: "userId", value: identity.subject },
      { field: "expiresAt", operator: "gt", value: Date.now() },
    ],
  });
  return Boolean(session);
}

async function ownerRow(ctx: QueryCtx) {
  return ctx.db
    .query("readerAccess")
    .withIndex("by_key", (q) => q.eq("key", "owner"))
    .unique();
}

export async function getOwner(ctx: QueryCtx) {
  const identity = await deploymentIdentity(ctx);
  if (!identity) return null;
  const owner = await ownerRow(ctx);
  if (!owner?.authId || identity.subject !== owner.authId) return null;
  return (await hasLiveSession(ctx, identity)) ? owner : null;
}

export async function requireOwner(ctx: QueryCtx): Promise<void> {
  if (!(await getOwner(ctx))) throw new ConvexError(SIGN_IN);
}

export const assertOwner = internalQuery({ args: {}, handler: requireOwner });

/**
 * The signed-in reader's library ID, derived only from the session. The owner
 * keeps the original "default_user" library; other readers need an active row.
 */
export async function getReader(ctx: QueryCtx): Promise<string | null> {
  const identity = await deploymentIdentity(ctx);
  if (!identity) return null;
  const owner = await ownerRow(ctx);
  let libraryId: string | null = null;
  if (owner?.authId && identity.subject === owner.authId) {
    libraryId = DEFAULT_USER_ID;
  } else {
    const reader = await ctx.db
      .query("readers")
      .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
      .unique();
    // Only the owner may ever resolve to the owner's library
    if (
      reader?.status === "active" &&
      reader.libraryId &&
      reader.libraryId !== DEFAULT_USER_ID
    )
      libraryId = reader.libraryId;
  }
  if (!libraryId) return null;
  return (await hasLiveSession(ctx, identity)) ? libraryId : null;
}

export async function requireReader(ctx: QueryCtx): Promise<string> {
  const libraryId = await getReader(ctx);
  if (!libraryId) throw new ConvexError(SIGN_IN);
  return libraryId;
}

export const assertReader = internalQuery({
  args: {},
  returns: v.string(),
  handler: requireReader,
});

/** The article, only when it belongs to this library. */
export async function ownedArticle(
  ctx: Pick<QueryCtx, "db">,
  articleId: Id<"articles">,
  userId: string,
): Promise<Doc<"articles"> | null> {
  const article = await ctx.db.get("articles", articleId);
  return article?.userId === userId ? article : null;
}

export async function requireArticle(
  ctx: Pick<QueryCtx, "db">,
  articleId: Id<"articles">,
  userId: string,
): Promise<Doc<"articles">> {
  const article = await ownedArticle(ctx, articleId, userId);
  if (!article) throw new Error("Article not found");
  return article;
}

// This single-owner fallback has one shared budget, independent of spoofable
// forwarded IP headers. A passkey still works if the password budget is full.
export const allowPasswordAttempt = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const previous = await ctx.db
      .query("authAttempts")
      .withIndex("by_scope", (q) => q.eq("scope", "password"))
      .unique();
    if (previous && now - previous.startedAt < 60000) {
      if (previous.count >= 8) return false;
      await ctx.db.patch(previous._id, { count: previous.count + 1 });
    } else if (previous)
      await ctx.db.patch(previous._id, { startedAt: now, count: 1 });
    else
      await ctx.db.insert("authAttempts", {
        scope: "password",
        startedAt: now,
        count: 1,
      });
    return true;
  },
});

// Run only through deployment-admin CLI. The plaintext setup token never enters
// the database, browser URL query, logs, or repository.
export const prepareSetup = internalMutation({
  args: { hash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.hash) || args.expiresAt <= Date.now())
      throw new Error("Invalid setup token");
    const owner = await ctx.db
      .query("readerAccess")
      .withIndex("by_key", (q) => q.eq("key", "owner"))
      .unique();
    if (owner?.authId) throw new Error("Reader already has an owner");
    if (owner)
      await ctx.db.patch(owner._id, {
        setupHash: args.hash,
        setupExpiresAt: args.expiresAt,
        email: undefined,
      });
    else
      await ctx.db.insert("readerAccess", {
        key: "owner",
        setupHash: args.hash,
        setupExpiresAt: args.expiresAt,
      });
  },
});

export const reserveSetup = internalMutation({
  args: { hash: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const owner = await ctx.db
      .query("readerAccess")
      .withIndex("by_key", (q) => q.eq("key", "owner"))
      .unique();
    if (
      !owner ||
      owner.authId ||
      !owner.setupHash ||
      owner.setupHash !== args.hash ||
      (owner.setupExpiresAt ?? 0) < Date.now() ||
      (owner.email && owner.email !== args.email)
    )
      throw new ConvexError("Owner setup is closed or this link has expired.");
    await ctx.db.patch(owner._id, { email: args.email });
  },
});
