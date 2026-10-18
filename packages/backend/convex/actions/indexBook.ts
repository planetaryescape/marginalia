"use node";
import { v } from "convex/values";
import type { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { generateObjectWithFallback } from "../lib/aiModels";
import {
  bookOverviewSchema,
  chunkPassages,
  EMBED_BATCH,
  GROUP_SYSTEM,
  groupPrompt,
  groupSummarySchema,
  inBatches,
  MIN_SUMMARY_WORDS,
  OVERVIEW_SYSTEM,
  overviewPrompt,
  passageEmbedText,
  reduceSpans,
  SUMMARY_SYSTEM,
  spansOf,
  summaryPrompt,
  unitHeading,
  unitSummarySchema,
  WRITE_BATCH,
} from "../lib/bookIndex";
import { embedTexts } from "../lib/embeddings";
import { isAuthFailure } from "../lib/providers";
import { loadReaderAI } from "../lib/router";

const SUMMARY_MAX_CHARS = 400;
const unitArgs = {
  articleId: v.id("articles"),
  unitIndex: v.number(),
  claim: v.number(),
  // Optional only for already queued, pre-upgrade actions.
  userId: v.optional(v.string()),
  runId: v.optional(v.number()),
};

/**
 * Writes one unit's short summary (D-DES-054): the unit's own text and the
 * book's title go to the model, never the rest of the book.
 */
export const summarizeUnit = internalAction({
  args: unitArgs,
  handler: async (ctx, args): Promise<void> => {
    const found = await ctx.runQuery(internal.bookIndex.unitForJob, {
      ...args,
      stage: "summary",
    });
    if (!found) return;
    const { userId, unit } = found;
    const finish = (fields: {
      status: "done" | "skipped" | "failed";
      refund?: boolean;
      summary?: string;
      model?: string;
    }) =>
      ctx.runMutation(internal.bookIndex.completeJob, {
        userId,
        articleId: args.articleId,
        stage: "summary",
        unitIndex: args.unitIndex,
        claim: args.claim,
        runId: args.runId,
        ...fields,
      });
    if (unit.wordCount < MIN_SUMMARY_WORDS) {
      await finish({ status: "skipped" });
      return;
    }
    const ai = await loadReaderAI(ctx, userId);
    const targets = ai.chain("annotations");
    if (!targets.length) {
      // No try is spent; the run pauses until a usable key is saved
      await finish({ status: "failed", refund: true });
      await ctx.runMutation(internal.bookIndex.pauseIndex, {
        userId,
        articleId: args.articleId,
        reason: "unusable_key",
        stage: "summary",
        runId: args.runId,
        claim: args.claim,
        unitIndex: args.unitIndex,
      });
      return;
    }
    try {
      const { object, modelId } = await generateObjectWithFallback<
        z.infer<typeof unitSummarySchema>
      >({
        schema: unitSummarySchema,
        system: SUMMARY_SYSTEM,
        prompt: summaryPrompt({
          bookTitle: found.bookTitle,
          unitTitle: unit.title,
          chapter: unit.chapter,
          unitNumber: unit.index + 1,
          unitCount: found.unitCount,
          text: unit.content,
        }),
        targets,
        maxOutputTokens: 300,
        onFailure: ai.noteFailure,
      });
      const summary = object.summary.trim().slice(0, SUMMARY_MAX_CHARS);
      await finish(
        summary
          ? { status: "done", summary, model: modelId }
          : { status: "failed" },
      );
    } catch (error) {
      console.error(
        `Summary failed for unit ${unit.index} of ${args.articleId}:`,
        error,
      );
      if (isAuthFailure(error)) {
        // The key is refused: no try is spent, and the run waits for a new one
        await finish({ status: "failed", refund: true });
        await ctx.runMutation(internal.bookIndex.pauseIndex, {
          userId,
          articleId: args.articleId,
          reason: "unusable_key",
          stage: "summary",
          runId: args.runId,
          claim: args.claim,
          unitIndex: args.unitIndex,
        });
        return;
      }
      await finish({ status: "failed" });
    }
  },
});

/**
 * Writes the book's one point and short summary from its section summaries.
 * A book whose summaries fit one call is written in that call; a longer one is
 * reduced first, runs of parts summarised and those summaries standing in for
 * them, so the last part counts as much as the first.
 */
export const writeOverview = internalAction({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    runId: v.number(),
    claim: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const retry = () => ctx.runMutation(internal.bookIndex.pointFailed, args);
    try {
      const book = await ctx.runQuery(
        internal.bookIndex.summariesForPoint,
        args,
      );
      if (!book || book.userId !== args.userId) return;
      if (!book.lines.some((line) => line.summary)) {
        await ctx.runMutation(internal.bookIndex.pointWritten, args);
        return;
      }
      const ai = await loadReaderAI(ctx, args.userId);
      const targets = ai.chain("annotations");
      if (!targets.length) {
        // A key that is saved but won't open: pause rather than retry
        await ctx.runMutation(internal.bookIndex.pauseIndex, {
          userId: args.userId,
          articleId: args.articleId,
          reason: "unusable_key",
          stage: "point",
          runId: args.runId,
          claim: args.claim,
        });
        return;
      }
      const spans = await reduceSpans(
        spansOf(book.lines),
        async (group) =>
          (
            await generateObjectWithFallback<
              z.infer<typeof groupSummarySchema>
            >({
              schema: groupSummarySchema,
              system: GROUP_SYSTEM,
              prompt: groupPrompt(book.title, group),
              targets,
              maxOutputTokens: 200,
              onFailure: ai.noteFailure,
            })
          ).object.summary,
      );
      const { object, modelId } = await generateObjectWithFallback<
        z.infer<typeof bookOverviewSchema>
      >({
        schema: bookOverviewSchema,
        system: OVERVIEW_SYSTEM,
        prompt: overviewPrompt(book.title, spans),
        targets,
        maxOutputTokens: 400,
        onFailure: ai.noteFailure,
      });
      await ctx.runMutation(internal.bookIndex.pointWritten, {
        ...args,
        overview: { thesis: object.thesis, gist: object.gist, model: modelId },
      });
    } catch (error) {
      console.error(`Book overview failed for ${args.articleId}:`, error);
      if (isAuthFailure(error)) {
        await ctx.runMutation(internal.bookIndex.pauseIndex, {
          userId: args.userId,
          articleId: args.articleId,
          reason: "unusable_key",
          stage: "point",
          runId: args.runId,
          claim: args.claim,
        });
        return;
      }
      await retry();
    }
  },
});

