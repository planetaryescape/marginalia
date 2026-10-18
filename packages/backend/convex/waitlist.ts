import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
// Raw, unauthenticated mutation: used ONLY for `request` below, so anyone can
// ask for access without an account. Everything else here is owner-only.
import { mutation as publicMutation } from "./_generated/server";
import { spendAuthBudget } from "./access";
import {
  internalMutation,
  type MutationCtx,
  ownerAction,
  ownerMutation,
  ownerQuery,
} from "./functions";
import { initializeEmptyMetadata } from "./lib/articleMetadata";
import { DEFAULT_USER_ID } from "./lib/constants";
import {
  EMAIL_PATTERN,
  newToken,
  normalizeEmail,
  sha256Hex,
  siteUrl,
} from "./lib/tokens";

export const WAITLIST_MESSAGE =
  "Thanks. You'll get an invite link if a spot opens.";
// New requests across everyone, to resist spam without tracking requesters
export const WAITLIST_BUDGET = { max: 20, windowMs: 60 * 60_000 };
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
// The sign-up hook reserves an invite; account creation must follow promptly
const RESERVATION_MS = 15 * 60_000;
const INVALID_INVITE = "This invite link is invalid or has expired.";

export const request = publicMutation({
  args: {
    email: v.string(),
    name: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.object({ message: v.string() }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const name = args.name.trim();
    const note = args.note?.trim() || undefined;
    if (email.length > 254 || !EMAIL_PATTERN.test(email))
      throw new ConvexError("Enter a valid email address.");
    if (!name || name.length > 100)
      throw new ConvexError("Enter your name, up to 100 characters.");
    if (note && note.length > 500)
      throw new ConvexError("Keep the note under 500 characters.");
    const existing = await ctx.db
      .query("accessRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    // Same answer whether the email is new, known, approved or over budget
    if (
      !existing &&
      (await spendAuthBudget(
        ctx,
        "waitlist",
        WAITLIST_BUDGET.max,
        WAITLIST_BUDGET.windowMs,
      ))
    )
      await ctx.db.insert("accessRequests", {
        email,
        name,
        note,
        status: "pending",
        createdAt: Date.now(),
      });
    return { message: WAITLIST_MESSAGE };
  },
});

const requestView = v.object({
  _id: v.id("accessRequests"),
  email: v.string(),
  name: v.string(),
  note: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("declined"),
  ),
  createdAt: v.number(),
  decidedAt: v.optional(v.number()),
});

function viewRequest(row: Doc<"accessRequests">) {
  return {
    _id: row._id,
    email: row.email,
    name: row.name,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export const listRequests = ownerQuery({
  args: {},
  returns: v.object({
    pending: v.array(requestView),
    recent: v.array(requestView),
  }),
  handler: async (ctx) => {
    const byStatus = (status: Doc<"accessRequests">["status"], n: number) =>
      ctx.db
        .query("accessRequests")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
        .order("desc")
        .take(n);
    const pending = await byStatus("pending", 50);
    const recent = [
      ...(await byStatus("approved", 15)),
      ...(await byStatus("declined", 15)),
    ]
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
      .slice(0, 15);
    return {
      pending: pending.map(viewRequest),
      recent: recent.map(viewRequest),
    };
  },
});

/** Matches the existing menu's bounded pending count without request details. */
export const pendingCount = ownerQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) =>
    (
      await ctx.db
        .query("accessRequests")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "pending"))
        .order("desc")
        .take(50)
    ).length,
});

/**
 * Approves a request and returns its invite link. The plaintext token exists
 * only in this response; the database keeps its hash.
 */
