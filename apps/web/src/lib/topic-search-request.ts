import { CONVEX_SITE_URL } from "./convex-site";
import { forgetConvexToken, getConvexToken } from "./convex-token";

/** After a network or CORS failure, go through the proxy for this long. */
const DIRECT_BACKOFF_MS = 5 * 60_000;
let directPausedUntil = 0;

export interface TopicSearchTransport {
  fetch: typeof fetch;
  site: string | undefined;
  getToken: () => Promise<string | null>;
  forgetToken: () => void;
  now: () => number;
}

const browser: TopicSearchTransport = {
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
 * Posts a library search. The browser calls the Convex HTTP endpoint directly
 * with the Convex JWT, skipping the Next.js proxy's server-side token fetch
 * and extra hop. Any network or CORS failure, a missing token or a 401 falls
 * back to the proxy route, which authenticates with the session cookie.
 */
export async function postTopicSearch(
  path: "find" | "search",
  question: string,
  signal: AbortSignal,
  transport: TopicSearchTransport = browser,
) {
  const body = JSON.stringify({ question });
  const send = (url: string, headers: Record<string, string>) =>
    transport.fetch(url, { method: "POST", headers, body, signal });

  let response: Response | undefined;
  if (transport.site && transport.now() >= directPausedUntil) {
    try {
      const token = await transport.getToken();
      if (token) {
        response = await send(`${transport.site}/api/library/${path}`, {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        });
        if (response.status === 401) {
          transport.forgetToken();
          response = undefined;
        }
      }
    } catch (thrown) {
      if (signal.aborted) throw thrown;
      directPausedUntil = transport.now() + DIRECT_BACKOFF_MS;
      response = undefined;
    }
  }
  response ??= await send(`/api/reader/library/${path}`, {
    "Content-Type": "application/json",
  });
  if (!response.ok) throw response;
  return response.json();
}
