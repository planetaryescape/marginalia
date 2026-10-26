import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { setAnnotationStatus } from "./articles";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { parseBibleReference } from "./lib/bible";
import { bibleTranslations, requireTranslation } from "./lib/bibleProvider";
import { biblePreferences, requireBible } from "./lib/bibleSettings";
import { manualState } from "./lib/manualAnnotations";
import { READER_LIMITS, spendReaderLimit } from "./limits";

export const preferences = query({
  args: {},
  handler: (ctx) => biblePreferences(ctx, ctx.readerId),
});
export const translations = query({
  args: {},
  handler: async (ctx) => {
    await requireBible(ctx, ctx.readerId);
    return bibleTranslations();
  },
});

export const activeLicensedReading = query({
  args: {},
  handler: async (ctx) => {
    if (!(await biblePreferences(ctx, ctx.readerId)).enabled) return null;
    if (
      process.env.YOUVERSION_READING_ENABLED !== "true" ||
      !process.env.YOUVERSION_APP_KEY?.trim()
    )
      return null;
    return (
      (
        await ctx.db
          .query("bibleReadingSessions")
          .withIndex("by_userId", (q) => q.eq("userId", ctx.readerId))
          .unique()
      )?.token ?? null
    );
  },
});

export const activateLicensedReading = internalMutation({
  args: {
    userId: v.string(),
    token: v.string(),
    onlyIfCurrent: v.optional(v.boolean()),
    spendRequest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireBible(ctx, args.userId);
    if (
      process.env.YOUVERSION_READING_ENABLED !== "true" ||
      !process.env.YOUVERSION_APP_KEY?.trim()
    )
      throw new Error("The licensed Bible connection is not enabled.");
    const row = await ctx.db
      .query("bibleReadingSessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (args.onlyIfCurrent) {
      if (row?.token !== args.token)
        throw new Error(
          "Another passage was opened while this was loading. Please retry here if needed.",
        );
      return;
    }
    if (args.spendRequest && !(await spendReaderLimit(ctx, args.userId, "api")))
      throw new ConvexError(READER_LIMITS.api.message);
    if (row) await ctx.db.patch(row._id, { token: args.token });
    else
      await ctx.db.insert("bibleReadingSessions", {
        userId: args.userId,
        token: args.token,
      });
  },
});
export const setPreferences = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    translation: v.optional(v.string()),
    scope: v.optional(
      v.union(v.literal("articles"), v.literal("mixed"), v.literal("bible")),
    ),
  },
  handler: async (ctx, args) => {
    const prefs = await biblePreferences(ctx, ctx.readerId);
    const enabled = args.enabled ?? prefs.enabled;
    if (
      !enabled &&
      (args.translation !== undefined ||
        (args.scope && args.scope !== "articles"))
    )
      throw new Error("Enable Bible reading first.");
    if (args.translation) requireTranslation(args.translation);
    const row = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", ctx.readerId))
      .unique();
    const patch = {
      bibleEnabled: enabled,
      bibleTranslation: args.translation ?? prefs.translation,
      readingScope: enabled
        ? (args.scope ?? prefs.scope)
        : ("articles" as const),
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, patch);
    else
      await ctx.db.insert("userSettings", { userId: ctx.readerId, ...patch });
    if (!enabled) {
      const lease = await ctx.db
        .query("bibleReadingSessions")
        .withIndex("by_userId", (q) => q.eq("userId", ctx.readerId))
        .unique();
      if (lease) await ctx.db.delete(lease._id);
    }
  },
});

