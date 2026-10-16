import { authClient } from "./auth-client";

/** Refresh this long before expiry so a request never carries a dying token. */
const REFRESH_MARGIN_MS = 60_000;

interface Cached {
  token: string;
  expiresAt: number;
}

let cached: Cached | null = null;
let inflight: Promise<string | null> | null = null;

/** The JWT's `exp` in ms, or null when it can't be read. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Keeps a token the Convex client obtained, so direct calls can reuse it. */
export function rememberConvexToken(token: string | null) {
  const expiresAt = token ? tokenExpiry(token) : null;
  cached = token && expiresAt ? { token, expiresAt } : null;
}

export function forgetConvexToken() {
  cached = null;
}

/**
 * A Convex JWT for direct calls to the HTTP endpoint, or null when there is no
 * session. Refreshes through the auth client when none is cached or it is
 * within a minute of expiring.
 */
export function getConvexToken(
  now: () => number = Date.now,
  fetchToken: () => Promise<string | null> = async () => {
    const result = await authClient.convex.token({
      fetchOptions: { throw: false },
    });
    return result.data?.token ?? null;
  },
): Promise<string | null> {
  if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS)
    return Promise.resolve(cached.token);
  inflight ??= fetchToken()
    .then((token) => {
      rememberConvexToken(token);
      return token;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
