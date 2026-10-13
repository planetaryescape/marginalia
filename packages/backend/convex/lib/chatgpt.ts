// Sign in with ChatGPT: OAuth 2.0 with PKCE and OpenID Connect against
// OpenAI's hosted accounts service, and the ChatGPT plan's model list. Only
// used when isChatGPTEnabled() (lib/providers.ts) is true.
// See https://developers.openai.com/siwc
import { ConvexError } from "convex/values";
import { createLocalJWKSet, jwtVerify } from "jose";

// From https://auth.openai.com/.well-known/openid-configuration. Correct an
// endpoint here only.
export const CHATGPT_OAUTH = {
  issuer: "https://auth.openai.com",
  authorizationEndpoint: "https://auth.openai.com/api/accounts/authorize",
  tokenEndpoint: "https://auth.openai.com/api/accounts/oauth/token",
  revocationEndpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
  jwksUri: "https://auth.openai.com/.well-known/jwks.json",
} as const;

export const CHATGPT_RESOURCE = "https://api.openai.com/v1";
export const CHATGPT_MODELS_URL = "https://api.openai.com/v1/models";
export const CHATGPT_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** Lets this app spend the reader's ChatGPT plan on their requests. */
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const CHATGPT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  PLAN_SCOPE,
] as const;

/** Pending sign-ins expire after ten minutes. */
export const ATTEMPT_TTL_MS = 10 * 60_000;
/** Refresh access tokens that expire within two minutes. */
export const REFRESH_MARGIN_MS = 2 * 60_000;
/** Re-read the plan's model list at most this often. */
export const MODELS_TTL_MS = 6 * 60 * 60_000;

export const CHATGPT_UNAVAILABLE =
  "Connecting ChatGPT isn't available on this server.";
export const CHATGPT_RECONNECT =
  "Your ChatGPT connection has expired. Reconnect ChatGPT in Your account.";
export const CHATGPT_PLAN_NOT_ENABLED =
  "ChatGPT didn't allow this reader to use your plan. Connect again and allow plan usage to use it here.";
export const CHATGPT_CONFIG_ERROR =
  "This server's ChatGPT sign-in is misconfigured. Ask the reader's owner to check it.";

export interface ChatGPTConfig {
  clientId: string;
  redirectUri: string;
  clientSecret?: string;
}

/** The deployment's client registration. Call only after isChatGPTEnabled(). */
export function chatgptConfig(): ChatGPTConfig {
  const clientId = process.env.CHATGPT_CLIENT_ID?.trim();
  const redirectUri = process.env.CHATGPT_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) throw new ConvexError(CHATGPT_UNAVAILABLE);
  const clientSecret = process.env.CHATGPT_CLIENT_SECRET?.trim() || undefined;
  return { clientId, redirectUri, clientSecret };
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

export function authorizeUrl(
  config: ChatGPTConfig,
  {
    state,
    nonce,
    codeChallenge,
    loginHint,
    consent,
  }: {
    state: string;
    nonce: string;
    codeChallenge: string;
    loginHint?: string;
    consent?: boolean;
  },
): string {
  const url = new URL(CHATGPT_OAUTH.authorizationEndpoint);
  const params: Record<string, string> = {
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: CHATGPT_SCOPES.join(" "),
    resource: CHATGPT_RESOURCE,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  };
  if (loginHint) params.login_hint = loginHint;
  if (consent) params.prompt = "consent";
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return url.toString();
}

/** A token-endpoint failure, keeping OpenAI's error code. Never holds a token. */
export class ChatGPTOAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`ChatGPT sign-in failed (${status}${code ? ` ${code}` : ""})`);
  }
}

/** Refresh failures after which the stored refresh token can never work again. */
const UNUSABLE_REFRESH = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

export function isUnusableRefresh(error: unknown): boolean {
  return (
    error instanceof ChatGPTOAuthError &&
    error.code !== undefined &&
    UNUSABLE_REFRESH.has(error.code)
  );
}

export function isClientConfigError(error: unknown): boolean {
  return error instanceof ChatGPTOAuthError && error.code === "invalid_client";
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  id_token: string;
  scopes: string[];
  expiresAt: number;
}

