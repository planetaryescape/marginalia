"use node";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import { generateObjectWithFallback } from "../lib/aiModels";
import { annotationBudget, gateNotes } from "../lib/annotationGate";
import { KIND_FAMILIES } from "../lib/annotationKinds";
import { type EmbeddingTarget, embedTexts } from "../lib/embeddings";
import { buildMarginaliaContext } from "../lib/marginaliaContext";
import { loadReaderAI } from "../lib/router";
import { MAX_TAGS_PER_ARTICLE, normaliseTag } from "../lib/tagMatching";

export type AnnotationResult = z.infer<typeof annotationCandidateSchema>;

// `type` is a plain string so one unknown kind costs one note, not the whole
// response; lib/annotationGate.ts drops anything that isn't a real kind.
export const annotationCandidateSchema = z.object({
  thesis: z
    .string()
    .optional()
    .describe(
      "The article's main point in one sentence, under 25 words. Always give one.",
    ),
  gist: z
    .string()
    .optional()
    .describe(
      "Two or three sentences, under 70 words: the argument in plain words and why it matters. Always give one.",
    ),
  tags: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            "A short topic name, one to three words. Prefer a tag from the existing list, spelled exactly as listed.",
          ),
        description: z
          .string()
          .optional()
          .describe("For a new tag only: what the tag covers, in a few words."),
        reason: z
          .string()
          .optional()
          .describe(
            "For a new tag only: one line on why no existing tag fits. A new tag without a reason is discarded.",
          ),
      }),
    )
    .optional()
    .describe(
      "One to three topic tags for the whole article. Existing tags first.",
    ),
  annotations: z.array(
    z.object({
      type: z
        .string()
        .describe(
          "One of: tension, fallacy, assumption, unsupported, other_explanation (pushback); strong_point, crux (support); cross_reference, context, question (connection).",
        ),
      anchorText: z
        .string()
        .describe(
          "Exact text from the article to anchor this annotation to. Must be a verbatim substring.",
        ),
      content: z
        .string()
        .describe(
          "The note shown to the reader. As short as it can be: usually one or two sentences.",
        ),
      fallacyName: z
        .string()
        .optional()
        .describe(
          'For type fallacy only: the specific fallacy, e.g. "false dilemma", "survivorship bias", "post hoc".',
        ),
      notePath: z
        .string()
        .optional()
        .describe(
          "Obsidian note file path, if this is a cross_reference to a vault note.",
        ),
      noteExcerpt: z
        .string()
        .optional()
        .describe("Relevant excerpt from the referenced note."),
      articleRefId: z
        .string()
        .optional()
        .describe(
          "If this is a cross_reference to another article in the reader's library: that article's id, copied exactly from the list you were given.",
        ),
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

export const SYSTEM_PROMPT = `You are a critical friend in the margin of a personal reading app. Beside the reader, you say where the argument is strong, where it is weak and what it connects to. The reader is intelligent and easily won over by a well-written piece, so your job is to slow down premature agreement without being contrarian.

You will receive:
1. An article the user is about to read
2. Today's date and when the article was published
3. Notes from the user's Obsidian vault that closely match specific parts of the article, with a similarity score and where in the article they matched
4. When relevant: the user's own notes and reflections, passages they marked, and questions they asked while reading other articles, plus anything they've already done with this article
5. When relevant: other articles in the user's library that are close to this one, each with an id

Treat items 3 to 5 as a picture of what this reader knows, cares about and has struggled with. Use them where they genuinely connect. Higher similarity is a stronger hint, not proof.

## Kinds of note, in three families

Pushback (slows premature agreement):
- tension: a genuine conflict between the article and something in the user's notes, or between its claims and a well-known counterargument. Specific, not "there are different perspectives."
- fallacy: a reasoning error. Name the specific fallacy in fallacyName (false dilemma, survivorship bias, post hoc, equivocation, appeal to authority, straw man, hasty generalisation...). Only when the passage really commits it.
- assumption: an unstated premise the argument needs and might not hold.
- unsupported: a claim stated as fact with no evidence, or evidence that is too thin for the weight put on it.
- other_explanation: another cause that fits the same facts equally well.

Support (says what survives, so the pushback is credible):
- strong_point: where the argument is well made, and why.
- crux: the claim the rest of the argument depends on. If it falls, so does the piece.

Connection (relates the passage to the reader's world):
- cross_reference: connect a specific claim to a specific vault note (give notePath and noteExcerpt), or to another article in the reader's library (give articleRefId, copied exactly from the list). Only when the link is meaningful, not vague topic overlap.
- context: context that enriches understanding of a concept, person, place, or idea mentioned, only when it adds something the reader wouldn't already know. Mind the dates: if something the article describes may have changed, say so rather than presenting it as current.
- question: a probing question grounded in a tension with the user's notes, an unstated assumption, or an implication the article never follows through on.

## Balance

Lean toward pushback, close to balance: roughly 55 to 60 percent of the notes should be pushback, and the rest support and connection. Include support whenever something earns it, since it is what makes the pushback believable. Never invent pushback to reach the share; if the piece is sound, say so with strong_point and crux and push back less.

## How many, and how long

Budget notes by density, not by a fixed count: about one per screen of text on average, more where the argument is dense, fewer where the text is narrative or filler. The user message gives this article's target and ceiling. Never pad to reach the target; zero notes is acceptable if nothing meaningful connects.

Keep every note as short as it can be: usually one or two sentences, and never more than three. Say the thing; skip setup like "This passage..." and do not restate the anchor.

## Rules

1. anchorText MUST be an EXACT verbatim substring from the article. Copy-paste, do not paraphrase.
2. Anchor to sentences or meaningful clauses, not single common words.
3. cross_reference notes MUST cite either a vault note (notePath and noteExcerpt from the provided notes) or a library article (articleRefId from the provided list). Never invent either.
4. Score relevanceScore on this scale, honestly. Anything under 0.5 is not shown.
   - 0.9–1.0: essential; it changes how the reader understands the passage
   - 0.7–0.9: a strong, specific connection or insight
   - 0.5–0.7: specific and useful; the reader would be glad to see it
   - below 0.5: generic, obvious, or a stretch
5. Do NOT annotate every paragraph. Most paragraphs should have no note.
6. The reader is intelligent. Don't explain obvious things.

## The one point and the short summary

Also return thesis (the main point in one sentence) and gist (two or three sentences). They are shown to the reader before they read, so be faithful to the article: no outside facts, no praise.

## Tags

Give the article one to three topic tags. You are shown the reader's existing tags; choose from them first, spelled exactly as listed. Propose a new tag only when none fits, and then give a short description and a one-line reason. A new tag without a reason is discarded. Do not propose near-duplicates of existing tags (a plural, a hyphenated or reworded form).

## Reflection Box

The reflection box appears after the article. Its job is to slow down premature agreement — the reader may be impressed by the author and needs intellectual brakes.

- strongestPoint: What's actually well-argued, not just what sounds good
- weakestAssumption: Something the argument depends on that could be wrong
- credibleCounterview: What would a smart, informed critic say? Not a strawman.
- questionForYou: Grounded in the reader's notes, past reflections and questions, or the article's implications. Not generic.`;

/** The user message: the article, its context and this article's note budget. */
export function buildUserPrompt(input: {
  title: string;
  author?: string;
  articleText: string;
  truncated: boolean;
  contextText: string;
  wordCount: number;
  vocabulary: string[];
}) {
  const { target, cap } = annotationBudget(input.wordCount);
  return `## Article: "${input.title}"
${input.author ? `By: ${input.author}` : ""}

${input.articleText}${input.truncated ? "\n\n[The article continues beyond this point.]" : ""}

${input.contextText}

## The reader's existing tags

${input.vocabulary.length ? input.vocabulary.join("\n") : "None yet."}

## Budget

The article is about ${input.wordCount} words. Aim for about ${target} notes, and no more than ${cap}. Lean toward pushback, close to balance. Keep every note short. Also return the thesis, the gist and one to three tags.`;
}

/** Resolves a note path the model wrote to the vault path it was shown. */
export function resolveNotePath(
  llmPath: string | undefined,
  vaultPaths: readonly string[],
): string | undefined {
  if (!llmPath) return undefined;
  // A Map, so a path like "constructor" is an ordinary key
  const lookup = new Map<string, string>();
  for (const fp of vaultPaths) {
    const basename = fp.split("/").pop() || fp;
    for (const name of [fp, basename, basename.replace(/\.md$/, "")]) {
      lookup.set(name, fp);
      lookup.set(name.toLowerCase(), fp);
    }
  }
  return (
    lookup.get(llmPath) ??
    lookup.get(llmPath.toLowerCase()) ??
    lookup.get(llmPath.replace(/\.md$/, "")) ??
    lookup.get(llmPath.replace(/\.md$/, "").toLowerCase()) ??
    llmPath // fallback to whatever the LLM said
  );
}

/**
 * Tags to hand to the vocabulary: existing ones as listed, and a new one only
 * with a reason. At most MAX_TAGS_PER_ARTICLE, deduplicated by key.
 */
export function proposedTags(
  tags: AnnotationResult["tags"],
  offeredKeys: ReadonlySet<string>,
) {
  const seen = new Set<string>();
  const kept: { name: string; description?: string; key: string }[] = [];
  for (const tag of tags ?? []) {
    const key = normaliseTag(tag.name ?? "");
    if (!key || seen.has(key)) continue;
    if (!offeredKeys.has(key) && !tag.reason?.trim()) continue;
    seen.add(key);
    kept.push({
      name: tag.name.trim(),
      description: tag.description?.trim() || undefined,
      key,
    });
    if (kept.length >= MAX_TAGS_PER_ARTICLE) break;
  }
  return kept;
}

export const generateForArticle = internalAction({
  // `claim` is set only by the backfill: the claim this run was scheduled under
  args: { articleId: v.id("articles"), claim: v.optional(v.number()) },
  handler: async (ctx, args) => {
    try {
      await annotateArticle(ctx, { articleId: args.articleId });
    } finally {
      // Ends this run's own backfill claim however it ended, never a newer
      // one; a crash leaves it to expire
      if (args.claim !== undefined)
        await ctx.runMutation(internal.reannotateBackfill.releaseClaim, {
          articleId: args.articleId,
          claim: args.claim,
        });
    }
  },
});

async function annotateArticle(
  ctx: ActionCtx,
  args: { articleId: Id<"articles"> },
) {
  const article = await ctx.runQuery(internal.articles.getByIdInternal, {
    articleId: args.articleId,
  });

  // A re-annotation (the backfill) keeps the notes it has when it can't run
  const reannotating = article?.annotationStatus === "annotated";

  if (!article?.content) {
    if (!reannotating)
      await ctx.runMutation(internal.articles.updateAnnotationStatus, {
        articleId: args.articleId,
        status: "skipped",
      });
    return;
  }

  // Skip very short articles
  if ((article.wordCount ?? 0) < 100) {
    if (!reannotating)
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
    // Re-annotated by the catch-up once the library saves a key
    if (!reannotating)
      await ctx.runMutation(internal.articles.updateAnnotationStatus, {
        articleId: args.articleId,
        status: "skipped",
        skipReason: "no_provider",
      });
    return;
  }

  try {
    // Step 1–2: Gather what the model should read: most of the article,
    // dates, the reader's closely related notes and marks, and the nearest
    // other articles in their library
    const { articleText, contextText, vaultPaths, libraryCandidates } =
      await buildMarginaliaContext(
        ctx,
        { ...article, content: article.content },
        ai.embedder(),
      );
    const vocabulary: { name: string; key: string; aliases: string[] }[] =
      await ctx.runQuery(internal.tags.vocabulary, {
        userId: article.userId,
      });
    const wordCount = article.wordCount ?? 0;

    // Step 3: Generate annotations via LLM
    const { object, modelId } =
      await generateObjectWithFallback<AnnotationResult>({
        schema: annotationCandidateSchema,
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt({
          title: article.title,
          author: article.author,
          articleText,
          truncated: article.content.length > articleText.length,
          contextText,
          wordCount,
          vocabulary: vocabulary.map((tag) => tag.name),
        }),
        targets,
        onFailure: ai.noteFailure,
      });

    // Step 4: Quality gate
    const { notes, rejected } = gateNotes(object.annotations, {
      content: article.content,
      offeredArticleIds: new Set(libraryCandidates.map((c) => c.id)),
      cap: annotationBudget(wordCount).cap,
    });

    // Step 5: Persist notes and reflection together, so a half-written margin can't exist
    await ctx.runMutation(internal.annotations.replaceForArticle, {
      articleId: args.articleId,
      userId: article.userId,
      notes: notes.map((a) => ({
        type: a.type,
        fallacyName: a.fallacyName,
        // Checked against the offered candidates by the gate, and again in the mutation
        // SAFETY: gateNotes kept it only because it is the id of a library article offered in this prompt (an Id<"articles"> from the context query).
        articleRefId: a.articleRefId as Id<"articles"> | undefined,
        anchorText: a.anchorText,
        anchorStartOffset: a.startOffset,
        anchorEndOffset: a.startOffset + a.anchorText.length,
        content: a.content,
        notePath: resolveNotePath(a.notePath, vaultPaths),
        noteExcerpt: a.noteExcerpt,
        relevanceScore: a.relevanceScore,
      })),
      reflection: object.reflection,
    });

    // The one point and short summary, and the tags, are extras: failing at
    // either must not undo the margin that was just written
    if (object.thesis?.trim() && object.gist?.trim())
      await ctx.runMutation(internal.summaries.saveOverview, {
        userId: article.userId,
        articleId: args.articleId,
        thesis: object.thesis,
        gist: object.gist,
        model: modelId,
      });
    await assignTags(ctx, {
      userId: article.userId,
      articleId: args.articleId,
      tags: object.tags,
      vocabulary,
      embedder: ai.embedder(),
    });

    const pushback = notes.filter((n) =>
      KIND_FAMILIES.pushback.some((kind) => kind === n.type),
    ).length;
    console.log(
      `Annotated "${article.title}" with ${modelId}: ${notes.length} of ${object.annotations.length} candidates kept (${pushback} pushback)`,
      rejected,
    );
  } catch (error) {
    console.error(`Annotation generation failed for ${article.title}:`, error);
    if (!reannotating)
      await ctx.runMutation(internal.articles.updateAnnotationStatus, {
        articleId: args.articleId,
        status: "failed",
      });
  }
}

async function assignTags(
  ctx: ActionCtx,
  input: {
    userId: string;
    articleId: Id<"articles">;
    tags: AnnotationResult["tags"];
    vocabulary: { key: string; aliases: string[] }[];
    embedder: EmbeddingTarget | null;
  },
) {
  try {
    const offeredKeys = new Set(
      input.vocabulary.flatMap((tag) => [tag.key, ...tag.aliases]),
    );
    const proposals = proposedTags(input.tags, offeredKeys);
    // Only names the vocabulary doesn't already know need an embedding
    const unknown = proposals.filter((p) => !offeredKeys.has(p.key));
    const vectors =
      input.embedder && unknown.length
        ? await embedTexts(
            input.embedder,
            unknown.map((p) =>
              p.description ? `${p.name}: ${p.description}` : p.name,
            ),
          )
        : [];
    await ctx.runMutation(internal.tags.assign, {
      userId: input.userId,
      articleId: input.articleId,
      proposals: proposals.map((p) => {
        const at = unknown.indexOf(p);
        return {
          name: p.name,
          description: p.description,
          embedding: at === -1 ? undefined : vectors[at],
        };
      }),
    });
  } catch (error) {
    console.error(`Tagging failed for ${input.articleId}:`, error);
  }
}
