import { defineTable } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { libraryIsActive } from "../access";
import { CURRENT_ANNOTATION_VERSION } from "./annotationGate";
import { computeFingerprint } from "./marginaliaFingerprint";
import { modelChain } from "./providers";
import { readerProviders, savedCredentials, settingsRow } from "./readerAI";
import { sha256Hex } from "./tokens";

// Longer than Convex's maximum action runtime. Recovery is reader initiated,
// never a watchdog that can spend again after an ambiguous provider response.
export const MANUAL_ANNOTATION_LEASE_MS = 20 * 60_000;
export const MANUAL_ANNOTATION_ATTEMPTS = 3;
export const annotationGeneration = v.object({ run: v.number() });
export const manualAnnotationState = defineTable({
  userId: v.string(),
  articleId: v.id("articles"),
  run: v.number(),
  input: v.string(),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("complete"),
    v.literal("failed"),
  ),
  attempts: v.number(),
  leaseUntil: v.number(),
  published: v.boolean(),
})
  .index("by_articleId", ["articleId"])
  .index("by_userId", ["userId"]);

type Db = Pick<QueryCtx, "db">;
export const manualState = (ctx: Db, articleId: Id<"articles">) =>
  ctx.db
    .query("manualAnnotationState")
    .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
    .unique();

const SOURCE_FIELDS = [
  "userId",
  "guid",
  "url",
  "feedId",
  "title",
  "author",
  "publishedAt",
  "content",
  "contentHtml",
  "wordCount",
  "extractionStatus",
  "bookUnitCount",
] as const;

/** Full source, including the outline input, not a prefix of the provider window. */
export function annotationSource(article: Doc<"articles">) {
  return JSON.stringify(SOURCE_FIELDS.map((field) => article[field]));
}

export async function annotationInput(ctx: Db, article: Doc<"articles">) {
  const [fingerprint, settings, credentials, routing, connection] =
    await Promise.all([
      computeFingerprint(ctx, article.userId),
      settingsRow(ctx, article.userId),
      savedCredentials(ctx, article.userId),
      readerProviders(ctx, article.userId),
      ctx.db
        .query("chatgptConnections")
        .withIndex("by_userId", (q) => q.eq("userId", article.userId))
        .unique(),
    ]);
  // passAt is an observation time, not semantic input. Consume the unchanged
  // currentFingerprint contract, including future additive signal fields.
  const { passAt: _time, ...signals } = fingerprint;
  return sha256Hex(
    JSON.stringify([
      "manual-annotations-v1",
      CURRENT_ANNOTATION_VERSION,
      annotationSource(article),
      article.manualAnnotationRevision ?? 0,
      signals,
      settings?._id,
      settings?.annotationModel,
      settings?.manualAnnotationModelRevision ?? 0,
      modelChain(
        settings?.annotationModel,
        "annotations",
        routing.providers,
        routing.chatgptModels,
      ).map((model) => [model.provider, model.id]),
      credentials
        .map((row) => [row._id, row.provider, row.ciphertext, row.iv])
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

export async function annotationSourceActive(
  ctx: Db,
  article: Doc<"articles">,
) {
  // Subscription lifetime controls polling, not access to retained articles.
  // The caller loads the current article; deletion/transfer and exact source
  // changes are fenced separately from this library-lifetime check.
  return libraryIsActive(ctx, article.userId);
}

/** Tokenless pre-upgrade writers are rejected once this article is adopted. */
export async function annotationPublicationAllowed(
  ctx: Db,
  article: Doc<"articles">,
  generation?: { run: number },
) {
  if (!(await annotationSourceActive(ctx, article))) return false;
  const row = await manualState(ctx, article._id);
  if (!row) return generation === undefined;
  if (
    !generation ||
    row.userId !== article.userId ||
    row.run !== generation.run ||
    row.status !== "running" ||
    row.leaseUntil <= Date.now()
  )
    return false;
  return row.input === (await annotationInput(ctx, article));
}

/** Main registers these source/model revision hooks through its shared boundary.
 * Revisions, rather than wall time, distinguish A→B→A and same-time edits. */
export async function annotationSourceChanged(
  ctx: MutationCtx,
  before: Doc<"articles"> | null,
  after: Doc<"articles"> | null,
) {
  // Unrelated article writes must not serialize/copy a near-limit body twice.
  if (
    before &&
    after &&
    SOURCE_FIELDS.some((field) => before[field] !== after[field])
  )
    await ctx.db.patch(after._id, {
      manualAnnotationRevision: (before.manualAnnotationRevision ?? 0) + 1,
    });
  if (before && !after) {
    const row = await manualState(ctx, before._id);
    if (row) await ctx.db.delete(row._id);
  }
}

export async function annotationModelChanged(
  ctx: MutationCtx,
  before: Doc<"userSettings"> | null,
  after: Doc<"userSettings"> | null,
) {
  if (after && before?.annotationModel !== after.annotationModel)
    await ctx.db.patch(after._id, {
      manualAnnotationModelRevision:
        (before?.manualAnnotationModelRevision ?? 0) + 1,
    });
}

/** Called inside the existing account metadata step; never adds a numeric step. */
export async function purgeManualAnnotations(ctx: MutationCtx, userId: string) {
  const rows = await ctx.db
    .query("manualAnnotationState")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(100);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}
