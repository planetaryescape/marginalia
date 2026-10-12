// Readwise Reader API client: https://readwise.io/reader_api
// Rate limits are per token: 20/min for list and delete, 50/min for save and update.
// Every call takes the library's own token (see readwiseTokenFor).

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { ownerDeploymentReadwiseToken } from "./ownerTransition";
import { decryptProviderKey } from "./providerKeys";

const API = "https://readwise.io/api/v3";
const MAX_RETRIES = 3;

export type ReaderLocation = "new" | "later" | "shortlist" | "archive" | "feed";

export interface ReaderDocument {
  id: string;
  url: string;
  source_url: string | null;
  title: string | null;
  author: string | null;
  category: string;
  location: ReaderLocation | null;
  parent_id: string | null;
  /** The highlighted passage, on highlight documents. */
  content?: string | null;
  html_content?: string | null;
  summary: string | null;
  image_url: string | null;
  published_date: string | number | null;
  word_count: number | null;
  updated_at: string;
}

/**
 * The library's Readwise token for background work: the reader's own sealed
 * token, or (owner only, during the transition) the deployment's. Null when
 * the library has none or is no longer active.
 */
export async function readwiseTokenFor(
  ctx: Pick<ActionCtx, "runQuery">,
  userId: string,
): Promise<string | null> {
  const saved = await ctx.runQuery(internal.readwise.sealedToken, { userId });
  if (saved === "inactive") return null;
  if (saved) {
    try {
      return await decryptProviderKey({
        ...saved,
        userId,
        provider: "readwise",
      });
    } catch {
      console.error("Couldn't open a saved Readwise token");
      return null;
    }
  }
  return ownerDeploymentReadwiseToken(userId, false);
}

/** Trimmed token, or a reader-facing error that never repeats it. */
export function cleanReadwiseToken(input: string): string {
  const token = input.trim();
  if (token.length < 20 || token.length > 200 || /\s/.test(token))
    throw new ConvexError(
      "That doesn't look like a Readwise access token. Copy it again from readwise.io/access_token.",
    );
  return token;
}

/** Checks the token with Readwise; 204 means it is valid. */
export async function validateReadwiseToken(token: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://readwise.io/api/v2/auth/", {
      headers: { Authorization: `Token ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ConvexError(
      "Couldn't reach Readwise to check the token. Try again.",
    );
  }
  await response.body?.cancel().catch(() => {});
  if (response.status === 204) return;
  if (response.status === 401 || response.status === 403)
    throw new ConvexError(
      "Readwise didn't accept that token. Check it's current and copied in full.",
    );
  if (response.status === 429)
    throw new ConvexError(
      "Readwise is limiting requests right now. Try again in a minute.",
    );
  throw new ConvexError(
    `Readwise couldn't check the token (error ${response.status}). Try again.`,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ReadwiseRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(
      `Reader rate limit reached; retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
    );
  }
}

async function request(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!token) throw new Error("Readwise isn't connected");
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (response.status === 429) {
      const wait = Number(response.headers.get("Retry-After") ?? "5");
      const retryAfterMs =
        (Number.isFinite(wait) ? Math.max(0, wait) : 5) * 1000 + 250;
      // Long waits belong in the durable scheduler, not inside a time-limited action.
      if (attempt >= MAX_RETRIES || retryAfterMs > 60_250)
        throw new ReadwiseRateLimitError(retryAfterMs);
      await sleep(retryAfterMs);
      continue;
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Readwise ${init.method ?? "GET"} ${path} failed: ${response.status} ${detail.slice(0, 300)}`,
      );
    }
    return response;
  }
}

/** Fetch one bounded page. Callers persist the cursor before advancing. */
export async function listDocumentPage(
  token: string,
  params: {
    location?: ReaderLocation;
    category?: string;
    updatedAfter?: string;
    withHtmlContent?: boolean;
    pageCursor?: string;
    limit?: number;
  },
): Promise<{ results: ReaderDocument[]; nextPageCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.location) query.set("location", params.location);
  if (params.category) query.set("category", params.category);
  if (params.updatedAfter) query.set("updatedAfter", params.updatedAfter);
  if (params.withHtmlContent) query.set("withHtmlContent", "true");
  if (params.pageCursor) query.set("pageCursor", params.pageCursor);
  query.set("limit", String(params.limit ?? 5));
  const response = await request(token, `/list/?${query}`);
  return (await response.json()) as {
    results: ReaderDocument[];
    nextPageCursor: string | null;
  };
}

/** Creates a highlight on a Reader document. The passage must match its text. */
export async function createHighlight(
  token: string,
  parentId: string,
  text: string,
): Promise<string> {
  const response = await request(token, "/save/", {
    method: "POST",
    body: JSON.stringify({
      parent_id: parentId,
      content: text,
      saved_using: "Marginalia",
    }),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

export async function deleteDocument(token: string, id: string): Promise<void> {
  await request(token, `/delete/${id}/`, { method: "DELETE" });
}

export async function moveDocument(
  token: string,
  id: string,
  location: ReaderLocation,
): Promise<void> {
  await request(token, `/update/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ location }),
  });
}
