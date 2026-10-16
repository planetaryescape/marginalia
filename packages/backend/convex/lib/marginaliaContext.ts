"use node";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { type EmbeddingTarget, embedTexts } from "./embeddings";
import { MAX_ARTICLE_CHARS, splitIntoSections } from "./readingSections";

export { MAX_ARTICLE_CHARS, splitIntoSections };

// Cosine similarity floors for text-embedding-3-small, calibrated on the
// vault: genuine matches score ~0.55–0.65, loose topical overlap ~0.5.
// Notes, highlights and questions are short, so they score a little lower.
const MIN_VAULT_SIMILARITY = 0.5;
const MIN_ACTIVITY_SIMILARITY = 0.45;

// Other articles in the library, by embedding. Uncalibrated: set from the vault
// floor, and worth revisiting once connections have been read in use.
const MIN_LIBRARY_SIMILARITY = 0.45;
const MAX_LIBRARY_CANDIDATES = 6;

const MAX_VAULT_CHUNKS = 12;
const MAX_CHUNKS_PER_NOTE = 2;
const MAX_ACTIVITY_ITEMS = 5;

type Searchable =
  | "articles"
  | "noteChunks"
  | "userNotes"
  | "highlights"
  | "companionThreads";

interface Match<T extends Searchable> {
  id: Id<T>;
  score: number;
  /** Opening words of the article sections this matched. */
  sections: Set<string>;
}

/** A library article the model may connect a passage to, cited by `id`. */
export interface LibraryCandidate {
  id: string;
  title: string;
  minutes: number | null;
  excerpt: string;
}

function sectionLabel(section: string) {
  return `“${section.split(/\s+/).slice(0, 8).join(" ")}…”`;
}

