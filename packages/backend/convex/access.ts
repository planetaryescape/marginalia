import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";

export async function getOwner(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  // Bind the subject to this deployment's issuer, not just an arbitrary user ID.
  if (
    !identity ||
    identity.issuer !== process.env.CONVEX_SITE_URL ||
    typeof identity.sessionId !== "string"
  )
    return null;
  const owner = await ctx.db
    .query("readerAccess")
    .withIndex("by_key", (q) => q.eq("key", "owner"))
    .unique();
  if (!owner?.authId || identity.subject !== owner.authId) return null;
  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [
      { field: "_id", value: identity.sessionId },
      { field: "userId", value: owner.authId },
      { field: "expiresAt", operator: "gt", value: Date.now() },
    ],
  });
  // A still-valid JWT must not outlive a sign-out or revoked session.
  return session ? owner : null;
}

export async function requireOwner(ctx: QueryCtx): Promise<void> {
  if (!(await getOwner(ctx)))
    throw new ConvexError("Sign in to your private reader.");
}

export const assertOwner = internalQuery({ args: {}, handler: requireOwner });

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
