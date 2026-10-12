// Readwise Reader API client: https://readwise.io/reader_api
// Rate limits are per token: 20/min for list and delete, 50/min for save and update.

import { DEFAULT_USER_ID } from "./constants";

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

export function readwiseToken(): string | undefined {
  return process.env.READWISE_TOKEN?.trim() || undefined;
}

/**
 * The deployment's Readwise token belongs to the owner, so it is only used for
 * the owner's library. Other readers bring their own token in a later phase.
 */
export function readwiseTokenFor(userId: string): string | undefined {
  return userId === DEFAULT_USER_ID ? readwiseToken() : undefined;
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
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = readwiseToken();
  if (!token) throw new Error("READWISE_TOKEN is not set");
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
export async function listDocumentPage(params: {
  location?: ReaderLocation;
  category?: string;
  updatedAfter?: string;
  withHtmlContent?: boolean;
  pageCursor?: string;
  limit?: number;
}): Promise<{ results: ReaderDocument[]; nextPageCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.location) query.set("location", params.location);
  if (params.category) query.set("category", params.category);
  if (params.updatedAfter) query.set("updatedAfter", params.updatedAfter);
  if (params.withHtmlContent) query.set("withHtmlContent", "true");
  if (params.pageCursor) query.set("pageCursor", params.pageCursor);
  query.set("limit", String(params.limit ?? 5));
  const response = await request(`/list/?${query}`);
  return (await response.json()) as {
    results: ReaderDocument[];
    nextPageCursor: string | null;
  };
}

/** Creates a highlight on a Reader document. The passage must match its text. */
export async function createHighlight(
  parentId: string,
  text: string,
): Promise<string> {
  const response = await request("/save/", {
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

export async function deleteDocument(id: string): Promise<void> {
  await request(`/delete/${id}/`, { method: "DELETE" });
}

export async function moveDocument(
  id: string,
  location: ReaderLocation,
): Promise<void> {
  await request(`/update/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ location }),
  });
}
