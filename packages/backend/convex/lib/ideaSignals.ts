// What sits near an idea, signal by signal: links the reader drew, ideas on
// the same article, shared tags, Marginalia's connections. Every read asks the
// graph's read budget first (lib/ideaGraph.ts#ReadBudget), and takes only the
// documents the caller needs.
import type { Doc, Id } from "../_generated/dataModel";
import { KIND_FAMILIES } from "./annotationKinds";
import {
  articleReason,
  Candidates,
  connectionReason,
  fromArticleReason,
  linkedReason,
  nodeKey,
  type ReadBudget,
  type Reason,
  SIGNAL_SCORE,
  similarityReason,
  snippet,
  tagReason,
  UNLIMITED,
} from "./ideaGraph";
import {
  articleCleanupPending,
  articleTitle,
  type Db,
  type LoadedNode,
  linkRow,
} from "./ideaNodes";

const LINKS_PER_NODE = 10;
const TAGS_PER_ARTICLE = 6;
const TAGS_USED = 3;
const ARTICLES_PER_TAG = 4;
const CONNECTION_ANNOTATIONS = 20;
// A kept answer is found among an article's threads, some of which were never kept
const THREADS_PER_ANSWER = 2;

const CONNECTION_TYPES: readonly string[] = KIND_FAMILIES.connection;

/** Raw article reads shared by one buildGraph transaction, never node-specific
 * links, exclusions, scores, reasons or vault passages. The budget is bound as
 * well as the reader and database: a denied read is not canonical absence. */
export class RequestArticleReads {
  private readonly titles = new Map<Id<"articles">, Promise<string | null>>();
  private readonly ideas = new Map<string, Promise<string[]>>();
  private readonly connections = new Map<
    Id<"articles">,
    ReturnType<typeof connectionsOnArticle>
  >();
  private readonly tags = new Map<
    Id<"articles">,
    ReturnType<typeof activeTags>
  >();
  private readonly taggedArticles = new Map<
    Id<"tags">,
    Promise<Doc<"articleTags">[]>
  >();

  constructor(
    private readonly ctx: Db,
    private readonly userId: string,
    private readonly budget: ReadBudget,
  ) {}

  matches(ctx: Db, userId: string, budget: ReadBudget) {
    return (
      ctx.db === this.ctx.db && userId === this.userId && budget === this.budget
    );
  }

  title(articleId: Id<"articles">): Promise<string | null> {
    const known = this.titles.get(articleId);
    // A known title remains usable after the physical whole-article cap is spent.
    if (known) return known;
    if (!this.budget.mayReadArticle) return Promise.resolve(null);
    const read = articleTitle(this.ctx, this.userId, articleId, this.budget);
    this.titles.set(articleId, read);
    return read;
  }

  onArticle(
    articleId: Id<"articles">,
    per: { notes: number; highlights: number; answers: number },
  ): Promise<string[]> {
    const key = JSON.stringify([
      articleId,
      per.notes,
      per.highlights,
      per.answers,
    ]);
    const known = this.ideas.get(key);
    if (known) return known;
    if (this.budget.allow(1) === 0) return Promise.resolve([]);
    const read = ideasOnArticle(
      this.ctx,
      this.userId,
      articleId,
      per,
      this.budget,
    );
    this.ideas.set(key, read);
    return read;
  }

  connectionsOn(articleId: Id<"articles">) {
    let read = this.connections.get(articleId);
    if (!read) {
      if (this.budget.allow(1) === 0) return Promise.resolve([]);
      read = connectionsOnArticle(
        this.ctx,
        this.userId,
        articleId,
        this.budget,
      );
      this.connections.set(articleId, read);
    }
    return read;
  }

  activeTagsOn(articleId: Id<"articles">) {
    let read = this.tags.get(articleId);
    if (!read) {
      if (this.budget.allow(1) === 0) return Promise.resolve([]);
      read = activeTags(this.ctx, this.userId, articleId, this.budget);
      this.tags.set(articleId, read);
    }
    return read;
  }

  articlesWithTag(tagId: Id<"tags">) {
    let read = this.taggedArticles.get(tagId);
    if (!read) {
      if (this.budget.allow(1) === 0) return Promise.resolve([]);
      read = articlesWithTag(this.ctx, tagId, this.budget);
      this.taggedArticles.set(tagId, read);
    }
    return read;
  }
}

