import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

export interface BibleResourceCache {
  get(key: string): Promise<string | null>;
  put(key: string, body: string, expiresAt: number): Promise<void>;
}

export function sharedBibleCache(ctx: ActionCtx): BibleResourceCache {
  return {
    get: (key) => ctx.runQuery(internal.bibleResourceCache.get, { key }),
    put: async (key, body, expiresAt) => {
      await ctx.runMutation(internal.bibleResourceCache.put, {
        key,
        body,
        expiresAt,
      });
    },
  };
}

/** Only public HTTP responses may be shared. Unknown Vary dimensions fail closed. */
export function sharedResponseExpiry(headers: Headers, now = Date.now()) {
  const control = headers.get("cache-control") ?? "";
  if (
    !/\bpublic\b/i.test(control) ||
    /\b(?:private|no-store|no-cache)\b/i.test(control)
  )
    return null;
  const vary = (headers.get("vary") ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (
    vary.some(
      (v) =>
        ![
          "accept",
          "accept-encoding",
          "accept-language",
          "x-yvp-app-key",
          "origin",
        ].includes(v),
    )
  )
    return null;
  const age = Math.max(0, Number(headers.get("age") ?? 0));
  const date = Date.parse(headers.get("date") ?? "");
  const ttl =
    /\bs-maxage\s*=\s*"?(\d+)/i.exec(control)?.[1] ??
    /\bmax-age\s*=\s*"?(\d+)/i.exec(control)?.[1];
  if (!ttl || !Number.isFinite(age)) return null;
  const lifetime = Math.min(Number(ttl) * 1000, 86400_000);
  const elapsed = Math.max(age * 1000, Number.isFinite(date) ? now - date : 0);
  return elapsed < lifetime ? now + lifetime - elapsed : null;
}

export async function cachedBibleResource({
  cache,
  key,
  load,
  validate,
  publicDomainTtl,
}: {
  cache?: BibleResourceCache;
  key: string;
  load: () => Promise<Response>;
  validate: (body: string) => void;
  publicDomainTtl?: number;
}) {
  const hit = await cache?.get(key);
  if (hit !== null && hit !== undefined) {
    validate(hit);
    return hit;
  }
  const response = await load();
  const body = await response.text();
  validate(body);
  const expiresAt = publicDomainTtl
    ? Date.now() + publicDomainTtl
    : sharedResponseExpiry(response.headers);
  if (
    cache &&
    response.status === 200 &&
    expiresAt &&
    new TextEncoder().encode(body).byteLength <= 750_000
  )
    await cache.put(key, body, expiresAt);
  return body;
}