async function searchBySection<T extends Searchable>(
  ctx: ActionCtx,
  userId: string,
  table: T,
  vectors: number[][],
  labels: string[],
  limit: number,
  minScore: number,
): Promise<Match<T>[]> {
  const matches = new Map<string, Match<T>>();
  for (const [i, vector] of vectors.entries()) {
    // All four tables index `embedding` with a `userId` filter field; the cast
    // only helps TypeScript, which can't check the filter over a table union
    const results = await ctx.vectorSearch(
      table as "noteChunks",
      "by_embedding",
      {
        vector,
        limit,
        filter: (q) => q.eq("userId", userId),
      },
    );
    for (const result of results) {
      if (result._score < minScore) continue;
      const existing = matches.get(result._id);
      if (existing) {
        existing.score = Math.max(existing.score, result._score);
        existing.sections.add(labels[i]);
      } else {
        matches.set(result._id, {
          id: result._id as Id<T>,
          score: result._score,
          sections: new Set([labels[i]]),
        });
      }
    }
  }
  return [...matches.values()].sort((a, b) => b.score - a.score);
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function matchedNear(match: Match<Searchable>) {
  return `similarity ${match.score.toFixed(2)}; matches the article near ${[...match.sections].slice(0, 2).join(" and ")}`;
}

async function articleTitle(
  ctx: ActionCtx,
  userId: string,
  articleId: Id<"articles">,
  cache: Map<string, string>,
) {
  const cached = cache.get(articleId);
  if (cached) return cached;
  const article: Doc<"articles"> | null = await ctx.runQuery(
    internal.articles.getForReaderInternal,
    { articleId, userId },
  );
  const title = article?.title ?? "another article";
  cache.set(articleId, title);
  return title;
}

export async function buildMarginaliaContext(
  ctx: ActionCtx,
  article: Doc<"articles"> & { content: string },
  /** Without one, the marginalia are written from the article alone. */
  embedder: EmbeddingTarget | null,
): Promise<{
  articleText: string;
  contextText: string;
  vaultPaths: string[];
  libraryCandidates: LibraryCandidate[];
  /**
   * Every stored item the context drew on, as `kind:id:version`. A pass
   * compares these between runs to see whether this section's retrieval
   * changed (the precise gate).
   */
  sources: string[];
}> {
  // Everything recalled here comes from the article's own library
  const userId = article.userId;
  const articleText = article.content.slice(0, MAX_ARTICLE_CHARS);
  const sections = splitIntoSections(articleText);
  const labels = sections.map(sectionLabel);
  const vectors = embedder
    ? await embedTexts(
        embedder,
        sections.map((s) => s.slice(0, 8_000)),
      )
    : [];
  const titles = new Map<string, string>([[article._id, article.title]]);
  const parts: string[] = [];
  const sources: string[] = [];

  // Dates: lets context notes flag what may have changed since publication
  const source = (() => {
    try {
      return new URL(article.url).hostname.replace(/^www\./, "");
    } catch {
      return undefined;
    }
  })();
  parts.push(
    [
      "## When and where",
      `Today: ${formatDate(Date.now())}`,
      `Published: ${article.publishedAt ? formatDate(article.publishedAt) : "unknown"}`,
      source ? `Source: ${source}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  // Vault notes, searched per section, weak matches dropped
  const chunkMatches = await searchBySection(
    ctx,
    userId,
    "noteChunks",
    vectors,
    labels,
    8,
    MIN_VAULT_SIMILARITY,
  );
  const perNote = new Map<string, number>();
  const vaultBlocks: string[] = [];
  const vaultPaths: string[] = [];
  for (const match of chunkMatches) {
    if (vaultBlocks.length >= MAX_VAULT_CHUNKS) break;
    const chunk: Doc<"noteChunks"> | null = await ctx.runQuery(
      internal.noteChunks.getByIdInternal,
      { chunkId: match.id },
    );
    if (chunk?.userId !== userId) continue;
    const count = perNote.get(chunk.filePath) ?? 0;
    if (count >= MAX_CHUNKS_PER_NOTE) continue;
    perNote.set(chunk.filePath, count + 1);
    vaultPaths.push(chunk.filePath);
    sources.push(`chunk:${chunk._id}:${chunk.indexedAt}`);
    vaultBlocks.push(
      `--- Vault note: ${chunk.filePath} (${matchedNear(match)}) ---\n${chunk.content}`,
    );
  }
  parts.push(
    `## The reader's vault notes\n\n${vaultBlocks.length ? vaultBlocks.join("\n\n") : "None are closely related."}`,
  );

  // Other articles in the library, read or unread, as discovery (D-DES-040)
  const articleMatches = await searchBySection(
    ctx,
    userId,
    "articles",
    vectors,
    labels,
    5,
    MIN_LIBRARY_SIMILARITY,
  );
  const nearest = articleMatches
    .filter((match) => match.id !== article._id)
    .slice(0, MAX_LIBRARY_CANDIDATES);
  const found: LibraryCandidate[] = nearest.length
    ? await ctx.runQuery(internal.annotations.libraryCandidates, {
        userId,
        articleIds: nearest.map((match) => match.id),
      })
    : [];
  // The query drops anything outside this library; keep the similarity order
  const rank = new Map<string, number>(
    nearest.map((match, i) => [match.id, i]),
  );
  const libraryCandidates = found
    .filter((candidate) => candidate.id !== article._id)
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  for (const candidate of libraryCandidates)
    sources.push(`article:${candidate.id}`);
  if (libraryCandidates.length)
    parts.push(
      `## Other articles in the reader's library\n\nA connection may cite one of these by its id, only when the link is specific.\n\n${libraryCandidates
        .map(
          (c) =>
            `--- Library article, id ${c.id}${c.minutes ? `, ${c.minutes} min` : ""} ---\n${c.title}\n${c.excerpt}`,
        )
        .join("\n\n")}`,
    );

  // Reader activity on other articles: notes and reflections, highlights, questions
  const isElsewhere = (row: { userId: string; articleId: Id<"articles"> }) =>
    row.userId === userId && row.articleId !== article._id;

  const noteMatches = await searchBySection(
    ctx,
    userId,
    "userNotes",
    vectors,
    labels,
    5,
    MIN_ACTIVITY_SIMILARITY,
  );
  const noteBlocks: string[] = [];
  for (const match of noteMatches) {
    if (noteBlocks.length >= MAX_ACTIVITY_ITEMS) break;
    const note: Doc<"userNotes"> | null = await ctx.runQuery(
      internal.userNotes.getByIdInternal,
      {
        noteId: match.id,
      },
    );
    if (!note || !isElsewhere(note)) continue;
    sources.push(`note:${note._id}:${note.updatedAt}`);
    const title = await articleTitle(ctx, userId, note.articleId, titles);
    noteBlocks.push(
      [
        `--- From "${title}" (${matchedNear(match)}) ---`,
        note.selectedText ? `Highlighted: "${note.selectedText}"` : "",
        note.prompt ? `Responding to: ${note.prompt}` : "",
        `Their note: ${note.contentPlain}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (noteBlocks.length)
    parts.push(
      `## The reader's own notes and reflections\n\n${noteBlocks.join("\n\n")}`,
    );

  const highlightMatches = await searchBySection(
    ctx,
    userId,
    "highlights",
    vectors,
    labels,
    5,
    MIN_ACTIVITY_SIMILARITY,
  );
  const highlightBlocks: string[] = [];
  for (const match of highlightMatches) {
    if (highlightBlocks.length >= MAX_ACTIVITY_ITEMS) break;
    const row: Doc<"highlights"> | null = await ctx.runQuery(
      internal.highlights.getByIdInternal,
      {
        highlightId: match.id,
      },
    );
    if (!row || !isElsewhere(row)) continue;
    sources.push(`highlight:${row._id}:${row.createdAt}`);
    const title = await articleTitle(ctx, row.userId, row.articleId, titles);
    const verb = row.kind === "underline" ? "Underlined" : "Highlighted";
    highlightBlocks.push(
      `--- ${verb} in "${title}" (${matchedNear(match)}) ---\n"${row.text}"`,
    );
  }
  if (highlightBlocks.length) {
    parts.push(
      `## Passages the reader marked in other articles\n\n${highlightBlocks.join("\n\n")}`,
    );
  }

  const threadMatches = await searchBySection(
    ctx,
    userId,
    "companionThreads",
    vectors,
    labels,
    5,
    MIN_ACTIVITY_SIMILARITY,
  );
  const threadBlocks: string[] = [];
  for (const match of threadMatches) {
    if (threadBlocks.length >= MAX_ACTIVITY_ITEMS) break;
    const row: Doc<"companionThreads"> | null = await ctx.runQuery(
      internal.companionThreads.getByIdInternal,
      { threadId: match.id },
    );
    if (!row || !isElsewhere(row)) continue;
    sources.push(`thread:${row._id}:${row.updatedAt}`);
    threadBlocks.push(await formatThread(ctx, row, titles, matchedNear(match)));
  }
  if (threadBlocks.length) {
    parts.push(
      `## What the reader asked about while reading other articles\n\n${threadBlocks.join("\n\n")}`,
    );
  }

  // Re-annotating: what the reader has already done with this very article
  const [ownHighlights, ownThreads, ownNotes]: [
    Doc<"highlights">[],
    Doc<"companionThreads">[],
    Doc<"userNotes">[],
  ] = await Promise.all([
    ctx.runQuery(internal.highlights.listByArticleInternal, {
      articleId: article._id,
    }),
    ctx.runQuery(internal.companionThreads.listByArticleInternal, {
      articleId: article._id,
    }),
    ctx.runQuery(internal.userNotes.listByArticleInternal, {
      articleId: article._id,
    }),
  ]);
  for (const h of ownHighlights.slice(0, 10))
    sources.push(`highlight:${h._id}:${h.createdAt}`);
  for (const n of ownNotes.slice(0, 10))
    sources.push(`note:${n._id}:${n.updatedAt}`);
  for (const thread of ownThreads.slice(0, 8))
    sources.push(`thread:${thread._id}:${thread.updatedAt}`);
  const own: string[] = [
    ...ownHighlights
      .slice(0, 10)
      .map(
        (h) =>
          `- ${h.kind === "underline" ? "Underlined" : "Highlighted"}: "${h.text}"`,
      ),
    ...ownNotes
      .slice(0, 10)
      .map(
        (n) =>
          `- Note${n.selectedText ? ` on "${n.selectedText}"` : ""}${n.prompt ? ` (responding to: ${n.prompt})` : ""}: ${n.contentPlain}`,
      ),
  ];
  for (const thread of ownThreads.slice(0, 8)) {
    own.push(await formatThread(ctx, thread, titles));
  }
  if (own.length) {
    parts.push(
      `## What the reader has already done with this article\n\n${own.join("\n")}`,
    );
  }

  return {
    articleText,
    contextText: parts.join("\n\n"),
    vaultPaths,
    libraryCandidates,
    sources,
  };
}

async function formatThread(
  ctx: ActionCtx,
  row: Doc<"companionThreads">,
  titles: Map<string, string>,
  note?: string,
) {
  const title = await articleTitle(ctx, row.userId, row.articleId, titles);
  const verb = {
    ask: "Asked about",
    explain: "Asked to explain",
    simplify: "Asked to simplify",
    define: "Asked to define in context",
    article: "Asked about the article",
  }[row.mode];
  const answer = row.turns.find((t) => t.role === "assistant")?.content ?? "";
  const followUps = row.turns
    .filter((t) => t.role === "user")
    .map((t) => t.content);
  return [
    `--- In "${title}"${note ? ` (${note})` : ""} ---`,
    row.selection ? `${verb}: "${row.selection}"` : verb,
    row.question ? `Question: ${row.question}` : "",
    followUps.length ? `Follow-ups: ${followUps.join(" / ")}` : "",
    answer ? `Answer began: ${answer.split(/\n{2,}/)[0].slice(0, 300)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
