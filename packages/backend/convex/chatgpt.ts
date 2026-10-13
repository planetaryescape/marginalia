// Sign in with ChatGPT, so a reader can answer with their ChatGPT plan. Every
// public function here refuses to do anything unless the deployment enables it
// (lib/providers.ts isChatGPTEnabled), which waits on OpenAI's approval.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./functions";
import {
  ATTEMPT_TTL_MS,
  authorizeUrl,
  CHATGPT_PLAN_NOT_ENABLED,
  CHATGPT_RECONNECT,
  CHATGPT_UNAVAILABLE,
  ChatGPTOAuthError,
  chatgptConfig,
  exchangeCode,
  PLAN_SCOPE,
  randomToken,
  revokeRefreshToken,
  sha256Base64Url,
  type TokenSet,
  verifyIdToken,
} from "./lib/chatgpt";
import { CHATGPT_NOT_ELIGIBLE } from "./lib/chatgptResponses";
import { openTokens, planModels, sealTokens } from "./lib/chatgptTokens";
import { decryptProviderKey, encryptProviderKey } from "./lib/providerKeys";
import { isChatGPTEnabled } from "./lib/providers";
import { requireReaderLimit } from "./limits";

const REFRESH_LEASE_MS = 30_000;

const modelList = v.array(v.object({ id: v.string(), name: v.string() }));

async function connectionRow(ctx: Pick<QueryCtx, "db">, userId: string) {
  return ctx.db
    .query("chatgptConnections")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * Null when the server doesn't offer ChatGPT. Otherwise the reader's
 * connection, if any, without any token material.
 */
export const connection = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      connection: v.union(
        v.null(),
        v.object({
          email: v.union(v.string(), v.null()),
          status: v.union(
            v.literal("connected"),
            v.literal("reconnect"),
            v.literal("plan_disabled"),
          ),
          message: v.union(v.string(), v.null()),
          models: v.number(),
          connectedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    if (!isChatGPTEnabled()) return null;
    const row = await connectionRow(ctx, ctx.readerId);
    if (!row) return { connection: null };
    return {
      connection: {
        email: row.email ?? null,
        status: row.status,
        message:
          row.message ??
          (row.status === "reconnect"
            ? CHATGPT_RECONNECT
            : row.status === "plan_disabled"
              ? CHATGPT_PLAN_NOT_ENABLED
              : null),
        models: row.models?.length ?? 0,
        connectedAt: row.createdAt,
      },
    };
  },
});

/** Begins Sign in with ChatGPT; the browser goes to the returned URL. */
export const start = action({
  args: { consent: v.optional(v.boolean()) },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    if (!isChatGPTEnabled()) throw new ConvexError(CHATGPT_UNAVAILABLE);
    await requireReaderLimit(ctx, ctx.readerId, "chatgptConnect");
    const config = chatgptConfig();
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);
    const sealed = await encryptProviderKey(
      verifier,
      ctx.readerId,
      "chatgpt-sign-in",
    );
    await ctx.runMutation(internal.chatgpt.createAttempt, {
      userId: ctx.readerId,
      stateHash: await sha256Base64Url(state),
      nonce,
      verifierCiphertext: sealed.ciphertext,
      verifierIv: sealed.iv,
      expiresAt: Date.now() + ATTEMPT_TTL_MS,
    });
    return {
      url: authorizeUrl(config, {
        state,
        nonce,
        codeChallenge: await sha256Base64Url(verifier),
        consent: args.consent,
      }),
    };
  },
});

const completion = v.union(
  v.literal("connected"),
  v.literal("plan_disabled"),
  v.literal("denied"),
  v.literal("expired"),
  v.literal("failed"),
  v.literal("unavailable"),
);

/**
 * Finishes a sign-in for the reader who began it. The web app's callback
 * route forwards OpenAI's `code` and `state` here with the reader's session.
 */