export const approve = ownerAction({
  args: { requestId: v.id("accessRequests") },
  returns: v.object({
    url: v.string(),
    email: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const token = newToken();
    const invite: { email: string; expiresAt: number } = await ctx.runMutation(
      internal.waitlist.issueInvite,
      {
        requestId: args.requestId,
        tokenHash: await sha256Hex(token),
      },
    );
    return {
      url: `${siteUrl()}/#invite=${token}`,
      email: invite.email,
      expiresAt: invite.expiresAt,
    };
  },
});

export const issueInvite = internalMutation({
  args: { requestId: v.id("accessRequests"), tokenHash: v.string() },
  returns: v.object({ email: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.tokenHash))
      throw new Error("Invalid invite hash");
    const request = await ctx.db.get("accessRequests", args.requestId);
    if (!request) throw new ConvexError("That request no longer exists.");
    if (request.status === "approved")
      throw new ConvexError(
        "This request already has an invite. Revoke it to issue a new link.",
      );
    const now = Date.now();
    const expiresAt = now + INVITE_TTL_MS;
    const inviteId = await ctx.db.insert("invites", {
      tokenHash: args.tokenHash,
      email: request.email,
      name: request.name,
      requestId: request._id,
      expiresAt,
      createdAt: now,
    });
    await ctx.db.patch("accessRequests", request._id, {
      status: "approved",
      decidedAt: now,
      inviteId,
    });
    return { email: request.email, expiresAt };
  },
});

export const decline = ownerMutation({
  args: { requestId: v.id("accessRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get("accessRequests", args.requestId);
    if (!request) throw new ConvexError("That request no longer exists.");
    if (request.status === "approved")
      throw new ConvexError("Revoke this request's invite before declining.");
    await ctx.db.patch("accessRequests", request._id, {
      status: "declined",
      decidedAt: Date.now(),
    });
    return null;
  },
});

/** Invites not yet used or revoked, newest first. Expired ones show as such. */
export const listInvites = ownerQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("invites"),
      email: v.string(),
      createdAt: v.number(),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const recent = await ctx.db.query("invites").order("desc").take(100);
    return recent
      .filter((row) => !row.consumedAt && !row.revokedAt)
      .map((row) => ({
        _id: row._id,
        email: row.email,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      }));
  },
});

/** Revokes an unused invite and returns its request to the pending list. */
export const revokeInvite = ownerMutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get("invites", args.inviteId);
    if (!invite) throw new ConvexError("That invite no longer exists.");
    if (invite.consumedAt)
      throw new ConvexError("This invite was already used.");
    if (!invite.revokedAt)
      await ctx.db.patch("invites", invite._id, { revokedAt: Date.now() });
    const request = invite.requestId
      ? await ctx.db.get("accessRequests", invite.requestId)
      : null;
    if (request?.inviteId === invite._id)
      await ctx.db.patch("accessRequests", request._id, {
        status: "pending",
        decidedAt: undefined,
        inviteId: undefined,
      });
    return null;
  },
});

function inviteUsable(invite: Doc<"invites">, now: number) {
  return !invite.consumedAt && !invite.revokedAt && invite.expiresAt > now;
}

/** Called by the sign-up hook: the token must match an open invite for this email. */
export const reserveInvite = internalMutation({
  args: { hash: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.hash))
      .unique();
    if (
      !invite ||
      !inviteUsable(invite, now) ||
      invite.email !== normalizeEmail(args.email)
    )
      throw new ConvexError(INVALID_INVITE);
    await ctx.db.patch("invites", invite._id, { reservedAt: now });
    return null;
  },
});

/**
 * Runs inside account creation: consumes the reserved invite for this email
 * and opens the reader's own library, all in one transaction. False when no
 * invite applies, so the caller can refuse the account.
 */
export async function claimInvite(
  ctx: MutationCtx,
  user: { _id: string; email: string; name?: string | null },
): Promise<boolean> {
  if (user._id === DEFAULT_USER_ID) return false;
  const email = normalizeEmail(user.email);
  const now = Date.now();
  const candidates = await ctx.db
    .query("invites")
    .withIndex("by_email", (q) => q.eq("email", email))
    .order("desc")
    .take(20);
  const invite = candidates.find(
    (row) =>
      inviteUsable(row, now) &&
      row.reservedAt !== undefined &&
      now - row.reservedAt < RESERVATION_MS,
  );
  if (!invite) return false;
  const existing = await ctx.db
    .query("readers")
    .withIndex("by_authId", (q) => q.eq("authId", user._id))
    .first();
  if (existing) return false;
  await ctx.db.patch("invites", invite._id, {
    consumedAt: now,
    consumedBy: user._id,
  });
  await ctx.db.insert("readers", {
    authId: user._id,
    libraryId: user._id,
    status: "active",
    email,
    name: user.name?.trim() || invite.name,
    createdAt: now,
  });
  await initializeEmptyMetadata(ctx, user._id);
  return true;
}
