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
    // Set when the article came from (or was matched to) Readwise Reader
    readerDocumentId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_feed", ["feedId"])
    .index("by_reader_document", ["readerDocumentId"])
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
    // Set when the note is a reflection on an auto annotation (e.g. answering a Question).
    // Not a hard reference: re-annotating deletes annotations but keeps the note.
    annotationId: v.optional(v.id("annotations")),
    // What the note responds to (e.g. the Question it answers), kept so the
    // note still makes sense after re-annotating deletes the annotation
    prompt: v.optional(v.string()),
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

  // Ask / Explain / Simplify conversations about a highlighted passage.
  // `turns` is bounded: the companion endpoint accepts at most 30 history turns.
  companionThreads: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    mode: v.union(
      v.literal("explain"),
      v.literal("simplify"),
      v.literal("ask"),
      v.literal("article"),
    ),
    selection: v.string(),
    question: v.optional(v.string()),
    paragraphIndex: v.optional(v.number()),
    turns: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    model: v.optional(v.string()),
    // Passage + question + first answer, so future marginalia can recall it
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // Highlighter and pen marks, re-anchored by text when the article renders.
  // Colours come from reader settings, so they follow the user's palette.
  highlights: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    kind: v.union(v.literal("highlight"), v.literal("underline")),
    text: v.string(),
    paragraphIndex: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    // Readwise Reader sync: where the mark came from, and its Reader id
    source: v.optional(v.union(v.literal("marginalia"), v.literal("reader"))),
    readerHighlightId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_reader_highlight", ["readerHighlightId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // On-demand article summary: the gist, key claims and a section map.
  // Paragraph numbers are 1-based and match the reader's ¶ labels.
  summaries: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    gist: v.string(),
    // Idea map: the article's ideas and how they build towards its point
    thesis: v.optional(v.string()),
    ideas: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          detail: v.string(),
          role: v.union(
            v.literal("premise"),
            v.literal("evidence"),
            v.literal("claim"),
            v.literal("counterpoint"),
            v.literal("conclusion"),
          ),
          paragraphs: v.array(v.number()),
        }),
      ),
    ),
    links: v.optional(
      v.array(
        v.object({
          from: v.string(),
          to: v.string(),
          relation: v.union(
            v.literal("supports"),
            v.literal("leads_to"),
            v.literal("contrasts"),
            v.literal("illustrates"),
          ),
        }),
      ),
    ),
    flow: v.optional(v.string()),
    // Older summaries (before the idea map) stored these instead
    claims: v.optional(
      v.array(v.object({ text: v.string(), paragraphs: v.array(v.number()) })),
    ),
    sections: v.optional(
      v.array(v.object({ title: v.string(), start: v.number(), end: v.number() })),
    ),
    model: v.string(),
    createdAt: v.number(),
  }).index("by_article", ["articleId"]),

  // How an article landed with the reader: a 1–5 rating, quick tags and a
  // line on what stayed with them. Embedded so the library can recall it.
  impressions: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    rating: v.optional(v.number()),
    tags: v.array(v.string()),
    note: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_user_updated", ["userId", "updatedAt"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // One row per user. Model IDs are validated against TEXT_MODELS in lib/openrouter.ts.
  userSettings: defineTable({
    userId: v.string(),
    annotationModel: v.optional(v.string()),
    quickModel: v.optional(v.string()),
    deepModel: v.optional(v.string()),
    // Readwise Reader sync: documents updated after this were not yet imported
    readwiseSyncedAt: v.optional(v.number()),
    readwiseCheckedAt: v.optional(v.number()),
    readwiseError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
