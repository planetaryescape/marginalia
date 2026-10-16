import { useSyncExternalStore } from "react";

/** What one attempt at fetching a Convex token produced. */
export type TokenAttempt =
  | { token: string }
  | { status: number }
  | { error: unknown };

// A deploy switching the domain between builds, a sleeping laptop waking or a
// dropped connection all fail a token fetch for a moment. Convex treats a null
// token as signed out and does not ask again until the session changes, so a
// transient failure must be retried here, not reported as null.
const RETRY_DELAYS_MS = [500, 1500, 4000];

const definitelySignedOut = (status: number) =>
  status === 401 || status === 403;

/**
 * Fetches a token, retrying failures that may pass. Null only when the server
 * says the session is not signed in, or every retry failed.
 */
export async function fetchTokenWithRetry(
  attempt: () => Promise<TokenAttempt>,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<string | null> {
  for (let i = 0; ; i++) {
    let result: TokenAttempt;
    try {
      result = await attempt();
    } catch (error) {
      result = { error };
    }
    if ("token" in result) return result.token;
    if ("status" in result && definitelySignedOut(result.status)) return null;
    const delay = RETRY_DELAYS_MS[i];
    if (delay === undefined) return null;
    await sleep(delay);
  }
}

// A counter the auth hook depends on: bumping it hands Convex a new token
// function, which makes it fetch a token again from scratch
let nonce = 0;
const listeners = new Set<() => void>();

/** Asks Convex to authenticate again, after a failure it would not retry itself. */
export function rearmAuth(): void {
  nonce++;
  for (const listener of listeners) listener();
}

export function useAuthNonce(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => nonce,
    () => nonce,
  );
}
