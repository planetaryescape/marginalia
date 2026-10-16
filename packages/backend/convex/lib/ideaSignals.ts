// What sits near an idea, signal by signal: links the reader drew, ideas on
// the same article, shared tags, Marginalia's connections. Every read is
// bounded. Each document carries a 1536-number embedding (~12KB), so the caps
// keep one graph read well under Convex's 16MB limit.
import type { Doc, Id } from "../_generated/dataModel";
import { KIND_FAMILIES } from "./annotationKinds";
import {
  articleReason,
  Candidates,
  connectionReason,
  fromArticleReason,
  linkedReason,
  nodeKey,
  type Reason,
  SIGNAL_SCORE,
  similarityReason,
  snippet,
  tagReason,
} from "./ideaGraph";
import { articleTitle, type Db, type LoadedNode, linkRow } from "./ideaNodes";

const LINKS_PER_NODE = 20;
const ITEMS_PER_ARTICLE = 12;
const TAGS_PER_ARTICLE = 10;
const TAGS_USED = 4;
const ARTICLES_PER_TAG = 5;
const CONNECTION_ANNOTATIONS = 60;

const CONNECTION_TYPES: readonly string[] = KIND_FAMILIES.connection;

/** The other end of each link the reader drew from or to a node, newest first. */
export async function linkedKeys(
  ctx: Db,
  userId: string,
  key: string,
  take: number,
) {
  const [out, into] = await Promise.all([
    ctx.db
      .query("ideaLinks")
      .withIndex("by_user_from_to", (q) =>
        q.eq("userId", userId).eq("from", key),
      )
      .order("desc")
      .take(take),
    ctx.db
      .query("ideaLinks")
      .withIndex("by_user_to", (q) => q.eq("userId", userId).eq("to", key))
      .order("desc")
      .take(take),
  ]);
  return [
    ...out.map((row) => ({ key: row.to, createdAt: row.createdAt })),
    ...into.map((row) => ({ key: row.from, createdAt: row.createdAt })),
  ]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((row) => row.key);
}

/** Keys of the reader's ideas written on one article, a few of each kind. */
export async function ideasOnArticle(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  per: { notes: number; highlights: number; answers: number },
): Promise<string[]> {
  const [notes, marks, threads] = await Promise.all([
    ctx.db
      .query("userNotes")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .order("desc")
      .take(ITEMS_PER_ARTICLE),
    ctx.db
      .query("highlights")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .order("desc")
      .take(ITEMS_PER_ARTICLE),
    ctx.db
      .query("companionThreads")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .order("desc")
      .take(ITEMS_PER_ARTICLE),
  ]);
  const mine = <T extends { userId: string }>(rows: T[]) =>
    rows.filter((row) => row.userId === userId);
  return [
    ...mine(notes)
      .slice(0, per.notes)
      .map((r) => nodeKey("note", r._id)),
    ...mine(marks)
      .slice(0, per.highlights)
      .map((r) => nodeKey("highlight", r._id)),
    ...mine(threads)
      .filter((r) => r.keptAt)
      .slice(0, per.answers)
      .map((r) => nodeKey("answer", r._id)),
  ];
}

/** Active tags on an article, with the rarest first: a rare tag says more. */
export async function activeTags(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
) {
  const rows = await ctx.db
    .query("articleTags")
    .withIndex("by_article", (q) => q.eq("articleId", articleId))
    .take(TAGS_PER_ARTICLE);
  const tags: Doc<"tags">[] = [];
  for (const row of rows) {
    if (row.userId !== userId) continue;
    const tag = await ctx.db.get("tags", row.tagId);
    if (tag && tag.userId === userId && tag.status === "active") tags.push(tag);
  }
  return tags.sort((a, b) => a.count - b.count);
}

/** Marginalia's connection notes on an article: which vault notes and articles it tied in. */
export async function connectionsOnArticle(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
) {
  const rows = await ctx.db
    .query("annotations")
    .withIndex("by_article", (q) => q.eq("articleId", articleId))
    .take(CONNECTION_ANNOTATIONS);
  return rows.filter(
    (row) => row.userId === userId && CONNECTION_TYPES.includes(row.type),
  );
}

