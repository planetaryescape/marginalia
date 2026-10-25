import { ConvexError, getDocumentSize } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  articleProjection,
  metadataReady,
  readReportingDocument,
} from "./articleMetadata";
import { roomPeriod } from "./readingRoom";

const ROW_LIMIT = 1500;
const SOURCE_BYTES = 1_500_000;
const ARTICLE_CONTEXT_LIMIT = 300;
const ARTICLES_SHOWN = 30;

type ActivityRow = {
  personalHighlights: number;
  personalUnderlines: number;
  notes: number;
  importedHighlights: number;
  importedUnderlines: number;
  aiMarginNotes: number;
  lastPersonalAt: number | null;
  lastImportedAt: number | null;
};

function activityCount(row: ActivityRow) {
  return (
    row.personalHighlights +
    row.personalUnderlines +
    row.notes +
    row.importedHighlights +
    row.importedUnderlines +
    row.aiMarginNotes
  );
}

async function boundedRows<T extends { _id: string }>(
  ctx: QueryCtx,
  source: AsyncIterable<T>,
): Promise<{ rows: T[]; partial: boolean }> {
  const rows: T[] = [];
  let bytes = 0;
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (rows.length <= ROW_LIMIT) {
      const row = await readReportingDocument(ctx, async () => {
        const next = await iterator.next();
        return next.done ? null : next.value;
      });
      if (!row) return { rows, partial: false };
      bytes += getDocumentSize(row);
      if (rows.length === ROW_LIMIT || bytes > SOURCE_BYTES)
        return { rows, partial: true };
      rows.push(row);
    }
  } catch (error) {
    // The shared reporting byte budget can run out on a row; keep the bounded
    // aggregate useful and disclose that the remaining source was not read.
    if (
      error instanceof ConvexError &&
      String(error.data).includes("read budget")
    )
      return { rows, partial: true };
    throw error;
  } finally {
    await iterator.return?.();
  }
  return { rows, partial: true };
}

function rowFor(rows: Map<Id<"articles">, ActivityRow>, id: Id<"articles">) {
  let row = rows.get(id);
  if (!row) {
    row = {
      personalHighlights: 0,
      personalUnderlines: 0,
      notes: 0,
      importedHighlights: 0,
      importedUnderlines: 0,
      aiMarginNotes: 0,
      lastPersonalAt: null,
      lastImportedAt: null,
    };
    rows.set(id, row);
  }
  return row;
}

function latest(
  row: ActivityRow,
  field: "lastPersonalAt" | "lastImportedAt",
  at: number,
) {
  row[field] = Math.max(row[field] ?? 0, at);
}

async function addValidatedOpens(
  ctx: QueryCtx,
  readerId: string,
  opened: Map<Id<"articles">, Set<string>>,
  rows: Map<Id<"articles">, ActivityRow>,
) {
  const articleIdsByAnnotation = new Map<string, Set<Id<"articles">>>();
  for (const [articleId, ids] of opened)
    for (const id of ids) {
      const articleIds = articleIdsByAnnotation.get(id) ?? new Set();
      articleIds.add(articleId);
      articleIdsByAnnotation.set(id, articleIds);
    }
  // Keep validation reads sequential so each one observes the shared byte cap.
  for (const [raw, articleIds] of articleIdsByAnnotation) {
    const annotationId = ctx.db.normalizeId("annotations", raw);
    if (!annotationId) continue;
    try {
      const annotation = await readReportingDocument(ctx, () =>
        ctx.db.get(annotationId),
      );
      if (
        annotation?.userId === readerId &&
        articleIds.has(annotation.articleId)
      )
        rowFor(rows, annotation.articleId).aiMarginNotes++;
    } catch (error) {
      if (
        error instanceof ConvexError &&
        String(error.data).includes("read budget")
      )
        return true;
      throw error;
    }
  }
  return false;
}

