import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readLegacyDocument, unitFormat } from "./articleMetadata";

export { unitFormat } from "./articleMetadata";

export async function bookFormat(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  articleId: Id<"articles">,
  source: { url: string; uploadedFileName?: string; uploaded?: boolean },
  index: number,
  compactFormat?: "pdf" | "epub",
): Promise<"pdf" | "epub"> {
  if (compactFormat !== undefined) return compactFormat;
  const importId = source.url.startsWith("upload:")
    ? ctx.db.normalizeId("documentImports", source.url.slice(7))
    : null;
  if (importId) {
    const row = await ctx.db.get(importId);
    if (
      row?.userId === userId &&
      (row.articleId === articleId || row.partialArticleId === articleId)
    )
      return row.format ?? "pdf";
  }
  if (/\.epub$/i.test(source.uploadedFileName ?? "")) return "epub";
  if (
    (!source.uploadedFileName && !source.uploaded) ||
    /\.pdf$/i.test(source.uploadedFileName ?? "")
  )
    return "pdf";
  const unit = await readLegacyDocument(ctx, () =>
    ctx.db
      .query("bookUnits")
      .withIndex("by_userId_and_articleId_and_index", (q) =>
        q.eq("userId", userId).eq("articleId", articleId).eq("index", index),
      )
      .unique(),
  );
  return unit ? unitFormat(unit) : "pdf";
}
