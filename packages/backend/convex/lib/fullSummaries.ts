import { defineTable } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { modelChain } from "./providers";
import { readerProviders, savedCredentials, settingsRow } from "./readerAI";
import { sha256Hex } from "./tokens";

export const SUMMARY_LEASE_MS = 20 * 60_000;
export const SUMMARY_ATTEMPTS = 3;
export const summaryGeneration = v.object({ run: v.number() });
export const fullSummaryState = defineTable({
  userId: v.string(),
  articleId: v.id("articles"),
  run: v.number(),
  input: v.string(),
  source: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("complete"),
    v.literal("failed"),
  ),
  attempts: v.number(),
  leaseUntil: v.number(),
  resultId: v.optional(v.id("summaries")),
})
  .index("by_articleId", ["articleId"])
  .index("by_userId", ["userId"]);

type Db = Pick<QueryCtx, "db">;
export const summaryState = (ctx: Db, articleId: Id<"articles">) =>
  ctx.db
    .query("fullSummaryState")
    .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
    .unique();

/** Independent of annotation signals and its generation domain. Existing source
 * and annotation-model revision stamps fence even same-time A→B→A edits. */
export async function summarySource(ctx: Db, article: Doc<"articles">) {
  const [settings, credentials, routing, connection] = await Promise.all([
    settingsRow(ctx, article.userId),
    savedCredentials(ctx, article.userId),
    readerProviders(ctx, article.userId),
    ctx.db
      .query("chatgptConnections")
      .withIndex("by_userId", (q) => q.eq("userId", article.userId))
      .unique(),
  ]);
  return sha256Hex(
    JSON.stringify([
      "full-summary-v1",
      article._id,
      article.userId,
      article.manualAnnotationRevision ?? 0,
      article.guid,
      article.url,
      article.feedId,
      article.title,
      article.author,
      article.publishedAt,
      article.content,
      article.contentHtml,
      article.wordCount,
      article.extractionStatus,
      article.bookUnitCount,
      settings?.annotationModel,
      settings?.manualAnnotationModelRevision ?? 0,
      modelChain(
        settings?.annotationModel,
        "annotations",
        routing.providers,
        routing.chatgptModels,
      ).map((m) => [m.provider, m.id]),
      credentials
        .map((r) => [r._id, r.provider, r.ciphertext, r.iv])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      connection
        ? [
            connection._id,
            connection.status,
            connection.planEnabled,
            connection.models,
          ]
        : null,
    ]),
  );
}

export async function purgeFullSummaries(ctx: MutationCtx, userId: string) {
  const rows = await ctx.db
    .query("fullSummaryState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(100);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

export async function deleteFullSummaryState(
  ctx: MutationCtx,
  articleId: Id<"articles">,
) {
  const row = await summaryState(ctx, articleId);
  if (row) await ctx.db.delete(row._id);
}
