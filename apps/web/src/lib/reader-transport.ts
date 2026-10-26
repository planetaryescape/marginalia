import { abortable } from "./abortable";
import { CONVEX_SITE_URL } from "./convex-site";
import { forgetConvexToken, getConvexToken } from "./convex-token";

const DIRECT_BACKOFF_MS = 5 * 60_000;
const TOKEN_WAIT_MS = 8_000;
let directPausedUntil = 0;

export interface ReaderTransport {
  fetch: typeof fetch;
  site: string | undefined;
  getToken: () => Promise<string | null>;
  forgetToken: () => void;
  now: () => number;
}

const browser: ReaderTransport = {
  fetch: (...args) => fetch(...args),
  site: CONVEX_SITE_URL,
  getToken: () => getConvexToken(),
  forgetToken: forgetConvexToken,
  now: Date.now,
};

export function resetDirectBackoff() {
  directPausedUntil = 0;
}

/**
 * Retry via the cookie-authenticated legacy proxy only when no generation can
 * have started: before dispatch, or an explicit authentication/route rejection.
 * A network/CORS error after dispatch is ambiguous and MUST NOT replay paid work.
 */
export async function postReaderRequest(
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  transport: ReaderTransport = browser,
): Promise<Response> {
  signal.throwIfAborted();
  const encoded = JSON.stringify(body);
  const send = (url: string, headers: Record<string, string>) =>
    abortable(
      transport.fetch(url, { method: "POST", headers, body: encoded, signal }),
      signal,
    );
  if (transport.site && transport.now() >= directPausedUntil) {
    let token: string | null = null;
    const wait = new AbortController();
    const timer = setTimeout(
      () =>
        wait.abort(new DOMException("Token wait timed out", "TimeoutError")),
      TOKEN_WAIT_MS,
    );
    try {
      // Only this waiter times out; the session's shared refresh stays alive.
      token = await abortable(
        transport.getToken(),
        AbortSignal.any([signal, wait.signal]),
      );
    } catch (error) {
      if (signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
    }
    signal.throwIfAborted();
    if (token) {
      let response: Response;
      try {
        response = await send(`${transport.site}/api/${path}`, {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        });
      } catch (error) {
        if (!signal.aborted)
          directPausedUntil = transport.now() + DIRECT_BACKOFF_MS;
        throw error;
      }
      const authRejected =
        response.status === 401 &&
        response.headers.get("X-Reader-Prework-Rejection") === "auth";
      // A provider/ChatGPT 401 is NOT an authentication preflight rejection.
      if (!authRejected && ![404, 405].includes(response.status))
        return response;
      if (authRejected) transport.forgetToken();
      // Rejected before paid work. A stalled cancellation handshake must not
      // prevent the safe proxy request (or Stop) from completing.
      void response.body?.cancel().catch(() => {});
    }
  }
  signal.throwIfAborted();
  return send(`/api/reader/${path}`, { "Content-Type": "application/json" });
}