export const requireEnabled = internalQuery({
  args: { userId: v.string() },
  handler: (ctx, args) => requireBible(ctx, args.userId),
});
export const studySource = internalQuery({
  args: { userId: v.string(), articleId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("articles", args.articleId);
    if (!id) return null;
    const article = await ctx.db.get(id);
    if (article?.userId !== args.userId || !article.bible?.displayVersionId)
      return null;
    await requireBible(ctx, args.userId);
    if (article.bible.translation !== "web")
      throw new Error("Unsupported AI study source.");
    return {
      title: article.title,
      content: article.content ?? "",
      reference: article.bible.reference,
    };
  },
});
export const findPassage = internalQuery({
  args: {
    userId: v.string(),
    reference: v.string(),
    translation: v.string(),
    displayVersionId: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"articles"> | null> => {
    await requireBible(ctx, args.userId);
    const row = await ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q
          .eq("userId", args.userId)
          .eq(
            "guid",
            `bible:${args.translation}:${args.reference}${args.displayVersionId ? `:display:${args.displayVersionId}` : ""}`,
          ),
      )
      .unique();
    return row?._id ?? null;
  },
});

async function resumePausedAnnotations(
  ctx: MutationCtx,
  articleId: Id<"articles">,
  userId: string,
) {
  await requireBible(ctx, userId);
  const article = await ctx.db.get(articleId);
  if (article?.userId !== userId || !article.bible)
    throw new Error("Bible passage not found.");
  const paused =
    article.annotationStatus === "skipped" &&
    article.skipReason === "bible_disabled";
  const missingReflection =
    article.annotationStatus === "annotated" &&
    !(await ctx.db
      .query("reflections")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .first());
  if (!paused && !missingReflection) return;
  if (missingReflection) {
    const current = await manualState(ctx, articleId);
    if (
      current &&
      (current.status === "queued" || current.status === "running") &&
      current.leaseUntil > Date.now()
    )
      return;
  }
  await setAnnotationStatus(ctx, articleId, "pending");
  // Restoring the previously suppressed reflection is a new generation input,
  // including for readings already adopted by the manual publication fence.
  if (missingReflection)
    await ctx.db.patch(articleId, {
      manualAnnotationRevision: (article.manualAnnotationRevision ?? 0) + 1,
    });
  await ctx.scheduler.runAfter(
    0,
    internal.actions.generateAnnotations.generateForArticle,
    { articleId, ...(missingReflection ? { repairReflection: true } : {}) },
  );
}

export const resumeAnnotations = mutation({
  args: { articleId: v.id("articles") },
  handler: (ctx, args) =>
    resumePausedAnnotations(ctx, args.articleId, ctx.readerId),
});
export const resumeAnnotationsInternal = internalMutation({
  args: { articleId: v.id("articles"), userId: v.string() },
  handler: (ctx, args) =>
    resumePausedAnnotations(ctx, args.articleId, args.userId),
});

export const savePassage = internalMutation({
  args: {
    userId: v.string(),
    reference: v.string(),
    translation: v.string(),
    content: v.string(),
    contentHtml: v.string(),
    copyright: v.string(),
    url: v.string(),
    displayVersionId: v.optional(v.number()),
    displayVersionName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"articles">> => {
    // Recheck after the network request: switching off must win an in-flight open.
    await requireBible(ctx, args.userId);
    const translation = requireTranslation(args.translation);
    if (translation !== "web")
      throw new Error("Licensed Bible text cannot be saved as an article.");
    const ref = parseBibleReference(args.reference);
    if (!ref || ref.reference !== args.reference)
      throw new Error("Invalid Bible reference.");
    const guid = `bible:${translation}:${ref.reference}${args.displayVersionId ? `:display:${args.displayVersionId}` : ""}`;
    const existing = await ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", args.userId).eq("guid", guid),
      )
      .unique();
    if (existing) return existing._id;
    const wordCount = args.content.split(/\s+/).length;
    const articleId = await ctx.db.insert("articles", {
      userId: args.userId,
      guid,
      url: args.url,
      title: ref.reference,
      author: translation.toUpperCase(),
      content: args.content,
      contentHtml: args.contentHtml,
      wordCount,
      estimatedReadMinutes: Math.max(1, Math.ceil(wordCount / 200)),
      bible: {
        reference: ref.reference,
        translation,
        copyright: args.copyright,
        displayVersionId: args.displayVersionId,
        displayVersionName: args.displayVersionName,
      },
      extractionStatus: "extracted",
      annotationStatus: "pending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.generateAnnotations.generateForArticle,
      { articleId },
    );
    return articleId;
  },
});
