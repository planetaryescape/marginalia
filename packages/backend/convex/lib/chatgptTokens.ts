// A reader's ChatGPT tokens: sealing, and a fresh access token for each
// request. Refresh tokens rotate, so only the holder of the connection's
// refresh lease may spend one; everyone else waits for the new token.
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  CHATGPT_CONFIG_ERROR,
  chatgptConfig,
  isClientConfigError,
  isUnusableRefresh,
  listPlanModels,
  MODELS_TTL_MS,
  PLAN_SCOPE,
  REFRESH_MARGIN_MS,
  randomToken,
  refreshTokens,
  type TokenSet,
} from "./chatgpt";
import { decryptProviderKey, encryptProviderKey } from "./providerKeys";
import { CHATGPT_MODEL_PREFIX } from "./providers";

type Runner = Pick<ActionCtx, "runQuery" | "runMutation">;

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
}

export function sealTokens(tokens: StoredTokens, userId: string) {
  const { access_token, refresh_token, id_token } = tokens;
  return encryptProviderKey(
    JSON.stringify({ access_token, refresh_token, id_token }),
    userId,
    "chatgpt",
  );
}

export async function openTokens(
  userId: string,
  sealed: { ciphertext: string; iv: string },
): Promise<StoredTokens> {
  const opened = JSON.parse(
    await decryptProviderKey({ ...sealed, userId, provider: "chatgpt" }),
  ) as StoredTokens;
  if (!opened.access_token || !opened.refresh_token)
    throw new Error("Sealed ChatGPT tokens are incomplete");
  return opened;
}

/** The plan's models as stored on the connection: namespaced IDs. */
export async function planModels(accessToken: string) {
  return (await listPlanModels(accessToken)).map((model) => ({
    id: `${CHATGPT_MODEL_PREFIX}${model.id}`,
    name: model.name,
  }));
}

const LEASE_WAIT_MS = 250;
const LEASE_ATTEMPTS = 20;

/**
 * A usable access token for the reader's ChatGPT plan, refreshed when it
 * expires within two minutes. Null when the reader has no usable connection.
 * Throws a configuration error when OpenAI rejects this server's client.
 */
export async function chatgptAccessToken(
  ctx: Runner,
  userId: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < LEASE_ATTEMPTS; attempt++) {
    const row = await ctx.runQuery(internal.chatgpt.routingConnection, {
      userId,
    });
    if (!row?.sealed || !row.planEnabled) return null;
    let tokens: StoredTokens;
    try {
      tokens = await openTokens(userId, row.sealed);
    } catch {
      console.error("Couldn't open saved ChatGPT tokens");
      return null;
    }
    if (row.expiresAt - Date.now() > REFRESH_MARGIN_MS)
      return tokens.access_token;

    const leaseId = randomToken(16);
    const acquired: boolean = await ctx.runMutation(
      internal.chatgpt.acquireRefreshLease,
      { userId, version: row.version, leaseId },
    );
    if (acquired) return refreshWithLease(ctx, userId, leaseId, tokens, row);
    // Another request is refreshing; its new token arrives with a new version
    await new Promise((resolve) => setTimeout(resolve, LEASE_WAIT_MS));
  }
  return null;
}

async function refreshWithLease(
  ctx: Runner,
  userId: string,
  leaseId: string,
  tokens: StoredTokens,
  row: { expiresAt: number; modelsAt: number | null },
): Promise<string | null> {
  let next: TokenSet;
  try {
    next = await refreshTokens(chatgptConfig(), tokens);
  } catch (error) {
    if (isUnusableRefresh(error)) {
      await ctx.runMutation(internal.chatgpt.markReconnect, { userId });
      return null;
    }
    await ctx.runMutation(internal.chatgpt.releaseRefreshLease, {
      userId,
      leaseId,
    });
    if (isClientConfigError(error)) {
      console.error(
        "OpenAI rejected this server's ChatGPT client (invalid_client). Check CHATGPT_CLIENT_ID and CHATGPT_CLIENT_SECRET.",
      );
      throw new ConvexError(CHATGPT_CONFIG_ERROR);
    }
    console.error("ChatGPT token refresh failed", error);
    // A temporary failure: the current token may still have a little life
    return row.expiresAt > Date.now() ? tokens.access_token : null;
  }

  const planEnabled = next.scopes.includes(PLAN_SCOPE);
  let models: { id: string; name: string }[] | undefined;
  if (planEnabled && Date.now() - (row.modelsAt ?? 0) > MODELS_TTL_MS)
    models = await planModels(next.access_token).catch((error) => {
      console.error("Couldn't refresh the ChatGPT model list", error);
      return undefined;
    });
  const stored: boolean = await ctx.runMutation(
    internal.chatgpt.finishRefresh,
    {
      userId,
      leaseId,
      ...(await sealTokens(next, userId)),
      scopes: next.scopes,
      planEnabled,
      expiresAt: next.expiresAt,
      models,
    },
  );
  return stored && planEnabled ? next.access_token : null;
}
