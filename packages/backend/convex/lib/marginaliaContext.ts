"use node";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { RecallItem } from "../marginaliaRecall";
import { type EmbeddingTarget, embedTexts } from "./embeddings";
import {
  clipRecallText,
  RECALL_BATCH_ROWS,
  RECALL_CONTEXT_BYTES,
  recallPool,
  textBytes,
} from "./marginaliaRecallBudget";
import { MAX_ARTICLE_CHARS, splitIntoSections } from "./readingSections";

export { MAX_ARTICLE_CHARS, splitIntoSections };

// Existing calibrated floors and per-family retrieval/selection budgets.
const families = [
  { table: "noteChunks", kind: "chunk", floor: 0.5, limit: 8, cap: 12 },
  { table: "articles", kind: "article", floor: 0.45, limit: 5, cap: 6 },
  { table: "userNotes", kind: "note", floor: 0.45, limit: 5, cap: 5 },
  { table: "highlights", kind: "highlight", floor: 0.45, limit: 5, cap: 5 },
  { table: "companionThreads", kind: "thread", floor: 0.45, limit: 5, cap: 5 },
] as const;
type Family = (typeof families)[number];
type Kind = Family["kind"] | "own";
type RecallCtx = Pick<ActionCtx, "runQuery" | "vectorSearch">;
interface Match {
  id: string;
  score: number;
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
  return clipRecallText(
    `“${section.split(/\s+/).slice(0, 8).join(" ")}…”`,
    512,
  );
}

async function searchAll(
  ctx: RecallCtx,
  userId: string,
  vectors: number[][],
  labels: string[],
) {
  const jobs = families.flatMap((family, familyIndex) =>
    vectors.map((vector, sectionIndex) => ({
      family,
      familyIndex,
      vector,
      sectionIndex,
    })),
  );
  // This is the ONLY search pool: all five families share its four slots.
  const results = await recallPool(jobs, (job) =>
    ctx.vectorSearch(
      // SAFETY: The tables share the embedding index and userId filter. Convex's
      // union signature cannot express that shared index/filter relationship.
      job.family.table as "noteChunks",
      "by_embedding",
      {
        vector: job.vector,
        limit: job.family.limit,
        filter: (q) => q.eq("userId", userId),
      },
    ),
  );
  const matches = families.map(() => new Map<string, Match>());
  // Input/rank order, NOT completion order, defines tie order and section labels.
  for (const [index, rows] of results.entries()) {
    const job = jobs[index];
    const target = matches[job.familyIndex];
    for (const row of rows) {
      if (row._score < job.family.floor) continue;
      const existing = target.get(row._id);
      if (existing) {
        existing.score = Math.max(existing.score, row._score);
        existing.sections.add(labels[job.sectionIndex]);
      } else
        target.set(row._id, {
          id: row._id,
          score: row._score,
          sections: new Set([labels[job.sectionIndex]]),
        });
    }
  }
  return matches.map((matches) =>
    [...matches.values()].sort((a, b) => b.score - a.score),
  );
}

