"use node";
import type { FunctionArgs } from "convex/server";
import { v } from "convex/values";
import type { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { generateObjectWithFallback } from "../lib/aiModels";
import { alreadySaid, buildAlongsidePrompt } from "../lib/alongsidePrompt";
import { annotationBudget, gateNotes } from "../lib/annotationGate";
import { buildMarginaliaContext } from "../lib/marginaliaContext";
import { hashSources } from "../lib/marginaliaFingerprint";
import { MAX_ARTICLE_CHARS, sectionRanges } from "../lib/readingSections";
import { loadReaderAI } from "../lib/router";
import {
  annotationCandidateSchema,
  resolveNotePath,
  SYSTEM_PROMPT,
} from "./generateAnnotations";

type SettleNotes = FunctionArgs<typeof internal.alongside.settle>["notes"];

// A pass writes notes and nothing else; the thesis, tags and reflection belong to the import pass
const passSchema = annotationCandidateSchema.pick({ annotations: true });

/**
 * Annotates the section ahead of the reader (rung 2f), under a claim taken by
 * alongside.requestAhead. This is the precise gate's home: the section's
 * context is retrieved (embeddings only), and the model is called only if the
 * stored items it drew on differ from the last pass of this section.
 */
export const pass = internalAction({
  args: {
    articleId: v.id("articles"),
    sectionIndex: v.number(),
    claim: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const input = await ctx.runQuery(internal.alongside.passInput, args);
    // The claim was replaced or the article is gone: another run owns this section
    if (!input) return;
    const { article, row, said } = input;
    const userId = article.userId;
    const label = `"${article.title}" (${article._id}) section ${args.sectionIndex + 1}`;
    const settleWith = (
      outcome: "done" | "skipped" | "failed",
      extra: { contextHash?: string; notes?: SettleNotes } = {},
    ): Promise<number> =>
      ctx.runMutation(internal.alongside.settle, {
        userId,
        articleId: args.articleId,
        sectionIndex: args.sectionIndex,
        claim: args.claim,
        outcome,
        ...extra,
      });

    const owns = () =>
      ctx.runMutation(internal.alongside.renew, {
        userId,
        articleId: args.articleId,
        sectionIndex: args.sectionIndex,
        claim: args.claim,
      });

    try {
      // The claim may have been replaced while this job waited to start
      if (!(await owns())) return;
      const content = article.content ?? "";
      const section = sectionRanges(content.slice(0, MAX_ARTICLE_CHARS))[
        args.sectionIndex
      ];
      if (!section) {
        console.log(`Skipped reading pass for ${label}: no such section`);
        await settleWith("skipped");
        return;
      }
      const ai = await loadReaderAI(ctx, userId);
      const targets = ai.chain("annotations");
      if (!targets.length) {
        console.log(`Skipped reading pass for ${label}: no AI provider key`);
        await settleWith("skipped");
        return;
      }

      const words = section.text.split(/\s+/).length;
      const {
        articleText,
        contextText,
        vaultPaths,
        libraryCandidates,
        sources,
      } = await buildMarginaliaContext(
        ctx,
        { ...article, content: section.text, wordCount: words },
        ai.embedder(),
      );
      const contextHash = await hashSources(sources);
      if (row.contextHash === contextHash) {
        console.log(
          `Skipped reading pass for ${label}: the material it would draw on is unchanged (${sources.length} items)`,
        );
        await settleWith("skipped", { contextHash });
        return;
      }
      // A section's first pass is compared with what the import pass drew on:
      // only something it retrieved that the import did not see is worth a call.
      // An article annotated before this was recorded has no baseline, so any
      // retrieved material counts.
      if (!row.contextHash) {
        const known = new Set(article.marginaliaSources);
        const fresh = article.marginaliaSources
          ? sources.filter((source) => !known.has(source))
          : sources;
        if (!fresh.length) {
          console.log(
            `Skipped reading pass for ${label}: nothing it retrieved is new since the import pass (${sources.length} items)`,
          );
          await settleWith("skipped", { contextHash });
          return;
        }
      }

      const sections = sectionRanges(content.slice(0, MAX_ARTICLE_CHARS));
      // Retrieval can be slow: if another tab has taken the section since, stop
      if (!(await owns())) {
        console.log(
          `Stopped reading pass for ${label}: its claim was replaced`,
        );
        return;
      }
      const { object, modelId } = await generateObjectWithFallback<
        z.infer<typeof passSchema>
      >({
        schema: passSchema,
        system: SYSTEM_PROMPT,
        prompt: buildAlongsidePrompt({
          title: article.title,
          author: article.author,
          sectionIndex: args.sectionIndex,
          sectionCount: sections.length,
          sectionText: articleText,
          outline: sections.map((s) =>
            s.text.split(/\s+/).slice(0, 8).join(" "),
          ),
          contextText,
          said: alreadySaid(said, section),
          wordCount: words,
        }),
        targets,
        onFailure: ai.noteFailure,
      });

      const { notes, rejected } = gateNotes(object.annotations, {
        content: section.text,
        offeredArticleIds: new Set(libraryCandidates.map((c) => c.id)),
        cap: annotationBudget(words).cap,
      });
      const added = await settleWith("done", {
        contextHash,
        notes: notes.map((a) => ({
          type: a.type,
          fallacyName: a.fallacyName,
          // SAFETY: gateNotes kept it only because it is the id of a library article offered in this prompt.
          articleRefId: a.articleRefId as Id<"articles"> | undefined,
          anchorText: a.anchorText,
          // Offsets are into the whole article, as the import pass writes them
          anchorStartOffset: section.start + a.startOffset,
          anchorEndOffset: section.start + a.startOffset + a.anchorText.length,
          content: a.content,
          notePath: resolveNotePath(a.notePath, vaultPaths),
          noteExcerpt: a.noteExcerpt,
          relevanceScore: a.relevanceScore,
        })),
      });
      console.log(
        `Read alongside ${label} with ${modelId}: ${added} added of ${object.annotations.length} candidates`,
        rejected,
      );
    } catch (error) {
      console.error(`Reading pass failed for ${label}:`, error);
      await settleWith("failed").catch(() => {});
    }
  },
});
