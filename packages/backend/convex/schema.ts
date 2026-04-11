import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const HARDCODED_USER = "default_user";

export default defineSchema({
  feeds: defineTable({
    userId: v.string(),
    url: v.string(),
    title: v.string(),
    siteUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    lastFetchedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_url", ["userId", "url"]),

  articles: defineTable({
    feedId: v.optional(v.id("feeds")),
    userId: v.string(),
    guid: v.string(),
    url: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    content: v.optional(v.string()),
    contentHtml: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    wordCount: v.optional(v.number()),
    estimatedReadMinutes: v.optional(v.number()),
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
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
  })
    .index("by_feed", ["feedId"])
    .index("by_user", ["userId"])
    .index("by_user_guid", ["userId", "guid"])
    .index("by_extraction_status", ["userId", "extractionStatus"])
    .index("by_annotation_status", ["userId", "annotationStatus"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  annotations: defineTable({
    articleId: v.id("articles"),
    userId: v.string(),
    type: v.union(
      v.literal("cross_reference"),
      v.literal("context"),
      v.literal("tension"),
      v.literal("question"),
    ),
    anchorText: v.string(),
    anchorStartOffset: v.number(),
    anchorEndOffset: v.number(),
    content: v.string(),
    noteChunkId: v.optional(v.id("noteChunks")),
    notePath: v.optional(v.string()),
    noteExcerpt: v.optional(v.string()),
    relevanceScore: v.number(),
    wasViewed: v.boolean(),
    wasDismissed: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_user", ["userId"]),

  reflections: defineTable({
    articleId: v.id("articles"),
    userId: v.string(),
    strongestPoint: v.string(),
    weakestAssumption: v.string(),
    credibleCounterview: v.string(),
    questionForYou: v.string(),
    userResponse: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_user", ["userId"]),

  sessions: defineTable({
    userId: v.string(),
    requestedMinutes: v.number(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    articleId: v.optional(v.id("articles")),
    readingStatus: v.union(
      v.literal("selecting"),
      v.literal("reading"),
      v.literal("reflecting"),
      v.literal("completed"),
      v.literal("abandoned"),
    ),
    scrollPercentage: v.optional(v.number()),
    annotationsViewed: v.optional(v.number()),
    timeSpentMs: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_recent", ["userId", "startedAt"]),

  articleInteractions: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    sessionId: v.optional(v.id("sessions")),
    action: v.union(
      v.literal("presented"),
      v.literal("opened"),
      v.literal("finished"),
      v.literal("abandoned"),
      v.literal("skipped"),
      v.literal("saved"),
    ),
    scrollPercentage: v.optional(v.number()),
    timeSpentMs: v.optional(v.number()),
    // Engagement metrics
    activeTimeMs: v.optional(v.number()),
    maxScrollPercent: v.optional(v.number()),
    annotationsOpened: v.optional(v.array(v.string())),
    totalScrollEvents: v.optional(v.number()),
    tabHiddenCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_article", ["articleId"])
    .index("by_user_article", ["userId", "articleId"]),

  noteChunks: defineTable({
    userId: v.string(),
    filePath: v.string(),
    fileName: v.string(),
    chunkIndex: v.number(),
    content: v.string(),
    tags: v.optional(v.array(v.string())),
    embedding: v.array(v.float64()),
    fileHash: v.string(),
    indexedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_file", ["userId", "filePath"])
    .index("by_file_hash", ["userId", "fileHash"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  savedArticles: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    savedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_article", ["userId", "articleId"]),

  userNotes: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    // The text the user highlighted when creating the note
    selectedText: v.string(),
    selectedStartOffset: v.optional(v.number()),
    selectedEndOffset: v.optional(v.number()),
    // The note content (Tiptap JSON stored as string)
    content: v.string(),
    // Plain text version for search/embedding
    contentPlain: v.string(),
    // Embedding for future annotation matching
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_article", ["articleId"])
    .index("by_user_recent", ["userId", "updatedAt"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  lovedArticles: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    lovedAt: v.number(),
    reviewIndex: v.number(),
    nextReviewAt: v.number(),
    lastReviewedAt: v.optional(v.number()),
    reviewCount: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_article", ["userId", "articleId"])
    .index("by_user_next_review", ["userId", "nextReviewAt"]),
});
