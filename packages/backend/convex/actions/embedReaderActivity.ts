"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { embedText } from "../lib/aiModels";

// Highlights and Ask / Explain / Simplify threads are embedded so the
// marginalia for future articles can recall what the reader cared about.

export const embedHighlight = internalAction({
  args: { highlightId: v.id("highlights") },
  handler: async (ctx, args) => {
    const row: Doc<"highlights"> | null = await ctx.runQuery(
      internal.highlights.getByIdInternal,
      args,
    );
    if (!row) return;
    try {
      const embedding = await embedText(row.text.slice(0, 8000));
      await ctx.runMutation(internal.highlights.setEmbedding, {
        ...args,
        embedding,
      });
    } catch (error) {
      console.error(`Failed to embed highlight ${args.highlightId}:`, error);
    }
  },
});

export const embedThread = internalAction({
  args: { threadId: v.id("companionThreads") },
  handler: async (ctx, args) => {
    const row: Doc<"companionThreads"> | null = await ctx.runQuery(
      internal.companionThreads.getByIdInternal,
      args,
    );
    if (!row) return;
    const firstAnswer =
      row.turns.find((t) => t.role === "assistant")?.content ?? "";
    const followUps = row.turns
      .filter((t) => t.role === "user")
      .map((t) => t.content);
    const text = [row.selection, row.question, ...followUps, firstAnswer]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 8000);
    try {
      const embedding = await embedText(text);
      await ctx.runMutation(internal.companionThreads.setEmbedding, {
        ...args,
        embedding,
      });
    } catch (error) {
      console.error(
        `Failed to embed companion thread ${args.threadId}:`,
        error,
      );
    }
  },
});

export const embedImpression = internalAction({
  args: { impressionId: v.id("impressions"), updatedAt: v.number() },
  handler: async (ctx, args) => {
    const row: Doc<"impressions"> | null = await ctx.runQuery(
      internal.impressions.getByIdInternal,
      { impressionId: args.impressionId },
    );
    // A newer edit has its own embedding scheduled
    if (!row || row.updatedAt !== args.updatedAt) return;
    const article: Doc<"articles"> | null = await ctx.runQuery(
      internal.articles.getByIdInternal,
      { articleId: row.articleId },
    );
    const labels = ["Not for me", "Meh", "Fine", "Good", "Loved it"];
    const text = [
      article?.title,
      row.rating ? `Rated: ${labels[row.rating - 1]}` : "",
      row.tags.join(", "),
      row.note,
    ]
      .filter(Boolean)
      .join("\n");
    if (!text.trim()) return;
    try {
      const embedding = await embedText(text.slice(0, 8000));
      await ctx.runMutation(internal.impressions.setEmbedding, {
        impressionId: args.impressionId,
        embedding,
      });
    } catch (error) {
      console.error(`Failed to embed impression ${args.impressionId}:`, error);
    }
  },
});

/** One-off: embeds highlights and threads saved before embeddings existed. */
export const backfill = internalAction({
  args: {},
  handler: async (ctx): Promise<{ highlights: number; threads: number }> => {
    const highlights: Id<"highlights">[] = await ctx.runQuery(
      internal.highlights.listUnembedded,
      {},
    );
    const threads: Id<"companionThreads">[] = await ctx.runQuery(
      internal.companionThreads.listUnembedded,
      {},
    );
    for (const highlightId of highlights) {
      await ctx.runAction(internal.actions.embedReaderActivity.embedHighlight, {
        highlightId,
      });
    }
    for (const threadId of threads) {
      await ctx.runAction(internal.actions.embedReaderActivity.embedThread, {
        threadId,
      });
    }
    return { highlights: highlights.length, threads: threads.length };
  },
});
