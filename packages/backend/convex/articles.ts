import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

export const getById = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.articleId);
  },
});

export const listByFeed = query({
  args: { feedId: v.id("feeds") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("articles")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      .order("desc")
      .take(50);
  },
});

export const listAnnotated = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("articles")
      .withIndex("by_annotation_status", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("annotationStatus", "annotated"),
      )
      .order("desc")
      .take(50);
  },
});

export const listPendingExtraction = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("articles")
      .withIndex("by_extraction_status", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("extractionStatus", "pending"),
      )
      .take(20);
  },
});

// --- Internal ---

export const getByGuid = internalQuery({
  args: { guid: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("guid", args.guid),
      )
      .first();
  },
});

export const getByIdInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.articleId);
  },
});

export const insert = internalMutation({
  args: {
    feedId: v.id("feeds"),
    userId: v.string(),
    guid: v.string(),
    url: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    excerpt: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    extractionStatus: v.union(
      v.literal("pending"),
      v.literal("extracted"),
      v.literal("failed"),
    ),
    annotationStatus: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("articles", args);
  },
});

export const listPendingExtractionInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("articles")
      .withIndex("by_extraction_status", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("extractionStatus", "pending"),
      )
      .take(10);
  },
});

export const updateExtractionStatus = internalMutation({
  args: {
    articleId: v.id("articles"),
    status: v.union(
      v.literal("pending"),
      v.literal("extracted"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.articleId, { extractionStatus: args.status });
  },
});

export const updateExtracted = internalMutation({
  args: {
    articleId: v.id("articles"),
    content: v.string(),
    contentHtml: v.string(),
    excerpt: v.string(),
    wordCount: v.number(),
    estimatedReadMinutes: v.number(),
    imageUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    author: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const { articleId, ...updates } = args;
    await ctx.db.patch(articleId, {
      ...updates,
      extractionStatus: "extracted" as const,
    });
  },
});

export const getByUrl = internalQuery({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("articles")
      .withIndex("by_user_guid", (q) =>
        q.eq("userId", DEFAULT_USER_ID).eq("guid", args.url),
      )
      .first();
  },
});

export const requestReannotate = action({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    // Delete existing annotations and reflection
    await ctx.runMutation(internal.annotations.deleteByArticle, {
      articleId: args.articleId,
    });
    await ctx.runMutation(internal.reflections.deleteByArticle, {
      articleId: args.articleId,
    });
    // Reset annotation status
    await ctx.runMutation(internal.articles.updateAnnotationStatus, {
      articleId: args.articleId,
      status: "pending",
    });
    // Schedule re-annotation
    await ctx.scheduler.runAfter(
      500,
      internal.actions.generateAnnotations.generateForArticle,
      { articleId: args.articleId },
    );
  },
});

export const insertExtracted = internalMutation({
  args: {
    userId: v.string(),
    guid: v.string(),
    url: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    content: v.string(),
    contentHtml: v.string(),
    excerpt: v.string(),
    wordCount: v.number(),
    estimatedReadMinutes: v.number(),
    imageUrl: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    readerDocumentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("articles", {
      ...args,
      extractionStatus: "extracted",
      annotationStatus: "pending",
      createdAt: Date.now(),
    });
  },
});

export const updateAnnotationStatus = internalMutation({
  args: {
    articleId: v.id("articles"),
    status: v.union(
      v.literal("pending"),
      v.literal("annotated"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.articleId, { annotationStatus: args.status });
  },
});
