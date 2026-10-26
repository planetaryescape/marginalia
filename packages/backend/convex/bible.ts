import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { parseBibleReference } from "./lib/bible";
import { bibleTranslations, requireTranslation } from "./lib/bibleProvider";
import { biblePreferences, requireBible } from "./lib/bibleSettings";

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
  },
});

export const requireEnabled = internalQuery({
  args: { userId: v.string() },
  handler: (ctx, args) => requireBible(ctx, args.userId),
});
export const findPassage = internalQuery({
  args: { userId: v.string(), reference: v.string(), translation: v.string() },
  handler: async (ctx, args): Promise<Id<"articles"> | null> => {
    await requireBible(ctx, args.userId);
    const row = await ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q
          .eq("userId", args.userId)
          .eq("guid", `bible:${args.translation}:${args.reference}`),
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
  if (
    article.annotationStatus !== "skipped" ||
    article.skipReason !== "bible_disabled"
  )
    return;
  await ctx.db.patch(articleId, {
    annotationStatus: "pending",
    skipReason: undefined,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.actions.generateAnnotations.generateForArticle,
    { articleId },
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
  },
  handler: async (ctx, args): Promise<Id<"articles">> => {
    // Recheck after the network request: switching off must win an in-flight open.
    await requireBible(ctx, args.userId);
    const translation = requireTranslation(args.translation);
    const ref = parseBibleReference(args.reference);
    if (!ref || ref.reference !== args.reference)
      throw new Error("Invalid Bible reference.");
    const guid = `bible:${translation}:${ref.reference}`;
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
