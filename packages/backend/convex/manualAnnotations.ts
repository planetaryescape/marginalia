import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ownedArticle } from "./access";
import { internalMutation, internalQuery } from "./functions";
import {
  annotationGeneration,
  annotationInput,
  annotationPublicationAllowed,
  annotationSourceActive,
  MANUAL_ANNOTATION_ATTEMPTS,
  MANUAL_ANNOTATION_LEASE_MS,
  manualState,
} from "./lib/manualAnnotations";
import { CLAIM_TTL_MS } from "./reannotateBackfill";

export const request = internalMutation({
  args: { articleId: v.id("articles"), userId: v.string() },
  handler: async (ctx, args) => {
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (!article) throw new Error("Article not found");
    if (article.bookUnitCount !== undefined)
      throw new ConvexError("A book is annotated a part at a time.");
    if (!(await annotationSourceActive(ctx, article)))
      throw new ConvexError("Article not available for marginalia.");
    if (
      article.reannotateClaimedAt !== undefined &&
      Date.now() - article.reannotateClaimedAt < CLAIM_TTL_MS
    )
      throw new ConvexError(
        "Marginalia is already re-reading this article. Its new notes arrive shortly.",
      );
    const input = await annotationInput(ctx, article);
    const row = await manualState(ctx, args.articleId);
    if (
      row?.input === input &&
      (row.status === "queued" || row.status === "running") &&
      row.leaseUntil > Date.now()
    )
      return "running";
    if (row?.input === input && row.status === "complete") return "unchanged";
    if (row?.input === input && row.published && row.leaseUntil <= Date.now()) {
      // A lost action after the atomic margin commit needs no second model
      // call merely to recover its optional extras/final acknowledgement.
      await ctx.db.patch(row._id, { status: "complete" });
      return "unchanged";
    }
    const attempts = row?.input === input ? row.attempts + 1 : 1;
    if (attempts > MANUAL_ANNOTATION_ATTEMPTS)
      throw new ConvexError(
        "Marginalia could not finish after three attempts. Change the input or AI settings before trying again.",
      );
    const fields = {
      ...args,
      run: (row?.run ?? 0) + 1,
      input,
      status: "queued" as const,
      attempts,
      leaseUntil: Date.now() + MANUAL_ANNOTATION_LEASE_MS,
      published: false,
    };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("manualAnnotationState", fields);
    // Claim and schedule commit together. Existing successful output/status stays.
    await ctx.scheduler.runAfter(
      500,
      internal.actions.generateAnnotations.generateForArticle,
      { articleId: args.articleId, generation: { run: fields.run } },
    );
    return "scheduled";
  },
});

/** One delivery wins before retrieval/embedding/model work starts. Old action
 * payloads remain accepted, but cannot run over an adopted manual article. */
export const begin = internalMutation({
  args: {
    articleId: v.id("articles"),
    generation: v.optional(annotationGeneration),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (!article || !(await annotationSourceActive(ctx, article))) return null;
    const row = await manualState(ctx, args.articleId);
    if (!args.generation) return row ? null : article;
    if (
      !row ||
      row.run !== args.generation.run ||
      row.status !== "queued" ||
      row.leaseUntil <= Date.now() ||
      row.input !== (await annotationInput(ctx, article))
    )
      return null;
    await ctx.db.patch(row._id, { status: "running" });
    return article;
  },
});

export const finish = internalMutation({
  args: { articleId: v.id("articles"), generation: annotationGeneration },
  handler: async (ctx, args) => {
    const row = await manualState(ctx, args.articleId);
    if (row?.run === args.generation.run && row.status === "running")
      await ctx.db.patch(row._id, {
        status: row.published ? "complete" : "failed",
      });
  },
});

export const canDispatch = internalQuery({
  args: {
    articleId: v.id("articles"),
    generation: v.optional(annotationGeneration),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    return Boolean(
      article &&
        (await annotationPublicationAllowed(ctx, article, args.generation)),
    );
  },
});

// Check and call the existing tag mutation within one outer transaction. Its
// matching/vocabulary behavior is unchanged; no check→action publication gap.
export const assignTags = internalMutation({
  args: {
    userId: v.string(),
    articleId: v.id("articles"),
    generation: v.optional(annotationGeneration),
    proposals: v.array(
      v.object({
        name: v.string(),
        description: v.optional(v.string()),
        embedding: v.optional(v.array(v.float64())),
      }),
    ),
  },
  handler: async (
    ctx,
    { generation, ...args },
  ): Promise<Id<"tags">[] | null> => {
    const article = await ownedArticle(ctx, args.articleId, args.userId);
    if (
      !article ||
      !(await annotationPublicationAllowed(ctx, article, generation))
    )
      return null;
    return await ctx.runMutation(internal.tags.assign, args);
  },
});