/** Personal marks and AI margin-note opens, kept as separate article measures. */
export async function readingEngagementData(
  ctx: QueryCtx,
  userId: string,
  timeZone: string,
  periodName: "month" | "30days" | "90days",
) {
  const period = roomPeriod(Date.now(), timeZone, periodName);
  const [marks, notes, visits, interactions] = await Promise.all([
    boundedRows(
      ctx,
      ctx.db
        .query("highlights")
        .withIndex("by_userId_and_createdAt", (q) =>
          q
            .eq("userId", userId)
            .gte("createdAt", period.start)
            .lt("createdAt", period.end),
        )
        .order("desc"),
    ),
    boundedRows(
      ctx,
      ctx.db
        .query("userNotes")
        .withIndex("by_user_created", (q) =>
          q
            .eq("userId", userId)
            .gte("createdAt", period.start)
            .lt("createdAt", period.end),
        )
        .order("desc"),
    ),
    boundedRows(
      ctx,
      ctx.db
        .query("readingActivity")
        .withIndex("by_user_started", (q) =>
          q
            .eq("userId", userId)
            .gte("startedAt", period.start)
            .lt("startedAt", period.end),
        )
        .order("desc"),
    ),
    boundedRows(
      ctx,
      ctx.db
        .query("articleInteractions")
        .withIndex("by_user_created", (q) =>
          q
            .eq("userId", userId)
            .gte("createdAt", period.start)
            .lt("createdAt", period.end),
        )
        .order("desc"),
    ),
  ]);

  const rows = new Map<Id<"articles">, ActivityRow>();
  for (const mark of marks.rows) {
    const row = rowFor(rows, mark.articleId);
    if (mark.source === "reader") {
      if (mark.kind === "highlight") row.importedHighlights++;
      else row.importedUnderlines++;
      latest(row, "lastImportedAt", mark.createdAt);
    } else {
      if (mark.kind === "highlight") row.personalHighlights++;
      else row.personalUnderlines++;
      latest(row, "lastPersonalAt", mark.createdAt);
    }
  }
  for (const note of notes.rows) {
    if (!note.contentPlain.trim()) continue;
    const row = rowFor(rows, note.articleId);
    row.notes++;
    latest(row, "lastPersonalAt", note.createdAt);
  }

  const opened = new Map<Id<"articles">, Set<string>>();
  for (const visit of visits.rows) {
    if (!visit.annotationsOpened.length) continue;
    const ids = opened.get(visit.articleId) ?? new Set<string>();
    for (const id of visit.annotationsOpened) ids.add(id);
    opened.set(visit.articleId, ids);
  }
  for (const interaction of interactions.rows) {
    if (!interaction.annotationsOpened?.length) continue;
    const ids = opened.get(interaction.articleId) ?? new Set<string>();
    for (const id of interaction.annotationsOpened) ids.add(id);
    opened.set(interaction.articleId, ids);
  }
  const opensPartial = await addValidatedOpens(ctx, userId, opened, rows);
  const candidates = [...rows.entries()]
    .filter(([, row]) => activityCount(row) > 0)
    .sort((a, b) => {
      return (
        activityCount(b[1]) - activityCount(a[1]) ||
        String(a[0]).localeCompare(String(b[0]))
      );
    });
  const metadataIsReady = await metadataReady(ctx, userId);
  const articles = [];
  const contextual = [];
  let contextPartial = false;
  // Stop hydrating as soon as the shared reporting budget is reached.
  for (const [articleId, activity] of candidates.slice(
    0,
    ARTICLE_CONTEXT_LIMIT,
  )) {
    try {
      const compact = await readReportingDocument(ctx, () =>
        ctx.db
          .query("articleMetadata")
          .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
          .unique(),
      );
      const article = compact
        ? compact.userId === userId
          ? compact
          : null
        : metadataIsReady
          ? null
          : await readReportingDocument(ctx, () => ctx.db.get(articleId));
      if (!article || article.userId !== userId) continue;
      const projection =
        "articleId" in article ? article : articleProjection(article);
      contextual.push({
        articleId,
        title: projection.title,
        wordCount: projection.wordCount ?? null,
        activity,
      });
    } catch (error) {
      if (
        error instanceof ConvexError &&
        String(error.data).includes("read budget")
      ) {
        contextPartial = true;
        break;
      }
      throw error;
    }
  }
  contextual.sort((a, b) => {
    return (
      activityCount(b.activity) - activityCount(a.activity) ||
      a.title.localeCompare(b.title) ||
      String(a.articleId).localeCompare(String(b.articleId))
    );
  });
  for (const { articleId, title, wordCount, activity } of contextual.slice(
    0,
    ARTICLES_SHOWN,
  )) {
    articles.push({
      articleId,
      title,
      wordCount,
      ...activity,
      personalMarksPerThousandWords:
        wordCount && wordCount > 0
          ? Math.round(
              ((activity.personalHighlights + activity.personalUnderlines) /
                wordCount) *
                1000 *
                10,
            ) / 10
          : null,
    });
  }
  return {
    period,
    articles,
    partial:
      marks.partial ||
      notes.partial ||
      visits.partial ||
      interactions.partial ||
      opensPartial ||
      contextPartial,
    articlesPartial: candidates.length > ARTICLES_SHOWN || contextPartial,
  };
}
