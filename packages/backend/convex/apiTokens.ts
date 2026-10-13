import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { libraryIsActive } from "./access";
import { action, internalMutation, mutation, query } from "./functions";
import { newToken, sha256Hex } from "./lib/tokens";
import { requireReaderLimit, spendReaderLimit } from "./limits";

export const TOKEN_PREFIX = "mrg_";
const MAX_TOKENS = 10;
// lastUsedAt is a hint for the account page, so it isn't written on every call
const LAST_USED_RESOLUTION_MS = 60_000;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("apiTokens")
      .withIndex("by_userId", (q) => q.eq("userId", ctx.readerId))
      .take(MAX_TOKENS);
    return rows.map((row) => ({
      id: row._id,
      name: row.name,
      last4: row.last4,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? null,
    }));
  },
});

/** Creates a token and returns it once; only its hash is kept. */
export const create = action({
  args: { name: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"apiTokens">; token: string }> => {
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new ConvexError("Name the app this token is for.");
    await requireReaderLimit(ctx, ctx.readerId, "apiTokenCreate");
    const token = `${TOKEN_PREFIX}${newToken()}`;
    const id: Id<"apiTokens"> = await ctx.runMutation(
      internal.apiTokens.insert,
      {
        userId: ctx.readerId,
        name,
        hash: await sha256Hex(token),
        last4: token.slice(-4),
      },
    );
    return { id, token };
  },
});

export const insert = internalMutation({
  args: {
    userId: v.string(),
    name: v.string(),
    hash: v.string(),
    last4: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("apiTokens")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(MAX_TOKENS);
    if (existing.length >= MAX_TOKENS)
      throw new ConvexError(
        `You can have up to ${MAX_TOKENS} tokens. Revoke one you no longer use first.`,
      );
    return ctx.db.insert("apiTokens", { ...args, createdAt: Date.now() });
  },
});

export const revoke = mutation({
  args: { tokenId: v.id("apiTokens") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("apiTokens", args.tokenId);
    if (row?.userId !== ctx.readerId) throw new Error("Token not found");
    await ctx.db.delete("apiTokens", args.tokenId);
  },
});

export type ResolvedToken =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "rate_limited" };

/**
 * The library a token belongs to, spending one request from its API budget.
 * A token stops working when its reader is disabled or being deleted.
 */
export const resolve = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, args): Promise<ResolvedToken> => {
    const row = await ctx.db
      .query("apiTokens")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .unique();
    if (!row || !(await libraryIsActive(ctx, row.userId)))
      return { ok: false, reason: "invalid" };
    if (!(await spendReaderLimit(ctx, row.userId, "api")))
      return { ok: false, reason: "rate_limited" };
    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt > LAST_USED_RESOLUTION_MS)
      await ctx.db.patch("apiTokens", row._id, { lastUsedAt: now });
    return { ok: true, userId: row.userId };
  },
});