function articlesWithTag(ctx: Db, tagId: Id<"tags">, budget: ReadBudget) {
  return budget.take(ARTICLES_PER_TAG + 1, (limit) =>
    ctx.db
      .query("articleTags")
      .withIndex("by_tag", (q) => q.eq("tagId", tagId))
      .order("desc")
      .take(limit),
  );
}

/** The other end of each link the reader drew from or to a node, newest first. */
export async function linkedKeys(
  ctx: Db,
  userId: string,
  key: string,
  take: number,
  budget: ReadBudget = UNLIMITED,
) {
  const out = await budget.take(take, (limit) =>
    ctx.db
      .query("ideaLinks")
      .withIndex("by_user_from_to", (q) =>
        q.eq("userId", userId).eq("from", key),
      )
      .order("desc")
      .take(limit),
  );
  const into = await budget.take(take, (limit) =>
    ctx.db
      .query("ideaLinks")
      .withIndex("by_user_to", (q) => q.eq("userId", userId).eq("to", key))
      .order("desc")
      .take(limit),
  );
  return [
    ...out.map((row) => ({ key: row.to, createdAt: row.createdAt })),
    ...into.map((row) => ({ key: row.from, createdAt: row.createdAt })),
  ]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((row) => row.key);
}

/**
 * Keys of the reader's ideas written on one article, as many of each kind as
 * the caller needs and no more: each read takes exactly that many documents,
 * and a kind that isn't wanted isn't read at all.
 */
export async function ideasOnArticle(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  per: { notes: number; highlights: number; answers: number },
  budget: ReadBudget = UNLIMITED,
): Promise<string[]> {
  const keys: string[] = [];
  if (per.notes > 0) {
    const rows = await budget.take(per.notes, (limit) =>
      ctx.db
        .query("userNotes")
        .withIndex("by_article", (q) => q.eq("articleId", articleId))
        .order("desc")
        .take(limit),
    );
    for (const row of rows)
      if (row.userId === userId) keys.push(nodeKey("note", row._id));
  }
  if (per.highlights > 0) {
    const rows = await budget.take(per.highlights, (limit) =>
      ctx.db
        .query("highlights")
        .withIndex("by_article", (q) => q.eq("articleId", articleId))
        .order("desc")
        .take(limit),
    );
    for (const row of rows)
      if (row.userId === userId) keys.push(nodeKey("highlight", row._id));
  }
  if (per.answers > 0) {
    const rows = await budget.take(per.answers * THREADS_PER_ANSWER, (limit) =>
      ctx.db
        .query("companionThreads")
        .withIndex("by_article", (q) => q.eq("articleId", articleId))
        .order("desc")
        .take(limit),
    );
    let kept = 0;
    for (const row of rows)
      if (row.userId === userId && row.keptAt && kept++ < per.answers)
        keys.push(nodeKey("answer", row._id));
  }
  return keys;
}

/** Active tags on an article, with the rarest first: a rare tag says more. */
export async function activeTags(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  budget: ReadBudget = UNLIMITED,
) {
  const rows = await budget.take(TAGS_PER_ARTICLE, (limit) =>
    ctx.db
      .query("articleTags")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .take(limit),
  );
  const tags: Doc<"tags">[] = [];
  for (const row of rows) {
    if (row.userId !== userId || budget.allow(1) === 0) continue;
    budget.spend(1);
    const tag = await ctx.db.get("tags", row.tagId);
    budget.charge(tag);
    if (tag && tag.userId === userId && tag.status === "active") tags.push(tag);
  }
  return tags.sort((a, b) => a.count - b.count);
}

/** Marginalia's connection notes on an article: which vault notes and articles it tied in. */
export async function connectionsOnArticle(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  budget: ReadBudget = UNLIMITED,
) {
  if (await articleCleanupPending(ctx, articleId, budget)) return [];
  const rows = await budget.take(CONNECTION_ANNOTATIONS, (limit) =>
    ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .take(limit),
  );
  return rows.filter(
    (row) => row.userId === userId && CONNECTION_TYPES.includes(row.type),
  );
}

