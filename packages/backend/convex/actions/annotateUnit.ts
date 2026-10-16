"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { generateObjectWithFallback } from "../lib/aiModels";
import { annotationBudget, gateNotes } from "../lib/annotationGate";
import { buildMarginaliaContext } from "../lib/marginaliaContext";
import { loadReaderAI } from "../lib/router";
import {
  type AnnotationResult,
  annotationCandidateSchema,
  assignTags,
  buildUserPrompt,
  resolveNotePath,
  SYSTEM_PROMPT,
} from "./generateAnnotations";

// A long outline is shown around the unit being read, not in full
const OUTLINE_WINDOW = 40;

/**
 * What the model is told about the book around the unit it reads (D-DES-054):
 * the outline near it and any summary, as background. The unit's own text is
 * the only text it may anchor a note to.
 */
export function bookBackground(input: {
  bookTitle: string;
  unitIndex: number;
  outline: readonly { title: string }[];
  summary: { thesis?: string; gist: string } | null;
}): string {
  const from = Math.max(0, input.unitIndex - OUTLINE_WINDOW);
  const to = Math.min(input.outline.length, input.unitIndex + OUTLINE_WINDOW);
  const lines = input.outline
    .slice(from, to)
    .map((unit, i) => `${from + i + 1}. ${unit.title}`);
  return [
    "## This text is one part of a longer work",
    `It is part ${input.unitIndex + 1} of ${input.outline.length} of "${input.bookTitle}". Only this part is given above; write notes about this part and anchor them only to its text. The thesis and gist you return describe the whole work as far as its outline and this part show.`,
    input.summary
      ? `What is known of the work so far: ${[input.summary.thesis, input.summary.gist].filter(Boolean).join(" ")}`
      : "",
    "Outline:",
    ...(from > 0 ? ["…"] : []),
    ...lines,
    ...(to < input.outline.length ? ["…"] : []),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Writes the margin of one reading unit, from that unit and the book's outline. */
export const generate = internalAction({
  args: { articleId: v.id("articles"), unitIndex: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const found: {
      article: Doc<"articles">;
      unit: Doc<"bookUnits">;
    } | null = await ctx.runQuery(internal.books.unitForAnnotation, args);
    if (!found?.article.bookOutline) return;
    const { article, unit } = found;
    const userId = article.userId;
    const setStatus = async (
      status: "annotated" | "failed" | "skipped" | "deferred",
      skipReason?: "no_provider",
    ): Promise<void> => {
      await ctx.runMutation(internal.books.setUnitStatus, {
        userId,
        articleId: article._id,
        unitIndex: unit.index,
        status,
        skipReason,
      });
    };

    if (unit.annotationStatus === "annotated") return;
    if (unit.wordCount < 100) return setStatus("skipped");
    const ai = await loadReaderAI(ctx, userId);
    const targets = ai.chain("annotations");
    if (!targets.length) {
      console.warn(
        `Skipped marginalia for unit ${unit.index} of ${article._id}: no AI provider key`,
      );
      return setStatus("skipped", "no_provider");
    }

    try {
      const { articleText, contextText, vaultPaths, libraryCandidates } =
        await buildMarginaliaContext(
          ctx,
          {
            ...article,
            title: `${article.title}: ${unit.title}`,
            content: unit.content,
            wordCount: unit.wordCount,
          },
          ai.embedder(),
        );
      const [vocabulary, summary]: [
        { name: string; key: string; aliases: string[] }[],
        { thesis?: string; gist: string } | null,
      ] = await Promise.all([
        ctx.runQuery(internal.tags.vocabulary, { userId }),
        ctx.runQuery(internal.summaries.forCompanion, {
          articleId: article._id,
          userId,
        }),
      ]);
      const { object, modelId } =
        await generateObjectWithFallback<AnnotationResult>({
          schema: annotationCandidateSchema,
          system: SYSTEM_PROMPT,
          prompt: buildUserPrompt({
            title: `${article.title}: ${unit.title}`,
            author: article.author,
            articleText,
            truncated: unit.content.length > articleText.length,
            contextText: `${contextText}\n\n${bookBackground({
              bookTitle: article.title,
              unitIndex: unit.index,
              outline: found.article.bookOutline ?? [],
              summary,
            })}`,
            wordCount: unit.wordCount,
            vocabulary: vocabulary.map((tag) => tag.name),
          }),
          targets,
          onFailure: ai.noteFailure,
        });

      const { notes, rejected } = gateNotes(object.annotations, {
        content: unit.content,
        offeredArticleIds: new Set(libraryCandidates.map((c) => c.id)),
        cap: annotationBudget(unit.wordCount).cap,
      });
      await ctx.runMutation(internal.annotations.replaceForUnit, {
        userId,
        articleId: article._id,
        unitIndex: unit.index,
        notes: notes.map((a) => ({
          type: a.type,
          fallacyName: a.fallacyName,
          // SAFETY: gateNotes kept it only because it is the id of a library article offered in this prompt.
          articleRefId: a.articleRefId as typeof article._id | undefined,
          anchorText: a.anchorText,
          anchorStartOffset: a.startOffset,
          anchorEndOffset: a.startOffset + a.anchorText.length,
          content: a.content,
          notePath: resolveNotePath(a.notePath, vaultPaths),
          noteExcerpt: a.noteExcerpt,
          relevanceScore: a.relevanceScore,
        })),
      });

      // The book's one point and tags come from the first unit and its outline
      if (unit.index === 0) {
        if (object.thesis?.trim() && object.gist?.trim())
          await ctx.runMutation(internal.summaries.saveOverview, {
            userId,
            articleId: article._id,
            thesis: object.thesis,
            gist: object.gist,
            model: modelId,
          });
        await assignTags(ctx, {
          userId,
          articleId: article._id,
          tags: object.tags,
          vocabulary,
          embedder: ai.embedder(),
        });
      }
      console.log(
        `Annotated unit ${unit.index + 1} of "${article.title}" with ${modelId}: ${notes.length} of ${object.annotations.length} candidates kept`,
        rejected,
      );
    } catch (error) {
      console.error(
        `Annotation failed for unit ${unit.index} of ${article._id}:`,
        error,
      );
      await setStatus("failed");
    }
  },
});
