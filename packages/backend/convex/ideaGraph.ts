// The idea graph (rung 5d): a small local map around one idea, built from what
// already exists. Every read is bounded per signal, and the result never
// exceeds MAX_NODES ideas.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { KIND_FAMILIES } from "./lib/annotationKinds";
import {
  articleReason,
  Candidates,
  connectionReason,
  FIRST_RING,
  linkedReason,
  MAX_NODES,
  type NodeKind,
  nodeKey,
  pairFingerprint,
  pairKey,
  parseKey,
  type Reason,
  SIGNAL_SCORE,
  similarityReason,
  snippet,
  tagReason,
} from "./lib/ideaGraph";

type Db = Pick<QueryCtx, "db">;

// Caps per signal. Each document carries a 1536-number embedding (~12KB), so
// these keep one graph read well under Convex's 16MB limit.
const LINKS_PER_NODE = 20;
const ITEMS_PER_ARTICLE = 12;
const TAGS_PER_ARTICLE = 10;
const TAGS_USED = 4;
const ARTICLES_PER_TAG = 5;
const CONNECTION_ANNOTATIONS = 60;
const HINTS_USED = 12;
const CANDIDATES_LOADED = FIRST_RING * 2;

const CONNECTION_TYPES: readonly string[] = KIND_FAMILIES.connection;

export interface LoadedNode {
  key: string;
  kind: NodeKind;
  id: string;
  articleId?: Id<"articles">;
  label: string;
  text: string;
  createdAt: number;
  /** For a vault note: its file, so chunks of one file show once. */
  filePath?: string;
}

/** The node a key names, or null when it is gone or belongs to someone else. */
export async function loadNode(
  ctx: Db,
  userId: string,
  key: string,
): Promise<LoadedNode | null> {
  const ref = parseKey(key);
  if (!ref) return null;
  const { db } = ctx;
  switch (ref.kind) {
    case "note": {
      const id = db.normalizeId("userNotes", ref.id);
      const row = id && (await db.get("userNotes", id));
      if (!row || row.userId !== userId) return null;
      return {
        key,
        kind: "note",
        id: row._id,
        articleId: row.articleId,
        label: snippet(row.contentPlain || row.selectedText, 70),
        text: row.contentPlain,
        createdAt: row.createdAt,
      };
    }
    case "highlight": {
      const id = db.normalizeId("highlights", ref.id);
      const row = id && (await db.get("highlights", id));
      if (!row || row.userId !== userId) return null;
      return {
        key,
        kind: "highlight",
        id: row._id,
        articleId: row.articleId,
        label: snippet(row.text, 70),
        text: row.text,
        createdAt: row.createdAt,
      };
    }
    case "answer": {
      const id = db.normalizeId("companionThreads", ref.id);
      const row = id && (await db.get("companionThreads", id));
      // Only answers the reader chose to keep are ideas of theirs
      if (!row || row.userId !== userId || !row.keptAt) return null;
      const reply = [...row.turns]
        .reverse()
        .find((t) => t.role === "assistant");
      return {
        key,
        kind: "answer",
        id: row._id,
        articleId: row.articleId,
        label: snippet(
          row.question || row.selection || reply?.content || "",
          70,
        ),
        text: [row.selection, reply?.content].filter(Boolean).join("\n\n"),
        createdAt: row.keptAt,
      };
    }
    case "vault": {
      const id = db.normalizeId("noteChunks", ref.id);
      const row = id && (await db.get("noteChunks", id));
      if (!row || row.userId !== userId) return null;
      return {
        key,
        kind: "vault",
        id: row._id,
        label: snippet(row.fileName.replace(/\.md$/i, ""), 70),
        text: row.content,
        createdAt: row.indexedAt,
        filePath: row.filePath,
      };
    }
  }
}