/** Gathers what sits near the centre from every signal except embeddings. */
export async function gatherCandidates(
  ctx: Db,
  userId: string,
  centre: LoadedNode,
  similar: { key: string; via?: string }[],
  budget: ReadBudget = UNLIMITED,
  requestReads?: RequestArticleReads,
) {
  const found = new Candidates(centre.key);
  const reads = requestReads?.matches(ctx, userId, budget)
    ? requestReads
    : undefined;
  const titleFor = (articleId: Id<"articles">) =>
    reads
      ? reads.title(articleId)
      : articleTitle(ctx, userId, articleId, budget);
  const ideasFor = (
    articleId: Id<"articles">,
    per: { notes: number; highlights: number; answers: number },
  ) =>
    reads
      ? reads.onArticle(articleId, per)
      : ideasOnArticle(ctx, userId, articleId, per, budget);

  // Newest first, and each a little below the one before, so the idea just
  // written beside the centre outranks older links however many there are
  const linked = await linkedKeys(
    ctx,
    userId,
    centre.key,
    LINKS_PER_NODE,
    budget,
  );
  for (const [rank, key] of linked.entries())
    found.add(key, linkedReason(), SIGNAL_SCORE.linked - rank * 0.5);

  for (const [rank, hint] of similar.entries())
    found.add(
      hint.key,
      similarityReason(),
      SIGNAL_SCORE.similar - rank * 3,
      hint.via,
    );

  if (centre.articleId) {
    const articleId = centre.articleId;
    const title = await titleFor(articleId);
    // A note on an article brings the article itself onto the map
    if (centre.kind !== "article")
      found.add(nodeKey("article", articleId), fromArticleReason(), 80);
    for (const key of await ideasFor(
      articleId,
      // One more than the ring holds: the centre is among its own article's ideas
      { notes: 6, highlights: 6, answers: 4 },
    ))
      found.add(
        key,
        centre.kind === "article" ? fromArticleReason() : articleReason(title),
      );

    for (const row of await (reads
      ? reads.connectionsOn(articleId)
      : connectionsOnArticle(ctx, userId, articleId, budget))) {
      if (row.notePath)
        found.add(
          nodeKey("vault", row.notePath),
          connectionReason("this article to this vault note"),
          undefined,
          // A connection that names a passage keeps it
          row.noteChunkId,
        );
      else if (row.articleRefId) {
        const other = await titleFor(row.articleRefId);
        for (const key of await ideasFor(row.articleRefId, {
          notes: 2,
          highlights: 1,
          answers: 0,
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

    const tags = (
      await (reads
        ? reads.activeTagsOn(articleId)
        : activeTags(ctx, userId, articleId, budget))
    ).slice(0, TAGS_USED);
    for (const tag of tags) {
      // One more than used, because the centre's own article may be among them
      const rows = await (reads
        ? reads.articlesWithTag(tag._id)
        : articlesWithTag(ctx, tag._id, budget));
      const others = rows
        .filter((row) => row.userId === userId && row.articleId !== articleId)
        .slice(0, ARTICLES_PER_TAG);
      for (const row of others)
        for (const key of await ideasFor(row.articleId, {
          notes: 1,
          highlights: 1,
          answers: 0,
        }))
          found.add(key, tagReason(tag.name));
    }
  } else if (centre.kind === "vault") {
    const filePath = centre.filePath ?? "";
    const rows = await budget.take(5, (limit) =>
      ctx.db
        .query("annotations")
        .withIndex("by_user_note_path", (q) =>
          q.eq("userId", userId).eq("notePath", filePath),
        )
        .take(limit),
    );
    for (const row of rows) {
      if (row.userId !== userId) continue;
      if (await articleCleanupPending(ctx, row.articleId, budget)) continue;
      const title = await titleFor(row.articleId);
      for (const key of await ideasFor(row.articleId, {
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
  // A connection is written on one article but joins both ends, so look from each side
  for (const [mine, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (!mine.articleId) continue;
    const rows = await connectionsOnArticle(ctx, userId, mine.articleId);
    if (other.kind === "vault") {
      if (rows.some((row) => row.notePath === other.filePath))
        reasons.push(connectionReason("this article to this vault note"));
    } else if (other.articleId && other.articleId !== mine.articleId) {
      if (rows.some((row) => row.articleRefId === other.articleId))
        reasons.push(connectionReason("these two articles"));
    }
  }
  return reasons.filter(
    (reason, i) => reasons.findIndex((r) => r.text === reason.text) === i,
  );
}