function matchedNear(match: Match) {
  return `similarity ${match.score.toFixed(2)}; matches the article near ${[...match.sections].slice(0, 2).join(" and ")}`;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface Block {
  kind: Kind;
  score: number;
  source: string;
  text: string;
  clipped: boolean;
  path?: string;
  candidate?: LibraryCandidate;
}

const headings = {
  chunk: "## The reader's vault notes",
  article:
    "## Other articles in the reader's library\n\nA connection may cite one of these by its id, only when the link is specific.",
  note: "## The reader's own notes and reflections",
  highlight: "## Passages the reader marked in other articles",
  thread: "## What the reader asked about while reading other articles",
  own: "## What the reader has already done with this article",
} satisfies Record<Kind, string>;

/** Relevance decides inclusion across families; formatting keeps legacy order. */
function budgetContext(
  blocks: Block[],
  dates: string,
  activityOmitted: boolean,
) {
  // Reserve all headings/date/limit accounting, rather than clipping away
  // provenance or letting the first retrieval family spend the entire budget.
  let remaining = RECALL_CONTEXT_BYTES - 4096;
  const kept = new Set<Block>();
  for (const block of [...blocks].sort((a, b) => b.score - a.score)) {
    const bytes = textBytes(block.text) + 2;
    if (bytes > remaining) continue;
    kept.add(block);
    remaining -= bytes;
  }
  const selected = blocks.filter((block) => kept.has(block));
  const parts = [dates];
  for (const kind of [...families.map((f) => f.kind), "own"] as const) {
    const group = selected.filter((block) => block.kind === kind);
    if (group.length)
      parts.push(
        `${headings[kind]}\n\n${group.map((block) => block.text).join(kind === "own" ? "\n" : "\n\n")}`,
      );
    else if (kind === "chunk")
      parts.push(
        `${headings.chunk}\n\n${blocks.some((block) => block.kind === "chunk") ? "Related vault context omitted by the recalled-context budget." : "None are closely related."}`,
      );
  }
  const clipped = selected.filter((block) => block.clipped).length;
  const omitted = blocks.length - selected.length;
  if (clipped || omitted || activityOmitted)
    parts.push(
      `## Recall limits\n\nRecalled context budget: ${RECALL_CONTEXT_BYTES} UTF-8 bytes. ${clipped} included sources clipped; ${omitted} candidate sources omitted by relevance/size.${activityOmitted ? " Additional activity or oversized citation metadata omitted by bounded retrieval." : ""} Omitted text is not evidence of absence.`,
    );
  return { selected, contextText: parts.join("\n\n") };
}

export async function buildMarginaliaContext(
  ctx: RecallCtx,
  article: Doc<"articles"> & { content: string },
  /** Without one, the marginalia are written from the article alone. */
  embedder: EmbeddingTarget | null,
): Promise<{
  articleText: string;
  contextText: string;
  vaultPaths: string[];
  libraryCandidates: LibraryCandidate[];
  /** Stored source keys, unchanged kind:id:version contract. */
  sources: string[];
}> {
  const userId = article.userId;
  const authorize = () =>
    ctx.runQuery(internal.marginaliaRecall.authorize, {
      userId,
      articleId: article._id,
    });
  // Never spend provider work on a stale, foreign, disabled or deleting owner.
  if (!(await authorize()))
    throw new Error("Recall library or article is no longer available");
  const articleText = article.content.slice(0, MAX_ARTICLE_CHARS);
  const sections = splitIntoSections(articleText);
  const labels = sections.map(sectionLabel);
  const inputs = sections.map((section) => section.slice(0, 8000));
  const uniqueInputs = [...new Set(inputs)];
  // One existing provider batch, with exact-input deduplication only.
  const uniqueVectors = embedder
    ? await embedTexts(embedder, uniqueInputs)
    : [];
  const vectors = embedder
    ? inputs.map((input) => uniqueVectors[uniqueInputs.indexOf(input)])
    : [];
  const matches = await searchAll(ctx, userId, vectors, labels);
  const blocks: Block[] = [];
  let activityOmitted = false;

  // Request-local compact title memoization; each miss reads one article in
  // its OWN transaction. No title/body amplification hidden in entity batches.
  type ArticleRecall = Awaited<ReturnType<typeof getArticle>>;
  function getArticle(articleId: Id<"articles">) {
    return ctx.runQuery(internal.marginaliaRecall.article, {
      userId,
      articleId,
    });
  }
  const titles = new Map<string, ArticleRecall>();
  async function titleFor(articleId: Id<"articles">) {
    if (titles.has(articleId)) return titles.get(articleId) ?? null;
    const result = await getArticle(articleId);
    titles.set(articleId, result);
    return result;
  }

  for (const [familyIndex, family] of families.entries()) {
    const ranked = matches[familyIndex].filter(
      (match) => match.id !== article._id,
    );
    if (family.kind === "article") {
      // Preserve the existing six nearest candidates, including the order.
      for (const match of ranked.slice(0, family.cap)) {
        // SAFETY: IDs originate from the articles vector index, not caller text.
        const found = await titleFor(match.id as Id<"articles">);
        if (!found?.searchable) continue;
        const candidate: LibraryCandidate = {
          id: found.id,
          title: found.title,
          minutes: found.minutes,
          excerpt: found.excerpt,
        };
        blocks.push({
          kind: "article",
          score: match.score,
          source: `article:${found.id}:${found.version}`,
          candidate,
          clipped: found.title.includes("[Context clipped]"),
          text: `--- Library article, id ${found.id}${found.minutes ? `, ${found.minutes} min` : ""} ---\n${found.title}\n${found.excerpt}`,
        });
      }
      continue;
    }
    const perNote = new Map<string, number>();
    let count = 0;
    for (let offset = 0; offset < ranked.length && count < family.cap; ) {
      const batch = ranked.slice(
        offset,
        offset + Math.min(RECALL_BATCH_ROWS, family.cap - count),
      );
      offset += batch.length;
      // Each ID comes from the corresponding table's vector index.
      const refs = batch.map((match) => {
        switch (family.kind) {
          case "chunk":
            // SAFETY: This ID came from the noteChunks vector index; the query validates its table.
            return { kind: family.kind, id: match.id as Id<"noteChunks"> };
          case "note":
            // SAFETY: This ID came from the userNotes vector index; the query validates its table.
            return { kind: family.kind, id: match.id as Id<"userNotes"> };
          case "highlight":
            // SAFETY: This ID came from the highlights vector index; the query validates its table.
            return { kind: family.kind, id: match.id as Id<"highlights"> };
          case "thread":
            // SAFETY: This ID came from the companionThreads vector index; the query validates its table.
            return {
              kind: family.kind,
              id: match.id as Id<"companionThreads">,
            };
        }
        throw new Error("Unexpected recall source family");
      });
      const items: RecallItem[] = await ctx.runQuery(
        internal.marginaliaRecall.hydrate,
        { userId, refs },
      );
      for (const match of batch) {
        const item = items.find((item) => item.id === match.id);
        if (!item) {
          activityOmitted = true;
          continue;
        }
        let header: string;
        if (item.filePath !== null) {
          const prior = perNote.get(item.filePath) ?? 0;
          if (prior >= 2) continue;
          perNote.set(item.filePath, prior + 1);
          header = `--- Vault note: ${item.filePath} (${matchedNear(match)}) ---`;
        } else {
          if (!item.articleId || item.articleId === article._id) continue;
          const parent = await titleFor(item.articleId);
          if (!parent) {
            activityOmitted = true;
            continue;
          }
          header =
            family.kind === "thread"
              ? `--- In "${parent.title}" (${matchedNear(match)}) ---`
              : `--- ${item.verb}${family.kind === "highlight" ? " in" : ""} "${parent.title}" (${matchedNear(match)}) ---`;
        }
        blocks.push({
          kind: family.kind,
          score: match.score,
          source: item.source,
          text: `${header}\n${item.body}`,
          clipped: item.clipped,
          path: item.filePath ?? undefined,
        });
        count++;
      }
    }
  }

  // Separate transactions per family/page: Convex permits one paginate call
  // per function, including empty results. No collect-then-slice history reads.
  for (const [query, limit] of [
    [internal.marginaliaRecall.ownHighlights, 10],
    [internal.marginaliaRecall.ownNotes, 10],
    [internal.marginaliaRecall.ownThreads, 8],
  ] as const) {
    let cursor: string | null = null;
    let count = 0;
    let isDone = false;
    for (let page = 0; page < limit && count < limit; page++) {
      const result: {
        items: RecallItem[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(query, {
        userId,
        articleId: article._id,
        cursor,
        limit: limit - count,
      });
      for (const item of result.items) {
        // Same-article activity has direct relevance (1), not an invented
        // vector similarity. Preserve source-version keys even when clipped.
        blocks.push({
          kind: "own",
          score: 1,
          source: item.source,
          text: `${item.source.startsWith("thread:") ? `--- In "${clipRecallText(article.title, 2048)}" ---\n` : item.source.startsWith("highlight:") ? `- ${item.verb}: ` : "- "}${item.body}`,
          clipped: item.clipped,
        });
        count++;
      }
      isDone = result.isDone;
      if (isDone) break;
      cursor = result.continueCursor;
    }
    if (!isDone) activityOmitted = true;
  }
  // Revocation during retrieval must not leave a usable private prompt.
  if (!(await authorize()))
    throw new Error("Recall library or article is no longer available");
  let host = "";
  try {
    host = new URL(article.url).hostname.replace(/^www\./, "");
  } catch {
    /* Missing source. */
  }
  const dates = [
    "## When and where",
    `Today: ${formatDate(Date.now())}`,
    `Published: ${article.publishedAt ? formatDate(article.publishedAt) : "unknown"}`,
    host ? `Source: ${clipRecallText(host, 512)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const { selected, contextText } = budgetContext(
    blocks,
    dates,
    activityOmitted,
  );
  if (textBytes(contextText) > RECALL_CONTEXT_BYTES)
    throw new Error("Recall context budget exceeded");
  return {
    articleText,
    contextText,
    vaultPaths: selected.flatMap((block) =>
      block.path !== undefined ? [block.path] : [],
    ),
    libraryCandidates: selected.flatMap((block) =>
      block.candidate ? [block.candidate] : [],
    ),
    sources: selected.map((block) => block.source),
  };
}
