"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { externalGuid } from "../lib/externalApi";
import { articleFitsStorage, prepareImportContent } from "../lib/importContent";

export type IngestExternalResult =
  | { ok: true; articleId: Id<"articles">; created: boolean }
  | { ok: false; reason: "too_large" };

/** Stores an article another app sent, or finds the one it sent before. */
export const ingest = internalAction({
  args: {
    userId: v.string(),
    externalId: v.string(),
    title: v.string(),
    html: v.string(),
    url: v.optional(v.string()),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<IngestExternalResult> => {
    const existing: Id<"articles"> | null = await ctx.runQuery(
      internal.externalApi.articleByExternalId,
      { userId: args.userId, externalId: args.externalId },
    );
    if (existing) return { ok: true, articleId: existing, created: false };
    const content = prepareImportContent(args.html);
    if (!content) return { ok: false, reason: "too_large" };
    const row = {
      userId: args.userId,
      url: (args.url ?? "").toWellFormed(),
      guid: externalGuid(args.externalId),
      title: (args.title || args.url || "Untitled").toWellFormed(),
      ...content,
      author: args.author?.toWellFormed(),
      publishedAt: args.publishedAt,
    };
    if (!articleFitsStorage(row)) return { ok: false, reason: "too_large" };
    const result = await ctx.runMutation(
      internal.articles.upsertExtracted,
      row,
    );
    return { ok: true, ...result };
  },
});