/**
 * Cuts one unit into passages of about 300 tokens under its heading, embeds
 * them in batches and stores them for search. Embedding comes first, so a
 * failure leaves the unit's earlier passages in place; the old ones go only
 * when the new ones are ready to be written.
 */
export const embedPassages = internalAction({
  args: unitArgs,
  handler: async (ctx, args): Promise<void> => {
    const found = await ctx.runQuery(internal.bookIndex.unitForJob, {
      ...args,
      stage: "passages",
    });
    if (!found) return;
    const { userId, unit } = found;
    const finish = (fields: {
      status: "done" | "skipped" | "failed";
      refund?: boolean;
      passageCount?: number;
    }) =>
      ctx.runMutation(internal.bookIndex.completeJob, {
        userId,
        articleId: args.articleId,
        stage: "passages",
        unitIndex: args.unitIndex,
        claim: args.claim,
        runId: args.runId,
        ...fields,
      });
    const passages = chunkPassages(
      unitHeading(found.bookTitle, unit),
      unit.content,
    );
    if (!passages.length) {
      await finish({ status: "skipped" });
      return;
    }
    const embedder = (
      await loadReaderAI(ctx, userId, { text: false })
    ).embedder();
    if (!embedder) {
      await finish({ status: "failed", refund: true });
      await ctx.runMutation(internal.bookIndex.pauseIndex, {
        userId,
        articleId: args.articleId,
        reason: "unusable_key",
        stage: "passages",
        runId: args.runId,
        claim: args.claim,
        unitIndex: args.unitIndex,
      });
      return;
    }
    try {
      const vectors: number[][] = [];
      for (const batch of inBatches(passages, EMBED_BATCH))
        vectors.push(
          ...(await embedTexts(embedder, batch.map(passageEmbedText))),
        );

      for (let more = true; more; )
        more = await ctx.runMutation(internal.bookIndex.clearPassages, {
          userId,
          articleId: args.articleId,
          unitIndex: args.unitIndex,
          claim: args.claim,
          runId: args.runId,
        });
      const rows = passages.map((passage, passageIndex) => ({
        passageIndex,
        heading: passage.heading,
        text: passage.text,
        embedding: vectors[passageIndex],
      }));
      for (const batch of inBatches(rows, WRITE_BATCH)) {
        const written = await ctx.runMutation(internal.bookIndex.addPassages, {
          userId,
          articleId: args.articleId,
          unitIndex: args.unitIndex,
          claim: args.claim,
          runId: args.runId,
          passages: batch,
        });
        // The claim was replaced: another job owns this unit now
        if (!written) return;
      }
      await finish({ status: "done", passageCount: rows.length });
    } catch (error) {
      console.error(
        `Passage embedding failed for unit ${args.unitIndex} of ${args.articleId}:`,
        error,
      );
      if (isAuthFailure(error)) {
        await finish({ status: "failed", refund: true });
        await ctx.runMutation(internal.bookIndex.pauseIndex, {
          userId,
          articleId: args.articleId,
          reason: "unusable_key",
          stage: "passages",
          runId: args.runId,
          claim: args.claim,
          unitIndex: args.unitIndex,
        });
        return;
      }
      await finish({ status: "failed" });
    }
  },
});
