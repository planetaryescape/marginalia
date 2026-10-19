import { advanceDiscoveryRevision } from "./discoveryRevision";
import { metadataTriggers } from "./metadataTriggers";
import { equalEmbedding } from "./tagVectors";

// Canonical inputs to ideaGraph/loadNode/ideaSignals/ideaNeighbours and Library
// find/search (including explanation context). Deliberately no reflections,
// heartbeat, dwell, metadata, embedding-query-cache or backfill-state tables.
for (const table of [
  "highlights",
  "companionThreads",
  "noteChunks",
  "ideaLinks",
  "tags",
  "articleTags",
  "summaries",
  "impressions",
] as const)
  metadataTriggers.register(table, (ctx, change) =>
    advanceDiscoveryRevision(
      { ...ctx, db: ctx.innerDb },
      change.oldDoc,
      change.newDoc,
    ),
  );

metadataTriggers.register("articles", async (ctx, change) => {
  const a = change.oldDoc;
  const b = change.newDoc;
  // ideaNodes/ideaNeighbours + library.ts + titleSearch.ts inputs. Index-job
  // leases, annotation runs and other operational markers do not affect these
  // results. Include raw bodies as well: timestamp-free source edits invalidate.
  const fields = [
    "userId",
    "url",
    "title",
    "author",
    "excerpt",
    "content",
    "contentHtml",
    "createdAt",
    "estimatedReadMinutes",
    "extractionStatus",
    "embeddedAt",
  ] as const;
  if (
    a &&
    b &&
    fields.every((field) => a[field] === b[field]) &&
    equalEmbedding(a.embedding, b.embedding)
  )
    return;
  return advanceDiscoveryRevision({ ...ctx, db: ctx.innerDb }, a, b);
});

metadataTriggers.register("annotations", async (ctx, change) => {
  const a = change.oldDoc;
  const b = change.newDoc;
  // connectionsOnArticle and vault reverse links do not read wasViewed or
  // wasDismissed. Viewing a connection is not a source edit or a new graph.
  const fields = [
    "userId",
    "articleId",
    "type",
    "fallacyName",
    "articleRefId",
    "anchorText",
    "anchorStartOffset",
    "anchorEndOffset",
    "content",
    "noteChunkId",
    "notePath",
    "noteExcerpt",
    "relevanceScore",
    "unitIndex",
    "createdAt",
  ] as const;
  if (a && b && fields.every((field) => a[field] === b[field])) return;
  return advanceDiscoveryRevision({ ...ctx, db: ctx.innerDb }, a, b);
});

metadataTriggers.register("userNotes", async (ctx, change) => {
  const a = change.oldDoc;
  const b = change.newDoc;
  // noteIndex is an indexing lease/checkpoint, never read by graph/search.
  // HTML/plain bodies, timestamps, owner and embedding changes still advance.
  const fields = [
    "userId",
    "articleId",
    "selectedText",
    "selectedStartOffset",
    "selectedEndOffset",
    "unitIndex",
    "annotationId",
    "prompt",
    "content",
    "contentPlain",
    "embeddedAt",
    "createdAt",
    "updatedAt",
  ] as const;
  if (
    a &&
    b &&
    fields.every((field) => a[field] === b[field]) &&
    equalEmbedding(a.embedding, b.embedding)
  )
    return;
  return advanceDiscoveryRevision({ ...ctx, db: ctx.innerDb }, a, b);
});

// These are Library ordering/context inputs, not reading-progress heartbeats.
metadataTriggers.register("articleInteractions", async (ctx, change) => {
  const a = change.oldDoc;
  const b = change.newDoc;
  // lib/library.ts consumes only articleId/action/createdAt. Engagement fields,
  // visit IDs and feed-counted markers are not search or graph inputs.
  if (
    a &&
    b &&
    a.userId === b.userId &&
    a.articleId === b.articleId &&
    a.action === b.action &&
    a.createdAt === b.createdAt
  )
    return;
  return advanceDiscoveryRevision({ ...ctx, db: ctx.innerDb }, a, b);
});
// Graph hides generated children during source-first removal. The job carries
// the same userId as the article and its phase is a live graph input.
metadataTriggers.register("feedArticleCleanup", async (ctx, change) => {
  const a = change.oldDoc;
  const b = change.newDoc;
  // The graph reads the FIRST job for an article. Even inserting/deleting a
  // checking row can reveal a later hidden job, so presence/identity matters.
  // Cursor, proof revision and Reader reservation changes still do not.
  const oldJob = a && a.phase !== "feed" ? a : null;
  const newJob = b && b.phase !== "feed" ? b : null;
  if (!oldJob && !newJob) return;
  if (
    oldJob &&
    newJob &&
    oldJob.userId === newJob.userId &&
    oldJob.articleId === newJob.articleId &&
    (oldJob.phase === "checking") === (newJob.phase === "checking")
  )
    return;
  return advanceDiscoveryRevision({ ...ctx, db: ctx.innerDb }, oldJob, newJob);
});