async function latestNode(ctx: Db, userId: string) {
  const row = await ctx.db
    .query("userNotes")
    .withIndex("by_user_recent", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  return row ? loadNode(ctx, userId, nodeKey("note", row._id)) : null;
}

/** The other end of each link the reader drew from or to a node, newest first. */
async function linkedKeys(ctx: Db, userId: string, key: string, take: number) {
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
async function ideasOnArticle(
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

async function articleTitle(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
): Promise<string | null> {
  const article = await ctx.db.get("articles", articleId);
  return article && article.userId === userId ? article.title : null;
}

/** Active tags on an article, with the rarest first: a rare tag says more. */
async function activeTags(ctx: Db, userId: string, articleId: Id<"articles">) {
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
async function connectionsOnArticle(
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
async function gatherCandidates(
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
    for (const key of await ideasOnArticle(ctx, userId, articleId, {
      notes: 8,
      highlights: 8,
      answers: 8,
    }))
      found.add(key, articleReason(title));

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

export interface GraphNode {
  key: string;
  kind: NodeKind;
  label: string;
  /** 0 is the centre, 1 its neighbours, 2 the faint ring beyond. */
  hop: 0 | 1 | 2;
  createdAt: number;
}
export interface GraphEdge {
  id: string;
  a: string;
  b: string;
  reasons: Reason[];
  /** True when only embeddings found it, so the reason is generated on selection. */
  needsAi: boolean;
}
export interface Graph {
  centre: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const EMPTY: Graph = { centre: null, nodes: [], edges: [] };

const view = (node: LoadedNode, hop: 0 | 1 | 2): GraphNode => ({
  key: node.key,
  kind: node.kind,
  label: node.label,
  hop,
  createdAt: node.createdAt,
});

/**
 * The centre, its best neighbours and a few second-ring ideas. `similar` is
 * the embedding signal: vector search only runs in actions, so the client asks
 * ideaNeighbours.similar first and hands the keys back. Each is checked to be
 * the reader's own before it counts.
 */
export const graph = query({
  args: {
    centre: v.optional(v.string()),
    similar: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<Graph> => {
    const userId = ctx.readerId;
    const centre =
      (args.centre ? await loadNode(ctx, userId, args.centre) : null) ??
      (await latestNode(ctx, userId));
    if (!centre) return EMPTY;

    const found = await gatherCandidates(
      ctx,
      userId,
      centre,
      (args.similar ?? []).slice(0, HINTS_USED),
    );

    const nodes: GraphNode[] = [view(centre, 0)];
    const edges: GraphEdge[] = [];
    const shown = new Map<string, LoadedNode>([[centre.key, centre]]);
    const files = new Set<string>(centre.filePath ? [centre.filePath] : []);
    const ring: LoadedNode[] = [];

    for (const candidate of found.ranked(CANDIDATES_LOADED)) {
      if (ring.length >= FIRST_RING) break;
      const node = await loadNode(ctx, userId, candidate.key);
      if (!node) continue;
      // Several chunks of one vault file are one idea
      if (node.filePath) {
        if (files.has(node.filePath)) continue;
        files.add(node.filePath);
      }
      ring.push(node);
      shown.set(node.key, node);
      nodes.push(view(node, 1));
      edges.push({
        id: pairKey(centre.key, node.key),
        a: centre.key,
        b: node.key,
        reasons: candidate.reasons,
        needsAi: candidate.reasons.every((r) => r.type === "similar"),
      });
    }

    // One idea further out from each neighbour, by the cheap signals only
    const edgeIds = new Set(edges.map((edge) => edge.id));
    for (const near of ring) {
      const nearLinks = await linkedKeys(ctx, userId, near.key, 4);
      // A link between two ideas already on the map is a line worth drawing
      for (const key of nearLinks) {
        const id = pairKey(near.key, key);
        if (shown.has(key) && key !== centre.key && !edgeIds.has(id)) {
          edgeIds.add(id);
          edges.push({
            id,
            a: near.key,
            b: key,
            reasons: [linkedReason()],
            needsAi: false,
          });
        }
      }
      if (nodes.length >= MAX_NODES) continue;

      const sameArticle = near.articleId
        ? await ideasOnArticle(ctx, userId, near.articleId, {
            notes: 8,
            highlights: 8,
            answers: 2,
          })
        : [];
      const title = near.articleId
        ? await articleTitle(ctx, userId, near.articleId)
        : null;
      const options: { key: string; reason: Reason }[] = [
        ...nearLinks.map((key) => ({ key, reason: linkedReason() })),
        ...sameArticle.map((key) => ({ key, reason: articleReason(title) })),
      ];
      for (const option of options) {
        if (shown.has(option.key)) continue;
        const node = await loadNode(ctx, userId, option.key);
        if (!node) continue;
        if (node.filePath) {
          if (files.has(node.filePath)) continue;
          files.add(node.filePath);
        }
        shown.set(node.key, node);
        nodes.push(view(node, 2));
        edges.push({
          id: pairKey(near.key, node.key),
          a: near.key,
          b: node.key,
          reasons: [option.reason],
          needsAi: false,
        });
        break;
      }
    }

    const kept = nodes.slice(0, MAX_NODES);
    const keys = new Set(kept.map((n) => n.key));
    return {
      centre: centre.key,
      nodes: kept,
      edges: edges.filter((e) => keys.has(e.a) && keys.has(e.b)),
    };
  },
});

export interface SearchHit {
  key: string;
  kind: NodeKind;
  label: string;
}

/** Finds an idea to start from, across the four kinds. */
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args): Promise<SearchHit[]> => {
    const text = args.query.trim().slice(0, 200);
    if (text.length < 2) return [];
    const userId = ctx.readerId;
    const [notes, marks, threads, chunks] = await Promise.all([
      ctx.db
        .query("userNotes")
        .withSearchIndex("search_content", (q) =>
          q.search("contentPlain", text).eq("userId", userId),
        )
        .take(5),
      ctx.db
        .query("highlights")
        .withSearchIndex("search_text", (q) =>
          q.search("text", text).eq("userId", userId),
        )
        .take(4),
      ctx.db
        .query("companionThreads")
        .withSearchIndex("search_selection", (q) =>
          q.search("selection", text).eq("userId", userId),
        )
        .take(4),
      ctx.db
        .query("noteChunks")
        .withSearchIndex("search_content", (q) =>
          q.search("content", text).eq("userId", userId),
        )
        .take(4),
    ]);
    const keys = [
      ...notes.map((r) => nodeKey("note", r._id)),
      ...marks.map((r) => nodeKey("highlight", r._id)),
      ...threads.filter((r) => r.keptAt).map((r) => nodeKey("answer", r._id)),
      ...chunks.map((r) => nodeKey("vault", r._id)),
    ];
    const hits: SearchHit[] = [];
    for (const key of keys) {
      const node = await loadNode(ctx, userId, key);
      if (node) hits.push({ key, kind: node.kind, label: node.label });
    }
    return hits.slice(0, 8);
  },
});

/** One idea in full, for the side panel. */
export const node = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const found = await loadNode(ctx, ctx.readerId, args.key);
    if (!found) return null;
    const row = found.articleId
      ? await ctx.db.get("articles", found.articleId)
      : null;
    const article = row && row.userId === ctx.readerId ? row : null;
    let quote: string | undefined;
    let prompt: string | undefined;
    if (found.kind === "note") {
      const note = await ctx.db.get("userNotes", found.id as Id<"userNotes">);
      quote = note?.selectedText || undefined;
      prompt = note?.prompt || undefined;
    }
    return {
      key: found.key,
      kind: found.kind,
      text: found.text.slice(0, 8000),
      quote,
      prompt,
      createdAt: found.createdAt,
      filePath: found.filePath ?? null,
      articleId: article?._id ?? null,
      articleTitle: article?.title ?? null,
    };
  },
});

// --- Links the reader makes ---

async function linkRow(ctx: Db, userId: string, a: string, b: string) {
  const find = (from: string, to: string) =>
    ctx.db
      .query("ideaLinks")
      .withIndex("by_user_from_to", (q) =>
        q.eq("userId", userId).eq("from", from).eq("to", to),
      )
      .first();
  return (await find(a, b)) ?? (await find(b, a));
}

async function createLink(
  ctx: MutationCtx,
  userId: string,
  from: string,
  to: string,
) {
  if (from === to) throw new ConvexError("An idea can't link to itself.");
  const [a, b] = await Promise.all([
    loadNode(ctx, userId, from),
    loadNode(ctx, userId, to),
  ]);
  if (!a || !b) throw new ConvexError("That idea isn't in your notes.");
  const existing = await linkRow(ctx, userId, from, to);
  if (existing) return existing._id;
  return ctx.db.insert("ideaLinks", {
    userId,
    from,
    to,
    createdAt: Date.now(),
  });
}

export const link = mutation({
  args: { from: v.string(), to: v.string() },
  handler: (ctx, args) => createLink(ctx, ctx.readerId, args.from, args.to),
});

export const unlink = mutation({
  args: { a: v.string(), b: v.string() },
  handler: async (ctx, args) => {
    const row = await linkRow(ctx, ctx.readerId, args.a, args.b);
    if (row) await ctx.db.delete("ideaLinks", row._id);
  },
});

/** The article a new note beside this idea belongs to. */
async function articleFor(ctx: Db, userId: string, from: LoadedNode) {
  if (from.articleId) return from.articleId;
  if (from.kind !== "vault") return null;
  const rows = await ctx.db
    .query("annotations")
    .withIndex("by_note_chunk", (q) =>
      q.eq("noteChunkId", from.id as Id<"noteChunks">),
    )
    .order("desc")
    .take(5);
  return rows.find((row) => row.userId === userId)?.articleId ?? null;
}

/**
 * Saves a note written from the graph and links it to the idea it was
 * written beside, so it appears on the map at once. Notes belong to an
 * article, so a vault idea needs one Marginalia has connected it to.
 */
export const writeConnected = mutation({
  args: {
    from: v.string(),
    content: v.string(),
    contentPlain: v.string(),
    // What the note answers, when it is a reply
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.readerId;
    if (!args.contentPlain.trim())
      throw new ConvexError("Write something first.");
    const from = await loadNode(ctx, userId, args.from);
    if (!from) throw new ConvexError("That idea isn't in your notes.");
    const articleId = await articleFor(ctx, userId, from);
    if (!articleId)
      throw new ConvexError(
        "This vault note isn't tied to an article yet. Write from one of your notes instead.",
      );
    const now = Date.now();
    const noteId = await ctx.db.insert("userNotes", {
      userId,
      articleId,
      selectedText: "",
      prompt: args.prompt ? snippet(args.prompt, 300) : undefined,
      content: args.content,
      contentPlain: args.contentPlain,
      createdAt: now,
      updatedAt: now,
    });
    const key = nodeKey("note", noteId);
    await ctx.db.insert("ideaLinks", {
      userId,
      from: key,
      to: from.key,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.actions.embedUserNote.embed, {
      noteId,
    });
    return key;
  },
});

// --- Edge reasons ---

/** Structural reasons for a pair, checked on the server before spending an AI call. */
async function pairReasons(
  ctx: Db,
  userId: string,
  a: LoadedNode,
  b: LoadedNode,
): Promise<Reason[]> {
  const reasons: Reason[] = [];
  if (await linkRow(ctx, userId, a.key, b.key)) reasons.push(linkedReason());
  if (a.articleId && a.articleId === b.articleId)
    reasons.push(articleReason(await articleTitle(ctx, userId, a.articleId)));
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

export const edgeContext = internalQuery({
  args: { userId: v.string(), a: v.string(), b: v.string() },
  handler: async (ctx, args) => {
    const [a, b] = await Promise.all([
      loadNode(ctx, args.userId, args.a),
      loadNode(ctx, args.userId, args.b),
    ]);
    if (!a || !b || a.key === b.key) return null;
    const structural = await pairReasons(ctx, args.userId, a, b);
    const pair = pairKey(a.key, b.key);
    const cached = await ctx.db
      .query("edgeReasons")
      .withIndex("by_user_pair", (q) =>
        q.eq("userId", args.userId).eq("pair", pair),
      )
      .unique();
    const titles = await Promise.all(
      [a, b].map((n) =>
        n.articleId ? articleTitle(ctx, args.userId, n.articleId) : null,
      ),
    );
    const forModel = (n: LoadedNode, title: string | null) => ({
      kind: n.kind,
      text: snippet(n.text, 600),
      article: title ? snippet(title, 120) : null,
    });
    return {
      structural,
      pair,
      fingerprint: pairFingerprint(
        { key: a.key, text: snippet(a.text, 600) },
        { key: b.key, text: snippet(b.text, 600) },
      ),
      cached: cached
        ? { reason: cached.reason, fingerprint: cached.fingerprint }
        : null,
      a: forModel(a, titles[0]),
      b: forModel(b, titles[1]),
    };
  },
});

export const saveReason = internalMutation({
  args: {
    userId: v.string(),
    pair: v.string(),
    fingerprint: v.string(),
    reason: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("edgeReasons")
      .withIndex("by_user_pair", (q) =>
        q.eq("userId", args.userId).eq("pair", args.pair),
      )
      .unique();
    const row = {
      fingerprint: args.fingerprint,
      reason: args.reason,
      model: args.model,
      createdAt: Date.now(),
    };
    if (existing) await ctx.db.patch("edgeReasons", existing._id, row);
    else
      await ctx.db.insert("edgeReasons", {
        userId: args.userId,
        pair: args.pair,
        ...row,
      });
  },
});

/** The embedding of the idea a key names, for ideaNeighbours.similar. */
export const embeddingOf = internalQuery({
  args: { userId: v.string(), key: v.string() },
  handler: async (ctx, args): Promise<number[] | null> => {
    const node = await loadNode(ctx, args.userId, args.key);
    if (!node) return null;
    switch (node.kind) {
      case "note":
        return (
          (await ctx.db.get("userNotes", node.id as Id<"userNotes">))
            ?.embedding ?? null
        );
      case "highlight":
        return (
          (await ctx.db.get("highlights", node.id as Id<"highlights">))
            ?.embedding ?? null
        );
      case "answer":
        return (
          (
            await ctx.db.get(
              "companionThreads",
              node.id as Id<"companionThreads">,
            )
          )?.embedding ?? null
        );
      case "vault":
        return (
          (await ctx.db.get("noteChunks", node.id as Id<"noteChunks">))
            ?.embedding ?? null
        );
    }
  },
});
