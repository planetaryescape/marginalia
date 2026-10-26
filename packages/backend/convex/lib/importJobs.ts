import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { libraryIsActive } from "../access";
import { sha256Hex } from "./tokens";

export const INDEX_MODEL = "text-embedding-3-small/1536";
export const INDEX_LEASE_MS = 60_000;
export const EXTRACTION_LEASE_MS = 45_000;
export const EXTRACTION_TIMEOUT_MS = 20_000;
export const MAX_IMPORT_ATTEMPTS = 3;
export const MAX_IMPORT_CONCURRENCY = 2;

export async function importLibraryActive(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  if (!(await libraryIsActive(ctx, userId))) return false;
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
    .first();
  return reader?.deletingAt === undefined;
}

export function libraryIndexText(article: Doc<"articles">) {
  return (
    article.bookUnitCount !== undefined
      ? [
          article.title,
          ...(article.bookOutline ?? []).map((unit) => unit.title),
        ].join("\n")
      : (article.content ?? "")
  )
    .slice(0, 8000)
    .replace(/[\uD800-\uDBFF]$/, "");
}

export function articleContentHash(article: Doc<"articles">) {
  return sha256Hex(
    JSON.stringify([
      article.title,
      article.content,
      article.contentHtml,
      article.bookOutline,
    ]),
  );
}

/** Permanent input/auth failures never start an automatic paid retry loop. */
export function retryableImportError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      error.name === "FetchError" ||
      error instanceof TypeError ||
      /(?:Provider returned |HTTP |Request failed with error code )(?:408|429|5\d\d)\b/.test(
        error.message,
      ))
  );
}
