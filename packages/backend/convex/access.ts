import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
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
 * The signed-in reader's library and auth user, derived only from the session.
 * The owner keeps the original "default_user" library; other readers need an
 * active row.
 */
export async function getReaderSession(
  ctx: QueryCtx,
): Promise<{ libraryId: string; authId: string } | null> {
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
  return (await hasLiveSession(ctx, identity))
    ? { libraryId, authId: identity.subject }
    : null;
}

export async function getReader(ctx: QueryCtx): Promise<string | null> {
  return (await getReaderSession(ctx))?.libraryId ?? null;
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

/**
 * Whether a library may still receive background work: the owner's always,
 * another reader's only while their row is active.
 */
export async function libraryIsActive(
  ctx: Pick<QueryCtx, "db">,
  libraryId: string,
): Promise<boolean> {
  if (libraryId === DEFAULT_USER_ID) return true;
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId))
    .first();
  return reader?.status === "active";
}

export const libraryActive = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: (ctx, args) => libraryIsActive(ctx, args.userId),
});

/** Signs a user out everywhere by deleting their Better Auth sessions. */
export async function revokeSessions(ctx: MutationCtx, authId: string) {
  for (let page = 0; page < 10; page++) {
    const result = await ctx.runMutation(
      components.betterAuth.adapter.deleteMany,
      {
        input: {
          model: "session",
          where: [{ field: "userId", value: authId }],
        },
        paginationOpts: { numItems: 100, cursor: null },
      },
    );
    if (result.isDone || !result.count) return;
  }
}

type AttemptRow = Doc<"authAttempts"> | null;

function attemptsUsed(row: AttemptRow, now: number, windowMs: number) {
  return row && now - row.startedAt < windowMs ? row.count : 0;
}

async function attemptRow(ctx: MutationCtx, scope: string) {
  return ctx.db
    .query("authAttempts")
    .withIndex("by_scope", (q) => q.eq("scope", scope))
    .unique();
}

async function recordAttempt(
  ctx: MutationCtx,
  scope: string,
  row: AttemptRow,
  now: number,
  windowMs: number,
) {
  if (row && now - row.startedAt < windowMs)
    await ctx.db.patch("authAttempts", row._id, { count: row.count + 1 });
  else if (row)
    await ctx.db.patch("authAttempts", row._id, { startedAt: now, count: 1 });
  else await ctx.db.insert("authAttempts", { scope, startedAt: now, count: 1 });
}

/** Spends one unit of an unauthenticated fixed-window budget, if any is left. */
export async function spendAuthBudget(
  ctx: MutationCtx,
  scope: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now();
  const row = await attemptRow(ctx, scope);
  if (attemptsUsed(row, now, windowMs) >= max) return false;
  await recordAttempt(ctx, scope, row, now, windowMs);
  return true;
}

export const PASSWORD_LIMITS = { perEmail: 8, global: 60, windowMs: 60_000 };

// Budgets are per email plus a global ceiling, independent of spoofable
// forwarded IP headers. A passkey still works if a password budget is full.
export const allowPasswordAttempt = internalMutation({
  args: { email: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const { perEmail, global, windowMs } = PASSWORD_LIMITS;
    const email = (args.email ?? "").trim().toLowerCase().slice(0, 320);
    const emailScope = `password:${email}`;
    const all = await attemptRow(ctx, "password");
    const mine = await attemptRow(ctx, emailScope);
    if (
      attemptsUsed(all, now, windowMs) >= global ||
      attemptsUsed(mine, now, windowMs) >= perEmail
    )
      return false;
    await recordAttempt(ctx, "password", all, now, windowMs);
    await recordAttempt(ctx, emailScope, mine, now, windowMs);
    return true;
  },
});

/** Drops budget rows whose window ended long ago, in bounded batches. */
export const sweepAuthAttempts = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("authAttempts")
      .withIndex("by_startedAt", (q) =>
        q.lt("startedAt", Date.now() - 2 * 60 * 60_000),
      )
      .take(200);
    for (const row of stale) await ctx.db.delete("authAttempts", row._id);
    if (stale.length === 200)
      await ctx.scheduler.runAfter(0, internal.access.sweepAuthAttempts, {});
    return null;
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