export const complete = action({
  args: {
    state: v.string(),
    code: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.object({ status: completion }),
  handler: async (ctx, args) => {
    if (!isChatGPTEnabled()) return { status: "unavailable" as const };
    await requireReaderLimit(ctx, ctx.readerId, "chatgptConnect");
    const userId = ctx.readerId;
    if (!args.state || args.state.length > 512)
      return { status: "expired" as const };
    const attempt = await ctx.runMutation(internal.chatgpt.consumeAttempt, {
      userId,
      stateHash: await sha256Base64Url(args.state),
    });
    if (!attempt) return { status: "expired" as const };
    if (args.error)
      return {
        status:
          args.error === "access_denied"
            ? ("denied" as const)
            : ("failed" as const),
      };
    if (!args.code || args.code.length > 4096)
      return { status: "failed" as const };

    const config = chatgptConfig();
    const verifier = await decryptProviderKey({
      userId,
      provider: "chatgpt-sign-in",
      ciphertext: attempt.verifierCiphertext,
      iv: attempt.verifierIv,
    });
    let tokens: TokenSet;
    try {
      tokens = await exchangeCode(config, args.code, verifier);
    } catch (error) {
      if (error instanceof ChatGPTOAuthError && error.code === "invalid_grant")
        return { status: "expired" as const };
      if (error instanceof ChatGPTOAuthError && error.code === "invalid_client")
        console.error(
          "OpenAI rejected this server's ChatGPT client (invalid_client). Check CHATGPT_CLIENT_ID and CHATGPT_CLIENT_SECRET.",
        );
      else console.error("ChatGPT code exchange failed", error);
      return { status: "failed" as const };
    }

    let identity: { subject: string; email?: string };
    try {
      identity = await verifyIdToken(tokens.id_token, {
        clientId: config.clientId,
        nonce: attempt.nonce,
      });
    } catch (error) {
      console.error(
        "ChatGPT ID token rejected:",
        error instanceof Error ? error.message : "invalid",
      );
      return { status: "failed" as const };
    }

    // Without plan scope the connection is kept but never used for answers
    const planEnabled = tokens.scopes.includes(PLAN_SCOPE);
    const models = planEnabled
      ? await planModels(tokens.access_token).catch((error) => {
          console.error("Couldn't list ChatGPT models", error);
          return [];
        })
      : [];
    await ctx.runMutation(internal.chatgpt.storeConnection, {
      userId,
      subject: identity.subject,
      email: identity.email,
      clientId: config.clientId,
      ...(await sealTokens(tokens, userId)),
      scopes: tokens.scopes,
      planEnabled,
      expiresAt: tokens.expiresAt,
      models,
    });
    return {
      status: planEnabled ? ("connected" as const) : ("plan_disabled" as const),
    };
  },
});

/**
 * Revokes the refresh token with OpenAI, then deletes the connection either
 * way. `revoked: false` means the reader should also disconnect in ChatGPT.
 */
export const disconnect = action({
  args: {},
  returns: v.object({ revoked: v.boolean() }),
  handler: async (ctx): Promise<{ revoked: boolean }> => {
    const userId = ctx.readerId;
    const row: {
      sealed: { ciphertext: string; iv: string } | null;
    } | null = await ctx.runQuery(internal.chatgpt.routingConnection, {
      userId,
    });
    if (!row) return { revoked: true };
    let revoked: boolean = !row.sealed;
    if (row.sealed && isChatGPTEnabled()) {
      try {
        const tokens = await openTokens(userId, row.sealed);
        revoked = await revokeRefreshToken(
          chatgptConfig(),
          tokens.refresh_token,
        );
      } catch {
        revoked = false;
      }
    }
    await ctx.runMutation(internal.chatgpt.removeConnection, { userId });
    return { revoked };
  },
});

export const createAttempt = internalMutation({
  args: {
    userId: v.string(),
    stateHash: v.string(),
    nonce: v.string(),
    verifierCiphertext: v.string(),
    verifierIv: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // One pending sign-in per reader: a new one replaces the last
    const pending = await ctx.db
      .query("chatgptAuthAttempts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(20);
    for (const row of pending)
      await ctx.db.delete("chatgptAuthAttempts", row._id);
    await ctx.db.insert("chatgptAuthAttempts", args);
    return null;
  },
});

/** The attempt for this state, deleted on use. Another reader's state is ignored. */
export const consumeAttempt = internalMutation({
  args: { userId: v.string(), stateHash: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      nonce: v.string(),
      verifierCiphertext: v.string(),
      verifierIv: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("chatgptAuthAttempts")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (!row || row.userId !== args.userId) return null;
    await ctx.db.delete("chatgptAuthAttempts", row._id);
    if (row.expiresAt <= Date.now()) return null;
    return {
      nonce: row.nonce,
      verifierCiphertext: row.verifierCiphertext,
      verifierIv: row.verifierIv,
    };
  },
});

export const storeConnection = internalMutation({
  args: {
    userId: v.string(),
    subject: v.string(),
    email: v.optional(v.string()),
    clientId: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    scopes: v.array(v.string()),
    planEnabled: v.boolean(),
    expiresAt: v.number(),
    models: modelList,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await connectionRow(ctx, args.userId);
    const fields = {
      subject: args.subject,
      email: args.email,
      clientId: args.clientId,
      ciphertext: args.ciphertext,
      iv: args.iv,
      scopes: args.scopes,
      planEnabled: args.planEnabled,
      expiresAt: args.expiresAt,
      status: args.planEnabled
        ? ("connected" as const)
        : ("plan_disabled" as const),
      message: undefined,
      models: args.models,
      modelsAt: now,
      refreshLease: undefined,
      updatedAt: now,
    };
    if (existing)
      await ctx.db.patch("chatgptConnections", existing._id, {
        ...fields,
        version: existing.version + 1,
      });
    else
      await ctx.db.insert("chatgptConnections", {
        userId: args.userId,
        ...fields,
        version: 1,
        createdAt: now,
      });
    return null;
  },
});

/**
 * Sealed tokens and state for actions that call ChatGPT for this library.
 * Internal only, like providerCredentials.routing.
 */
export const routingConnection = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(
        v.literal("connected"),
        v.literal("reconnect"),
        v.literal("plan_disabled"),
      ),
      planEnabled: v.boolean(),
      sealed: v.union(
        v.null(),
        v.object({ ciphertext: v.string(), iv: v.string() }),
      ),
      expiresAt: v.number(),
      version: v.number(),
      modelsAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await connectionRow(ctx, args.userId);
    if (!row) return null;
    return {
      status: row.status,
      planEnabled: row.planEnabled && row.status === "connected",
      sealed:
        row.ciphertext && row.iv
          ? { ciphertext: row.ciphertext, iv: row.iv }
          : null,
      expiresAt: row.expiresAt,
      version: row.version,
      modelsAt: row.modelsAt ?? null,
    };
  },
});

