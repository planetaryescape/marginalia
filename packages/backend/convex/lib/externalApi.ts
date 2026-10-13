import { z } from "zod";

// Requests over this are refused before parsing; stored HTML is capped again
// after slimming (lib/ingest.ts)
export const MAX_ARTICLE_REQUEST_BYTES = 2_000_000;

/**
 * An article another app sends in with its HTML already extracted. The
 * sender's `externalId` makes the request idempotent: sending the same ID
 * again returns the article it created the first time.
 */
export const externalArticleSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  html: z.string().min(1).max(MAX_ARTICLE_REQUEST_BYTES),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional(),
  author: z.string().trim().max(200).optional(),
  publishedAt: z.number().int().positive().optional(),
});

export type ExternalArticle = z.infer<typeof externalArticleSchema>;

/** Kept apart from RSS GUIDs and URLs in the same `by_user_guid` index. */
export function externalGuid(externalId: string): string {
  return `external:${externalId}`;
}

/** The article ID in `/api/v1/articles/<id>/highlights`, or null. */
export function highlightsPathArticleId(pathname: string): string | null {
  const match = /^\/api\/v1\/articles\/([^/]+)\/highlights\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/.exec(header ?? "");
  return match ? match[1] : null;
}
