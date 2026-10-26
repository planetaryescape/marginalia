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

/** Old queued payloads acquire their effective token in new action code, never
 * by trusting a tokenless result at a publication mutation. */
export const begin = internalMutation({
  args: {
    articleId: v.id("articles"),
    generation: v.optional(annotationGeneration),
    claim: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get("articles", args.articleId);
    if (!article || !(await annotationSourceActive(ctx, article))) return null;
    if (
      args.claim !== undefined &&
      (article.reannotateClaimedAt !== args.claim ||
        Date.now() - args.claim >= CLAIM_TTL_MS)
    )
      return null;
    const row = await manualState(ctx, args.articleId);
    if (row && row.userId !== article.userId) return null;
    if (!args.generation) {
      // Do not alter the pre-existing retry policy of never-adopted import
      // jobs. Previously adopted sources must always publish with a token.
      if (!row) return { article, generation: null };
      if (
        (row.status === "queued" || row.status === "running") &&
        row.leaseUntil > Date.now()
      )
        return null;
      const input = await annotationInput(ctx, article);
      // Neither a duplicate success nor a failed/lost unchanged generation
      // authorizes automatic paid recovery. Only a genuinely new input does.
      if (row.input === input) return null;
      const generation = { run: row.run + 1 };
      await ctx.db.patch(row._id, {
        input,
        run: generation.run,
        status: "running",
        attempts: 1,
        leaseUntil: Date.now() + MANUAL_ANNOTATION_LEASE_MS,
        published: false,
      });
      return { article, generation };
    }
    if (
      !row ||
      row.run !== args.generation.run ||
      row.status !== "queued" ||
      row.leaseUntil <= Date.now() ||
      row.input !== (await annotationInput(ctx, article))
    )
      return null;
    await ctx.db.patch(row._id, { status: "running" });
    return { article, generation: args.generation };
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

// The main-owned tags.assign seam checks publication atomically with matching
// and count updates. Forward the effective token; do not duplicate rich source
// and fingerprint reads in an outer check.
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
  handler: async (ctx, { generation, ...args }): Promise<Id<"tags">[]> => {
    return await ctx.runMutation(internal.tags.assign, { ...args, generation });
  },
});
