import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { type EmbeddingTarget, embedText } from "./embeddings";

export const libraryRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(12_000),
      }),
    )
    .max(20)
    .default([]),
});

export type LibraryRequest = z.infer<typeof libraryRequestSchema>;

const RATING_LABELS = ["Not for me", "Meh", "Fine", "Good", "Loved it"];
const MAX_ARTICLES = 40;

export const LIBRARY_SYSTEM = `You are the librarian of the reader's personal library in Marginalia, a reading app. The library holds everything they have saved or read, with their own impressions (rating, tags, a line on what stayed with them), notes, highlights and questions.

You help them:
- find things they half-remember ("that piece about cows last month"), using read dates, topics and their impressions
- recall how they felt about what they read ("what did I love in September?")
- choose what to read next from what they haven't read yet ("something about science", "I want to read about cars")

Rules:
- Use only the library items given. If nothing fits, say so plainly and suggest a different way to ask.
- Link every article you mention as [its title](/read/ID), using the id given in square brackets.
- When their impression or notes are relevant, mention them in their words ("you called it…", "you rated it Loved it").
- For recommendations, give 2–4 unread picks with one short line each on why it fits, and note the reading time.
- You can't change anything in the library. If they want to record how they felt about a piece, tell them to use the star on the article page.
- Start with a direct one-sentence answer. Stay under 160 words. No headings, no preamble.`;

function day(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * Picks the library items relevant to the question, by meaning and by recency,
 * and formats them with read status, dates and the reader's own impressions.
 */
export async function retrieveLibraryContext(
  ctx: ActionCtx,
  userId: string,
  question: string,
  embedder: EmbeddingTarget,
) {
  const vector = await embedText(embedder, question.slice(0, 4000));

  const [articleHits, impressionHits, noteHits, highlightHits, threadHits] =
    await Promise.all([
      ctx.vectorSearch("articles", "by_embedding", {
        vector,
        limit: 24,
        filter: (q) => q.eq("userId", userId),
      }),
      ctx.vectorSearch("impressions", "by_embedding", {
        vector,
        limit: 10,
        filter: (q) => q.eq("userId", userId),
      }),
      ctx.vectorSearch("userNotes", "by_embedding", {
        vector,
        limit: 8,
        filter: (q) => q.eq("userId", userId),
      }),
      ctx.vectorSearch("highlights", "by_embedding", {
        vector,
        limit: 8,
        filter: (q) => q.eq("userId", userId),
      }),
      ctx.vectorSearch("companionThreads", "by_embedding", {
        vector,
        limit: 6,
        filter: (q) => q.eq("userId", userId),
      }),
    ]);

  const activity: {
    impressions: Doc<"impressions">[];
    interactions: Doc<"articleInteractions">[];
  } = await ctx.runQuery(internal.library.recentActivity, { userId });

  const related: {
    impressions: Doc<"impressions">[];
    notes: Doc<"userNotes">[];
    highlights: Doc<"highlights">[];
    threads: Doc<"companionThreads">[];
  } = await ctx.runQuery(internal.library.loadMatches, {
    userId,
    impressionIds: impressionHits.map((h) => h._id),
    noteIds: noteHits.map((h) => h._id),
    highlightIds: highlightHits.map((h) => h._id),
    threadIds: threadHits.map((h) => h._id),
  });

  // Articles to describe: semantic matches first, then anything the reader's
  // own words point at, then recent rated reads (for "what did I love…")
  const order: Id<"articles">[] = [];
  const add = (id: Id<"articles">) => {
    if (!order.includes(id) && order.length < MAX_ARTICLES) order.push(id);
  };
  for (const hit of articleHits) add(hit._id);
  for (const row of [
    ...related.impressions,
    ...related.notes,
    ...related.highlights,
    ...related.threads,
  ]) {
    add(row.articleId);
  }
  for (const row of activity.impressions.slice(0, 15)) add(row.articleId);

  const articles: (Doc<"articles"> | null)[] = await ctx.runQuery(
    internal.library.loadArticles,
    {
      userId,
      articleIds: order,
    },
  );

  const impressionsByArticle = new Map(
    [...activity.impressions, ...related.impressions].map((row) => [
      row.articleId,
      row,
    ]),
  );
  const finishedAt = new Map<string, number>();
  const openedAt = new Map<string, number>();
  for (const i of activity.interactions) {
    if (i.action === "finished" && !finishedAt.has(i.articleId))
      finishedAt.set(i.articleId, i.createdAt);
    if (i.action === "opened" && !openedAt.has(i.articleId))
      openedAt.set(i.articleId, i.createdAt);
  }

  const blocks = articles.flatMap((article) => {
    if (!article) return [];
    const impression = impressionsByArticle.get(article._id);
    const finished = finishedAt.get(article._id);
    const opened = openedAt.get(article._id);
    const status = finished
      ? `read ${day(finished)}`
      : opened
        ? `started ${day(opened)}, not finished`
        : "unread";
    const meta = [
      article.author,
      host(article.url),
      `saved ${day(article.createdAt)}`,
      article.estimatedReadMinutes
        ? `${article.estimatedReadMinutes} min`
        : null,
      status,
    ]
      .filter(Boolean)
      .join(" · ");
    const lines = [`[${article._id}] "${article.title}" — ${meta}`];
    if (impression?.rating)
      lines.push(
        `  Their rating: ${RATING_LABELS[impression.rating - 1]} (${impression.rating}/5), given ${day(impression.updatedAt)}`,
      );
    if (impression?.tags.length)
      lines.push(`  Their tags: ${impression.tags.join(", ")}`);
    if (impression?.note)
      lines.push(`  What stayed with them: ${impression.note}`);
    for (const note of related.notes
      .filter((n) => n.articleId === article._id)
      .slice(0, 2)) {
      lines.push(`  Their note: ${note.contentPlain.slice(0, 240)}`);
    }
    for (const mark of related.highlights
      .filter((h) => h.articleId === article._id)
      .slice(0, 2)) {
      lines.push(`  They highlighted: "${mark.text.slice(0, 200)}"`);
    }
    for (const thread of related.threads
      .filter((t) => t.articleId === article._id)
      .slice(0, 2)) {
      lines.push(
        `  They asked: ${thread.question ?? `about "${thread.selection.slice(0, 120)}"`}`,
      );
    }
    if (article.excerpt)
      lines.push(`  Opens: ${article.excerpt.slice(0, 220)}`);
    return [lines.join("\n")];
  });

  const context = [
    `Today: ${day(Date.now())}`,
    "",
    "<library>",
    blocks.length ? blocks.join("\n\n") : "(nothing relevant found)",
    "</library>",
  ].join("\n");
  return {
    context,
    articles: articles.flatMap((article) =>
      article
        ? [
            {
              articleId: article._id,
              title: article.title,
              url: article.url,
              author: article.author ?? null,
              minutes: article.estimatedReadMinutes ?? null,
              status: finishedAt.has(article._id)
                ? "Read"
                : openedAt.has(article._id)
                  ? "Started"
                  : "Unread",
            },
          ]
        : [],
    ),
  };
}

export async function buildLibraryContext(
  ctx: ActionCtx,
  userId: string,
  question: string,
  embedder: EmbeddingTarget,
): Promise<string> {
  return (await retrieveLibraryContext(ctx, userId, question, embedder))
    .context;
}