function tokenHeaders(config: ChatGPTConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  // A confidential client's secret goes only in Basic auth, never the body
  if (config.clientSecret)
    headers.Authorization = `Basic ${btoa(
      `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
    )}`;
  return headers;
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    code?: unknown;
  } | null;
  if (typeof body?.error === "string") return body.error;
  if (body?.error && typeof body.error === "object") {
    const code = (body.error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return typeof body?.code === "string" ? body.code : undefined;
}

async function postTokenForm(
  config: ChatGPTConfig,
  form: Record<string, string>,
  previous?: { refresh_token: string; id_token: string },
): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetch(CHATGPT_OAUTH.tokenEndpoint, {
      method: "POST",
      headers: tokenHeaders(config),
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ChatGPTOAuthError(0, "network_error");
  }
  if (!response.ok)
    throw new ChatGPTOAuthError(response.status, await errorCode(response));
  const json = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    refresh_token?: unknown;
    id_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  } | null;
  const refresh =
    typeof json?.refresh_token === "string"
      ? json.refresh_token
      : previous?.refresh_token;
  const idToken =
    typeof json?.id_token === "string" ? json.id_token : previous?.id_token;
  if (typeof json?.access_token !== "string" || !refresh || !idToken)
    throw new ChatGPTOAuthError(response.status, "invalid_token_response");
  const expiresIn =
    typeof json.expires_in === "number" && json.expires_in > 0
      ? json.expires_in
      : 3600;
  return {
    access_token: json.access_token,
    refresh_token: refresh,
    id_token: idToken,
    // Per RFC 6749 §5.1 an omitted scope means the requested scopes were granted
    scopes:
      typeof json.scope === "string"
        ? json.scope.split(/\s+/).filter(Boolean)
        : [...CHATGPT_SCOPES],
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export function exchangeCode(
  config: ChatGPTConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenSet> {
  return postTokenForm(config, {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: config.redirectUri,
    resource: CHATGPT_RESOURCE,
  });
}

/** Refresh tokens rotate: the result replaces every stored token. */
export function refreshTokens(
  config: ChatGPTConfig,
  previous: { refresh_token: string; id_token: string },
): Promise<TokenSet> {
  return postTokenForm(
    config,
    {
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: previous.refresh_token,
      resource: CHATGPT_RESOURCE,
    },
    previous,
  );
}

/** Revokes the refresh token; true only when OpenAI confirms it. */
export async function revokeRefreshToken(
  config: ChatGPTConfig,
  refreshToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(CHATGPT_OAUTH.revocationEndpoint, {
      method: "POST",
      headers: tokenHeaders(config),
      body: new URLSearchParams({
        token: refreshToken,
        token_type_hint: "refresh_token",
        client_id: config.clientId,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel().catch(() => {});
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Checks the ID token's signature against OpenAI's published keys, and its
 * issuer, audience, expiry and nonce. Returns the account identity.
 */
export async function verifyIdToken(
  idToken: string,
  { clientId, nonce }: { clientId: string; nonce: string },
): Promise<{ subject: string; email?: string }> {
  const response = await fetch(CHATGPT_OAUTH.jwksUri, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`JWKS returned ${response.status}`);
  const jwks = createLocalJWKSet(await response.json());
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: CHATGPT_OAUTH.issuer,
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "sub"],
  });
  if (payload.nonce !== nonce) throw new Error("ID token nonce mismatch");
  if (typeof payload.sub !== "string" || !payload.sub)
    throw new Error("ID token has no subject");
  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

/** The models the reader's plan lists for this app, as plan slugs and names. */
export async function listPlanModels(
  accessToken: string,
): Promise<{ id: string; name: string }[]> {
  const response = await fetch(CHATGPT_MODELS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`ChatGPT model list returned ${response.status}`);
  }
  const json = (await response.json().catch(() => null)) as {
    models?: unknown;
  } | null;
  const models = Array.isArray(json?.models) ? json.models : [];
  const seen = new Set<string>();
  const listed: { id: string; name: string }[] = [];
  for (const model of models as Record<string, unknown>[]) {
    if (model?.visibility !== "list" || typeof model.slug !== "string")
      continue;
    if (seen.has(model.slug)) continue;
    seen.add(model.slug);
    listed.push({
      id: model.slug,
      name:
        typeof model.display_name === "string" && model.display_name
          ? model.display_name
          : model.slug,
    });
    if (listed.length >= 50) break;
  }
  return listed;
}
