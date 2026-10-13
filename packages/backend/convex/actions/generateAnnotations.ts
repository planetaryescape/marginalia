"use node";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { generateObjectWithFallback } from "../lib/aiModels";
import {
  MAX_ANNOTATIONS_PER_ARTICLE,
  MIN_RELEVANCE_SCORE,
} from "../lib/constants";
import { buildMarginaliaContext } from "../lib/marginaliaContext";
import { loadReaderAI } from "../lib/router";

type AnnotationResult = z.infer<typeof annotationCandidateSchema>;

const annotationCandidateSchema = z.object({
  annotations: z.array(
    z.object({
      type: z.enum(["cross_reference", "context", "tension", "question"]),
      anchorText: z
        .string()
        .describe(
          "Exact text from the article to anchor this annotation to. Must be a verbatim substring.",
        ),
      content: z
        .string()
        .describe("The annotation content shown to the reader."),
      notePath: z
        .string()
        .optional()
        .describe("Obsidian note file path, if this is a cross_reference."),
      noteExcerpt: z
        .string()
        .optional()
        .describe("Relevant excerpt from the referenced note."),
      relevanceScore: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "How relevant and valuable this annotation is. 0 = useless, 1 = essential.",
        ),
      reasoning: z
        .string()
        .describe(
          "Why this annotation adds value. Used for quality gate only, not shown to user.",
        ),
    }),
  ),
  reflection: z.object({
    strongestPoint: z
      .string()
      .describe("The most defensible claim or insight in the article."),
    weakestAssumption: z
      .string()
      .describe(
        "What must be true for the argument to hold, and might not be.",
      ),
    credibleCounterview: z
      .string()
      .describe(
        "A view a smart, informed person could credibly hold against this article's thesis. Not a strawman.",
      ),
    questionForYou: z
      .string()
      .describe(
        "A question for the reader grounded in the article's implications or tensions with their notes.",
      ),
  }),
});

const SYSTEM_PROMPT = `You are a study Bible annotator for a personal RSS reader. Your job is to create marginalia that enriches the reading experience — like the annotations in a good study Bible.

You will receive:
1. An article the user is about to read
2. Today's date and when the article was published
3. Notes from the user's Obsidian vault that closely match specific parts of the article, with a similarity score and where in the article they matched
4. When relevant: the user's own notes and reflections, passages they marked, and questions they asked while reading other articles, plus anything they've already done with this article

Treat items 3 and 4 as a picture of what this reader knows, cares about and has struggled with. Use them where they genuinely connect. Higher similarity is a stronger hint, not proof.

Your annotations must be SPARSE and HIGH QUALITY. Fewer excellent annotations are far better than many mediocre ones.

## Annotation Types

**cross_reference**: Connect a specific claim or idea in the article to a specific note in the user's vault. Only use when the connection is meaningful — not just vague topic overlap.

**context**: Add context that genuinely enriches understanding of a concept, person, place, or idea mentioned in the article. Only when the context adds something the reader wouldn't already know. Mind the dates: if the article is old enough that something it describes may have changed, say so rather than presenting it as current.

**tension**: Surface a genuine conflict between the article and something in the user's notes, or between the article's claims and well-known counterarguments. Must be specific, not "there are different perspectives."

**question**: A probing question grounded in one of:
- A direct tension with the user's existing notes, reflections, or something they asked about before
- An unstated assumption the article relies on
- A missing implication the article never follows through on

## Rules

1. anchorText MUST be an EXACT verbatim substring from the article. Copy-paste, do not paraphrase.
2. Anchor to sentences or meaningful clauses, not single common words.
3. cross_reference annotations MUST include a notePath and noteExcerpt from the provided notes.
4. Score relevanceScore on this scale, honestly. Anything under 0.5 is not shown.
   - 0.9–1.0: essential; it changes how the reader understands the passage
   - 0.7–0.9: a strong, specific connection or insight
   - 0.5–0.7: specific and useful; the reader would be glad to see it
   - below 0.5: generic, obvious, or a stretch
5. Do NOT annotate every paragraph. Most paragraphs should have zero annotations.
6. The reader is intelligent. Don't explain obvious things. Only annotate where you genuinely add value.
7. Aim for 3-7 annotations total. Zero is acceptable if nothing meaningful connects.

## Reflection Box

The reflection box appears after the article. Its job is to slow down premature agreement — the reader may be impressed by the author and needs intellectual brakes.

- strongestPoint: What's actually well-argued, not just what sounds good
- weakestAssumption: Something the argument depends on that could be wrong
- credibleCounterview: What would a smart, informed critic say? Not a strawman.
- questionForYou: Grounded in the reader's notes, past reflections and questions, or the article's implications. Not generic.`;

