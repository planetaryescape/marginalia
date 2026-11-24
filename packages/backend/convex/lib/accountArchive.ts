import { z } from "zod";

const number = z.number().finite().nonnegative();
const sourceId = z.string().min(1).max(200);
const empty = z.array(z.unknown()).length(0);
const place = z.object({
  paragraphIndex: number.int().nullable().optional(),
  percent: number.max(100),
});
const article = z.object({
  _id: sourceId,
  userId: sourceId,
  guid: z.string().min(1),
  readerDocumentId: sourceId,
  url: z.string().min(1),
  title: z.string(),
  author: z.string().optional(),
  publishedAt: number.optional(),
  content: z.string().min(1),
  contentHtml: z.string(),
  excerpt: z.string().optional(),
  wordCount: number.int(),
  estimatedReadMinutes: number,
  imageUrl: z.string().optional(),
  createdAt: number,
  extractionStatus: z.literal("extracted"),
  annotationStatus: z.enum(["skipped", "deferred"]),
  skipReason: z.literal("no_provider").optional(),
});
const highlight = z.object({
  _id: sourceId,
  userId: sourceId,
  articleId: sourceId,
  kind: z.enum(["highlight", "underline"]),
  text: z.string().min(1),
  source: z.literal("reader"),
  readerHighlightId: sourceId,
  createdAt: number,
});
const interaction = z.object({
  _id: sourceId,
  userId: sourceId,
  articleId: sourceId,
  action: z.enum(["opened", "presented"]),
  createdAt: number,
});
export const archivePreferences = z.strictObject({
  speechVoice: z.string().min(1).max(200),
  bibleEnabled: z.boolean(),
  bibleTranslation: z.literal("web"),
  readingScope: z.enum(["articles", "mixed", "bible"]),
});
const entry = z.object({
  articleId: sourceId,
  article,
  relations: z.object({
    "annotations:listByArticle": empty,
    "summaries:getByArticle": z.null(),
    "reflections:getByArticle": z.null(),
    "impressions:getByArticle": z.null(),
    "companionThreads:listByArticle": empty,
    "readingActivity:furthestPlace": place,
    "scriptureStudy:listByArticle": z.null(),
  }),
});
const archive = z.object({
  format: z.literal("marginalia-account-export"),
  version: z.literal(1),
  source: z.url(),
  completedAt: z.iso.datetime(),
  data: z.object({
    articles: z.array(entry).min(1),
    fullHighlights: z.array(
      z.object({ articleId: sourceId, rows: z.array(highlight).max(500) }),
    ),
    "highlights:listMine": z.array(
      highlight.pick({
        _id: true,
        articleId: true,
        kind: true,
        text: true,
        createdAt: true,
      }),
    ),
    "sessions:listRecentInteractions": z.array(interaction),
    "feeds:list": empty,
    "providerCredentials:list": empty,
    "impressions:listRecent": empty,
    "savedArticles:page": empty,
    "lovedArticles:page": empty,
    "userNotes:listPreviews": empty,
    "companionThreads:listKeptPreviews": empty,
    "dictionary:page": empty,
    "scriptureKeeps:page": empty,
    notes: empty,
    "userSettings:getModels": z.object({
      selected: z.object({
        annotations: z.null(),
        deep: z.null(),
        quick: z.null(),
      }),
    }),
    "userSettings:getSpeechVoice": z.object({
      selected: z.string().min(1).max(200),
    }),
    "bible:preferences": z.object({
      enabled: z.boolean(),
      scope: z.enum(["articles", "mixed", "bible"]),
      translation: z.literal("web"),
    }),
  }),
});

export const archiveItem = z.strictObject({
  source: z.url(),
  archiveHash: z.string().regex(/^[a-f0-9]{64}$/u),
  capturedAt: number,
  article,
  highlights: z.array(highlight).max(500),
  interactions: z.array(interaction).max(100),
  place,
});
export type ArchiveItem = z.infer<typeof archiveItem>;

export function parseAccountArchive(input: unknown, archiveHash: string) {
  const parsed = archive.safeParse(input);
  if (!parsed.success)
    return { ok: false, reason: "unsupported-export-shape" } as const;
  const { data, source, completedAt } = parsed.data;
  const articles = new Map(data.articles.map((a) => [a.articleId, a]));
  const highlights = data.fullHighlights.flatMap((group) => group.rows);
  const sourceUsers = new Set(data.articles.map((a) => a.article.userId));
  if (
    articles.size !== data.articles.length ||
    sourceUsers.size !== 1 ||
    data.articles.some((a) => a.articleId !== a.article._id) ||
    data.fullHighlights.some((g) =>
      g.rows.some((h) => h.articleId !== g.articleId),
    ) ||
    [...highlights, ...data["sessions:listRecentInteractions"]].some(
      (row) => !articles.has(row.articleId) || !sourceUsers.has(row.userId),
    ) ||
    new Set(highlights.map((h) => h._id)).size !== highlights.length ||
    new Set(highlights.map((h) => h.readerHighlightId)).size !==
      highlights.length ||
    highlights.length !== data["highlights:listMine"].length
  )
    return { ok: false, reason: "inconsistent-export-identities" } as const;
  const presented = new Map(data["highlights:listMine"].map((h) => [h._id, h]));
  if (
    highlights.some((h) => {
      const other = presented.get(h._id);
      return (
        !other ||
        other.articleId !== h.articleId ||
        other.text !== h.text ||
        other.kind !== h.kind ||
        other.createdAt !== h.createdAt
      );
    })
  )
    return {
      ok: false,
      reason: "inconsistent-highlight-presentations",
    } as const;
  const items = data.articles.map((a) =>
    archiveItem.parse({
      source,
      archiveHash,
      capturedAt: Date.parse(completedAt),
      article: a.article,
      highlights: highlights.filter((h) => h.articleId === a.articleId),
      interactions: data["sessions:listRecentInteractions"].filter(
        (i) => i.articleId === a.articleId,
      ),
      place: a.relations["readingActivity:furthestPlace"],
    }),
  );
  const bible = data["bible:preferences"];
  const preferences = archivePreferences.parse({
    speechVoice: data["userSettings:getSpeechVoice"].selected,
    bibleEnabled: bible.enabled,
    bibleTranslation: bible.translation,
    readingScope: bible.scope,
  });
  return { ok: true, items, preferences } as const;
}