/** Gathers what sits near the centre from every signal except embeddings. */
export async function gatherCandidates(
  ctx: Db,
  userId: string,
  centre: LoadedNode,
  similar: string[],
) {
  const found = new Candidates(centre.key);

  for (const key of await linkedKeys(ctx, userId, centre.key, LINKS_PER_NODE))
    found.add(key, linkedReason());

  similar.forEach((key, rank) => {
    const reason = similarityReason();
    found.add(key, reason, SIGNAL_SCORE.similar - rank * 3);
  });

  if (centre.articleId) {
    const articleId = centre.articleId;
    const title = await articleTitle(ctx, userId, articleId);
    // A note on an article brings the article itself onto the map
    if (centre.kind !== "article")
      found.add(nodeKey("article", articleId), fromArticleReason(), 80);
    for (const key of await ideasOnArticle(ctx, userId, articleId, {
      notes: 8,
      highlights: 8,
      answers: 8,
    }))
      found.add(
        key,
        centre.kind === "article" ? fromArticleReason() : articleReason(title),
      );

    for (const row of await connectionsOnArticle(ctx, userId, articleId)) {
      if (row.noteChunkId)
        found.add(
          nodeKey("vault", row.noteChunkId),
          connectionReason("this article to this vault note"),
        );
      else if (row.articleRefId) {
        const other = await articleTitle(ctx, userId, row.articleRefId);
        for (const key of await ideasOnArticle(ctx, userId, row.articleRefId, {
          notes: 2,
          highlights: 1,
          answers: 1,
        }))
          found.add(
            key,
            connectionReason(
              other
                ? `this article with “${snippet(other, 50)}”`
                : "two articles",
            ),
          );
      }
    }

    const tags = (await activeTags(ctx, userId, articleId)).slice(0, TAGS_USED);
    for (const tag of tags) {
      const rows = await ctx.db
        .query("articleTags")
        .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
        .order("desc")
        .take(ARTICLES_PER_TAG + 1);
      const others = rows
        .filter((row) => row.userId === userId && row.articleId !== articleId)
        .slice(0, ARTICLES_PER_TAG);
      for (const row of others)
        for (const key of await ideasOnArticle(ctx, userId, row.articleId, {
          notes: 2,
          highlights: 1,
          answers: 1,
        }))
          found.add(key, tagReason(tag.name));
    }
  } else if (centre.kind === "vault") {
    const rows = await ctx.db
      .query("annotations")
      .withIndex("by_note_chunk", (q) =>
        q.eq("noteChunkId", centre.id as Id<"noteChunks">),
      )
      .take(10);
    for (const row of rows) {
      if (row.userId !== userId) continue;
      const title = await articleTitle(ctx, userId, row.articleId);
      for (const key of await ideasOnArticle(ctx, userId, row.articleId, {
        notes: 3,
        highlights: 2,
        answers: 1,
      }))
        found.add(
          key,
          connectionReason(
            title ? `this note with “${snippet(title, 50)}”` : "this note",
          ),
        );
    }
  }
  return found;
}

/** Structural reasons for a pair, checked on the server before spending an AI call. */
export async function pairReasons(
  ctx: Db,
  userId: string,
  a: LoadedNode,
  b: LoadedNode,
): Promise<Reason[]> {
  const reasons: Reason[] = [];
  if (await linkRow(ctx, userId, a.key, b.key)) reasons.push(linkedReason());
  if (a.articleId && a.articleId === b.articleId)
    reasons.push(
      a.kind === "article" || b.kind === "article"
        ? fromArticleReason()
        : articleReason(await articleTitle(ctx, userId, a.articleId)),
    );
  if (a.articleId && b.articleId && a.articleId !== b.articleId) {
    const [tagsA, tagsB] = await Promise.all([
      activeTags(ctx, userId, a.articleId),
      activeTags(ctx, userId, b.articleId),
    ]);
    const shared = new Set(tagsB.map((tag) => tag._id));
    for (const tag of tagsA)
      if (shared.has(tag._id)) reasons.push(tagReason(tag.name));
  }
  for (const [mine, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (mine.articleId && other.kind === "vault") {
      const rows = await connectionsOnArticle(ctx, userId, mine.articleId);
      if (rows.some((row) => row.noteChunkId === other.id))
        reasons.push(connectionReason("this article to this vault note"));
    }
  }
  return reasons;
}
