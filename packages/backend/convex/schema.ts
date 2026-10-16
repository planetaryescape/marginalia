import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Fixed-window budgets for unauthenticated endpoints: "password" (global),
  // "password:<email>" and "waitlist". Stale rows are swept hourly.
  authAttempts: defineTable({
    scope: v.string(),
    startedAt: v.number(),
    count: v.number(),
  })
    .index("by_scope", ["scope"])
    .index("by_startedAt", ["startedAt"]),
  // Per-reader fixed-window budgets, one row per reader and bucket
  readerLimits: defineTable({
    userId: v.string(),
    bucket: v.string(),
    startedAt: v.number(),
    count: v.number(),
  }).index("by_userId_and_bucket", ["userId", "bucket"]),
  // Public waitlist. Never reveals whether an email is already on it.
  accessRequests: defineTable({
    email: v.string(),
    name: v.string(),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    inviteId: v.optional(v.id("invites")),
  })
    .index("by_email", ["email"])
    .index("by_status_and_createdAt", ["status", "createdAt"]),
  // One-time invites. Only the SHA-256 of the token is stored; the owner
  // receives the plaintext link once, when approving.
  invites: defineTable({
    tokenHash: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    requestId: v.optional(v.id("accessRequests")),
    expiresAt: v.number(),
    // Set by the sign-up hook once the token checks out; the user trigger
    // only consumes a recently reserved invite
    reservedAt: v.optional(v.number()),
    consumedAt: v.optional(v.number()),
    consumedBy: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_email", ["email"]),
  readerAccess: defineTable({
    key: v.literal("owner"),
    email: v.optional(v.string()),
    authId: v.optional(v.string()),
    setupHash: v.optional(v.string()),
    setupExpiresAt: v.optional(v.number()),
  }).index("by_key", ["key"]),
  // Signed-in readers other than the owner, each with their own library.
  // The owner is mapped through readerAccess and keeps the "default_user" library.
  readers: defineTable({
    authId: v.string(),
    libraryId: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    // Set when the reader deletes their account; the purge runs in batches
    deletingAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_authId", ["authId"])
    .index("by_libraryId", ["libraryId"])
    .index("by_status", ["status"]),
  feeds: defineTable({
    userId: v.string(),
    url: v.string(),
    title: v.string(),
    siteUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    lastFetchedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    // Posts published before this are skipped; set by the feed's first poll
    importAfter: v.optional(v.number()),
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
    // Why a "skipped" article was skipped. "no_provider" articles are
    // re-annotated once the library saves a key (catchUp.ts); older skipped
    // rows have no reason and are re-annotated only by hand.
    skipReason: v.optional(v.literal("no_provider")),
    embedding: v.optional(v.array(v.float64())),
    // Set when the article came from (or was matched to) Readwise Reader
    readerDocumentId: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    queueCounted: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_feed", ["feedId"])
    .index("by_reader_document", ["readerDocumentId"])
    .index("by_userId_and_readerDocumentId", ["userId", "readerDocumentId"])
    .index("by_user", ["userId"])
    .index("by_user_guid", ["userId", "guid"])
    .index("by_user_url", ["userId", "url"])
    .index("by_extraction_status", ["userId", "extractionStatus"])
    .index("by_annotation_status", ["userId", "annotationStatus"])
    .index("by_userId_and_annotationStatus_and_skipReason", [
      "userId",
      "annotationStatus",
      "skipReason",
    ])
    .index("by_user_annotationStatus_finishedAt", [
      "userId",
      "annotationStatus",
      "finishedAt",
    ])
    // Time-window suggestions read only the articles nearest the window's length
    .index("by_user_annotationStatus_finishedAt_minutes", [
      "userId",
      "annotationStatus",
      "finishedAt",
      "estimatedReadMinutes",
    ])
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
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_user", ["userId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_responded", ["userId", "respondedAt"]),

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
    visitId: v.optional(v.string()),
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
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_article", ["articleId"])
    .index("by_user_article", ["userId", "articleId"])
    .index("by_user_article_action", ["userId", "articleId", "action"]),

  // Cumulative checkpoints per page visit and local day make retries idempotent.
  readingActivity: defineTable({
    userId: v.string(),
    visitId: v.string(),
    day: v.string(),
    articleId: v.id("articles"),
    sessionId: v.optional(v.id("sessions")),
    startedAt: v.number(),
    updatedAt: v.number(),
    activeTimeMs: v.number(),
    visibleTimeMs: v.number(),
    timeSpentMs: v.number(),
    maxScrollPercent: v.number(),
    annotationsOpened: v.array(v.string()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_user_visit_day", ["userId", "visitId", "day"])
    .index("by_user_started", ["userId", "startedAt"])
    .index("by_user_article", ["userId", "articleId"]),

  readingQueueStats: defineTable({
    userId: v.string(),
    annotated: v.number(),
    waiting: v.number(),
    pending: v.number(),
    fits5: v.number(),
    fits10: v.number(),
    fits20: v.number(),
    ready: v.boolean(),
    cursor: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  readwiseSyncState: defineTable({
    userId: v.string(),
    active: v.boolean(),
    backfilledAt: v.optional(v.number()),
    startedAt: v.number(),
    updatedAfter: v.optional(v.string()),
    phase: v.number(),
    pageCursor: v.optional(v.string()),
    pageProcessedIds: v.array(v.string()),
    token: v.optional(v.string()),
    leaseUntil: v.number(),
    nextRunAt: v.number(),
    scanned: v.number(),
    imported: v.number(),
    linked: v.number(),
    skipped: v.number(),
    highlights: v.number(),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

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
    // Rich-text HTML produced by Tiptap; sanitize before rendering.
    content: v.string(),
    // Plain text version for search/embedding
    contentPlain: v.string(),
    // Embedding for future annotation matching
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_created", ["userId", "createdAt"])
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

  // Ask / Explain / Simplify / Define conversations about a highlighted passage.
  // `turns` is bounded: the companion endpoint accepts at most 30 history turns.
  companionThreads: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    mode: v.union(
      v.literal("explain"),
      v.literal("simplify"),
      v.literal("define"),
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
    // Set when the reader chose Keep. Rows written before answers became
    // temporary have none: they were saved automatically.
    keptAt: v.optional(v.number()),
    // The id the reader client gave the answer: a retried Keep finds its row by this
    answerId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_user", ["userId"])
    .index("by_user_kept", ["userId", "keptAt"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // Every Define the reader completed, kept or not: the raw material of the
  // personal dictionary. `sense` is the one line of Marginalia's text kept
  // without Keep, because it is the reader's own dictionary entry.
  lookups: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    word: v.string(),
    // Lower-cased `word` without surrounding punctuation, for finding repeats
    wordKey: v.string(),
    sentence: v.string(),
    paragraphIndex: v.optional(v.number()),
    // Which match of the word in its paragraph was looked up
    occurrence: v.optional(v.number()),
    sense: v.string(),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_word", ["userId", "wordKey"]),

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
    .index("by_userId", ["userId"])
    .index("by_reader_highlight", ["readerHighlightId"])
    .index("by_userId_and_readerHighlightId", ["userId", "readerHighlightId"])
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
      v.array(
        v.object({ title: v.string(), start: v.number(), end: v.number() }),
      ),
    ),
    model: v.string(),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_user", ["userId"]),

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
    .index("by_userId", ["userId"])
    .index("by_user_updated", ["userId", "updatedAt"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // A reader's own AI provider keys, one per provider, sealed with AES-GCM
  // (lib/providerKeys.ts). Only provider actions decrypt them.
  providerCredentials: defineTable({
    userId: v.string(),
    provider: v.union(
      v.literal("openrouter"),
      v.literal("openai"),
      v.literal("anthropic"),
    ),
    ciphertext: v.string(),
    iv: v.string(),
    last4: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    validatedAt: v.number(),
  }).index("by_userId_and_provider", ["userId", "provider"]),

  // A reader's own Readwise access token, sealed like provider keys but kept
  // apart so it never appears among AI providers or model lists.
  readwiseCredentials: defineTable({
    userId: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    last4: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    validatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // A reader's ChatGPT plan, connected with Sign in with ChatGPT. Off unless
  // the deployment enables it (lib/providers.ts isChatGPTEnabled). The sealed
  // JSON holds the access, refresh and ID tokens; nothing returns it.
  chatgptConnections: defineTable({
    userId: v.string(),
    subject: v.string(),
    email: v.optional(v.string()),
    clientId: v.string(),
    // Absent once the tokens are cleared (reconnect needed)
    ciphertext: v.optional(v.string()),
    iv: v.optional(v.string()),
    scopes: v.array(v.string()),
    planEnabled: v.boolean(),
    expiresAt: v.number(),
    status: v.union(
      v.literal("connected"),
      v.literal("reconnect"),
      v.literal("plan_disabled"),
    ),
    // Why plan usage stopped, for the account page
    message: v.optional(v.string()),
    models: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))),
    modelsAt: v.optional(v.number()),
    // Refresh tokens rotate: only the holder of the lease may spend one.
    // `version` changes with every token write.
    refreshLease: v.optional(v.object({ id: v.string(), until: v.number() })),
    // Set by the account purge while it revokes the refresh token with OpenAI
    revokeRequestedAt: v.optional(v.number()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Pending Sign in with ChatGPT attempts, consumed once by the callback.
  chatgptAuthAttempts: defineTable({
    userId: v.string(),
    stateHash: v.string(),
    nonce: v.string(),
    // The PKCE verifier, sealed to this reader
    verifierCiphertext: v.string(),
    verifierIv: v.string(),
    expiresAt: v.number(),
  })
    .index("by_stateHash", ["stateHash"])
    .index("by_userId", ["userId"]),

  // One row per library: the paced catch-up that re-runs work skipped for
  // lack of a key (catchUp.ts). Only the step carrying `runId` may advance it.
  catchUpState: defineTable({
    userId: v.string(),
    running: v.boolean(),
    runId: v.number(),
    // Whether this run could embed when it started; a new embedding key restarts the scan
    embed: v.boolean(),
    phase: v.number(),
    // _creationTime of the last row checked in the current phase
    cursor: v.optional(v.number()),
    articlesQueued: v.number(),
    itemsQueued: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  // One row per user. Model IDs are validated against the reader's available
  // models in lib/providers.ts; older rows hold bare OpenRouter IDs.
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

  // Personal API tokens other apps use to send articles in and read highlights
  // back. Only the SHA-256 of a token is stored; the reader sees it once.
  apiTokens: defineTable({
    userId: v.string(),
    name: v.string(),
    hash: v.string(),
    last4: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_hash", ["hash"])
    .index("by_userId", ["userId"]),
});
