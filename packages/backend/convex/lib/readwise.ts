// Readwise Reader API client: https://readwise.io/reader_api
// Rate limits are per token: 20/min for list and delete, 50/min for save and update.

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = readwiseToken();
  if (!token) throw new Error("READWISE_TOKEN is not set");
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const wait = Number(response.headers.get("Retry-After") ?? "5");
      await sleep((Number.isFinite(wait) ? wait : 5) * 1000 + 250);
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

/** Pages through the document list, newest updates included, up to `maxPages`. */
export async function* listDocuments(params: {
  location?: ReaderLocation;
  category?: string;
  updatedAfter?: string;
  withHtmlContent?: boolean;
  maxPages?: number;
}): AsyncGenerator<ReaderDocument> {
  let cursor: string | null = null;
  for (let page = 0; page < (params.maxPages ?? 10); page++) {
    const query = new URLSearchParams();
    if (params.location) query.set("location", params.location);
    if (params.category) query.set("category", params.category);
    if (params.updatedAfter) query.set("updatedAfter", params.updatedAfter);
    if (params.withHtmlContent) query.set("withHtmlContent", "true");
    if (cursor) query.set("pageCursor", cursor);
    const response = await request(`/list/?${query}`);
    const body = (await response.json()) as {
      results: ReaderDocument[];
      nextPageCursor: string | null;
    };
    yield* body.results;
    cursor = body.nextPageCursor;
    if (!cursor) return;
  }
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