/** Claims the right to spend the refresh token, if nobody holds it and the tokens are unchanged. */
export const acquireRefreshLease = internalMutation({
  args: { userId: v.string(), version: v.number(), leaseId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await connectionRow(ctx, args.userId);
    if (!row?.ciphertext || row.version !== args.version) return false;
    const now = Date.now();
    if (row.refreshLease && row.refreshLease.until > now) return false;
    await ctx.db.patch("chatgptConnections", row._id, {
      refreshLease: { id: args.leaseId, until: now + REFRESH_LEASE_MS },
    });
    return true;
  },
});

/** Stores rotated tokens together, only for the lease holder. */
export const finishRefresh = internalMutation({
  args: {
    userId: v.string(),
    leaseId: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    scopes: v.array(v.string()),
    planEnabled: v.boolean(),
    expiresAt: v.number(),
    models: v.optional(modelList),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await connectionRow(ctx, args.userId);
    if (!row || row.refreshLease?.id !== args.leaseId) return false;
    const now = Date.now();
    await ctx.db.patch("chatgptConnections", row._id, {
      ciphertext: args.ciphertext,
      iv: args.iv,
      scopes: args.scopes,
      planEnabled: args.planEnabled,
      expiresAt: args.expiresAt,
      status: args.planEnabled ? row.status : "plan_disabled",
      ...(args.models ? { models: args.models, modelsAt: now } : {}),
      refreshLease: undefined,
      version: row.version + 1,
      updatedAt: now,
    });
    return true;
  },
});

export const releaseRefreshLease = internalMutation({
  args: { userId: v.string(), leaseId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await connectionRow(ctx, args.userId);
    if (row?.refreshLease?.id === args.leaseId)
      await ctx.db.patch("chatgptConnections", row._id, {
        refreshLease: undefined,
      });
    return null;
  },
});

/** The tokens can't be used again: clear them and ask the reader to reconnect. */
export const markReconnect = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await connectionRow(ctx, args.userId);
    if (!row) return null;
    await ctx.db.patch("chatgptConnections", row._id, {
      ciphertext: undefined,
      iv: undefined,
      status: "reconnect",
      message: CHATGPT_RECONNECT,
      refreshLease: undefined,
      version: row.version + 1,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** OpenAI says this reader's plan can't be used here. */
export const markPlanUnavailable = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await connectionRow(ctx, args.userId);
    if (!row) return null;
    await ctx.db.patch("chatgptConnections", row._id, {
      planEnabled: false,
      status: "plan_disabled",
      message: CHATGPT_NOT_ELIGIBLE,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** For the account purge: the sealed tokens and the client they were issued to. */
export const revocationTarget = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      clientId: v.string(),
      sealed: v.object({ ciphertext: v.string(), iv: v.string() }),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await connectionRow(ctx, args.userId);
    if (!row?.ciphertext || !row.iv) return null;
    return {
      clientId: row.clientId,
      sealed: { ciphertext: row.ciphertext, iv: row.iv },
    };
  },
});

/**
 * Scheduled by the account purge: revokes the deleted reader's refresh token
 * with OpenAI, best effort, then deletes the connection. Works even when the
 * server has since turned ChatGPT off, using the client the token was issued to.
 */
export const revokeForDeletion = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const target: {
        clientId: string;
        sealed: { ciphertext: string; iv: string };
      } | null = await ctx.runQuery(internal.chatgpt.revocationTarget, args);
      if (target) {
        const configured = process.env.CHATGPT_CLIENT_ID?.trim();
        const clientSecret =
          configured === target.clientId
            ? process.env.CHATGPT_CLIENT_SECRET?.trim() || undefined
            : undefined;
        const tokens = await openTokens(args.userId, target.sealed);
        const revoked = await revokeRefreshToken(
          { clientId: target.clientId, redirectUri: "", clientSecret },
          tokens.refresh_token,
        );
        if (!revoked)
          console.warn(
            "OpenAI didn't confirm revoking a deleted reader's ChatGPT token",
          );
      }
    } catch {
      console.error("Couldn't revoke a deleted reader's ChatGPT token");
    }
    await ctx.runMutation(internal.chatgpt.removeConnection, args);
    return null;
  },
});

export const removeConnection = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await connectionRow(ctx, args.userId);
    if (row) await ctx.db.delete("chatgptConnections", row._id);
    return null;
  },
});