export const generateForArticle = internalAction({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await ctx.runQuery(internal.articles.getByIdInternal, {
      articleId: args.articleId,
    });

    if (!article?.content) {
      await ctx.runMutation(internal.articles.updateAnnotationStatus, {
        articleId: args.articleId,
        status: "skipped",
      });
      return;
    }

    // Skip very short articles
    if ((article.wordCount ?? 0) < 100) {
      await ctx.runMutation(internal.articles.updateAnnotationStatus, {
        articleId: args.articleId,
        status: "skipped",
      });
      return;
    }

    // Marginalia use the keys of the library that owns the article
    const ai = await loadReaderAI(ctx, article.userId);
    const targets = ai.chain("annotations");
    if (!targets.length) {
      console.warn(
        `Skipped marginalia for ${args.articleId}: no AI provider key`,
      );
      await ctx.runMutation(internal.articles.updateAnnotationStatus, {
        articleId: args.articleId,
        status: "skipped",
      });
      return;
    }

    try {
      // Step 1–2: Gather what the model should read: most of the article,
      // dates, and the reader's closely related notes, marks and questions
      const { articleText, contextText, vaultPaths } =
        await buildMarginaliaContext(
          ctx,
          { ...article, content: article.content },
          ai.embedder(),
        );

      const prompt = `## Article: "${article.title}"
${article.author ? `By: ${article.author}` : ""}

${articleText}${article.content.length > articleText.length ? "\n\n[The article continues beyond this point.]" : ""}

${contextText}

Generate annotations and a reflection for this article. Remember: quality over quantity. Only annotate where you genuinely add value.`;

      // Step 3: Generate annotations via LLM
      const { object, modelId } =
        await generateObjectWithFallback<AnnotationResult>({
          schema: annotationCandidateSchema,
          system: SYSTEM_PROMPT,
          prompt,
          targets,
          onFailure: ai.noteFailure,
        });

      // Step 4: Quality gate
      const rejected = { anchor: 0, relevance: 0, notePath: 0 };
      const validAnnotations = object.annotations
        .filter((a) => {
          // Anchor text must exist in article content
          if (!article.content!.includes(a.anchorText)) {
            rejected.anchor++;
            return false;
          }
          // Relevance threshold
          if (a.relevanceScore < MIN_RELEVANCE_SCORE) {
            rejected.relevance++;
            console.log(
              `Dropped ${a.type} (${a.relevanceScore}): ${a.content.slice(0, 160)}`,
            );
            return false;
          }
          // cross_reference must have notePath
          if (a.type === "cross_reference" && !a.notePath) {
            rejected.notePath++;
            return false;
          }
          return true;
        })
        // Deduplicate overlapping anchors (keep highest score)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .filter((a, i, arr) => {
          const startIdx = article.content!.indexOf(a.anchorText);
          const endIdx = startIdx + a.anchorText.length;
          // Check no previous annotation overlaps
          for (let j = 0; j < i; j++) {
            const prevStart = article.content!.indexOf(arr[j].anchorText);
            const prevEnd = prevStart + arr[j].anchorText.length;
            if (startIdx < prevEnd && endIdx > prevStart) {
              return false; // Overlaps with a higher-scored annotation
            }
          }
          return true;
        })
        // Hard cap
        .slice(0, MAX_ANNOTATIONS_PER_ARTICLE);

      // Build a lookup to resolve LLM note paths to actual vault paths
      const notePathLookup = new Map<string, string>();
      for (const fp of vaultPaths) {
        // Map filename (with and without .md) and full path to the real path
        notePathLookup.set(fp, fp);
        notePathLookup.set(fp.toLowerCase(), fp);
        const basename = fp.split("/").pop() || fp;
        notePathLookup.set(basename, fp);
        notePathLookup.set(basename.toLowerCase(), fp);
        notePathLookup.set(basename.replace(/\.md$/, ""), fp);
        notePathLookup.set(basename.replace(/\.md$/, "").toLowerCase(), fp);
      }

      function resolveNotePath(
        llmPath: string | undefined,
      ): string | undefined {
        if (!llmPath) return undefined;
        return (
          notePathLookup.get(llmPath) ||
          notePathLookup.get(llmPath.toLowerCase()) ||
          notePathLookup.get(llmPath.replace(/\.md$/, "")) ||
          notePathLookup.get(llmPath.replace(/\.md$/, "").toLowerCase()) ||
          llmPath // fallback to whatever the LLM said
        );
      }

      // Step 5: Persist annotations
      for (const a of validAnnotations) {
        const startOffset = article.content!.indexOf(a.anchorText);
        const resolvedPath = resolveNotePath(a.notePath);
        await ctx.runMutation(internal.annotations.insert, {
          articleId: args.articleId,
          userId: article.userId,
          type: a.type,
          anchorText: a.anchorText,
          anchorStartOffset: startOffset,
          anchorEndOffset: startOffset + a.anchorText.length,
          content: a.content,
          notePath: resolvedPath,
          noteExcerpt: a.noteExcerpt,
          relevanceScore: a.relevanceScore,
        });
      }

      // Step 6: Persist reflection
      await ctx.runMutation(internal.reflections.insert, {
        articleId: args.articleId,
        userId: article.userId,
        strongestPoint: object.reflection.strongestPoint,
        weakestAssumption: object.reflection.weakestAssumption,
        credibleCounterview: object.reflection.credibleCounterview,
        questionForYou: object.reflection.questionForYou,
      });

      // Step 7: Mark as annotated
      await ctx.runMutation(internal.articles.updateAnnotationStatus, {
        articleId: args.articleId,
        status: "annotated",
      });

      console.log(
        `Annotated "${article.title}" with ${modelId}: ${validAnnotations.length} of ${object.annotations.length} candidates kept`,
        rejected,
      );
    } catch (error) {
      console.error(
        `Annotation generation failed for ${article.title}:`,
        error,
      );
      await ctx.runMutation(internal.articles.updateAnnotationStatus, {
        articleId: args.articleId,
        status: "failed",
      });
    }
  },
});
