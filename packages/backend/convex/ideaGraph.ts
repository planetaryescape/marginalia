// The idea graph (rung 5d), read side: a small local map around one idea,
// built from what already exists. The result never exceeds MAX_NODES ideas.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, query } from "./functions";
import {
  articleReason,
  FIRST_RING,
  fromArticleReason,
  HUB_SLOTS,
  linkedReason,
  MAX_NODES,
  type NodeKind,
  nodeKey,
  pairKey,
  ReadBudget,
  type Reason,
} from "./lib/ideaGraph";
import {
  articleFor,
  articleTitle,
  type Db,
  type LoadedNode,
  loadNode,
} from "./lib/ideaNodes";
import {
  gatherCandidates,
  ideasOnArticle,
  linkedKeys,
} from "./lib/ideaSignals";

const HINTS_USED = 12;
const CANDIDATES_LOADED = FIRST_RING * 2;

async function latestNode(ctx: Db, userId: string, budget: ReadBudget) {
  const row = await ctx.db
    .query("userNotes")
    .withIndex("by_user_recent", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  budget.spend(1);
  return row ? loadNode(ctx, userId, nodeKey("note", row._id), budget) : null;
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

export async function buildGraph(
  ctx: Db,
  userId: string,
  args: { centre?: string; similar?: string[]; pin?: string },
  budget: ReadBudget = new ReadBudget(),
): Promise<Graph> {
  const centre =
    (args.centre ? await loadNode(ctx, userId, args.centre, budget) : null) ??
    (await latestNode(ctx, userId, budget));
  if (!centre) return EMPTY;

  const found = await gatherCandidates(
    ctx,
    userId,
    centre,
    (args.similar ?? []).slice(0, HINTS_USED),
    // Finding who is near may not use up what loading them needs
    budget.discovery(),
  );
  // The idea just written from the map always has a place beside the centre
  if (args.pin) found.pin(args.pin, linkedReason());

  const nodes: GraphNode[] = [view(centre, 0)];
  const edges: GraphEdge[] = [];
  const shown = new Map<string, LoadedNode>([[centre.key, centre]]);
  const files = new Set<string>(centre.filePath ? [centre.filePath] : []);
  const ring: LoadedNode[] = [];

  for (const candidate of found.ranked(CANDIDATES_LOADED)) {
    if (ring.length >= FIRST_RING) break;
    const node = await loadNode(ctx, userId, candidate.key, budget, true);
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
    const nearLinks = await linkedKeys(
      ctx,
      userId,
      near.key,
      4,
      budget.discovery(),
    );
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
    // The last slots are kept for articles that tie several ideas together
    if (nodes.length >= MAX_NODES - HUB_SLOTS) continue;

    const sameArticle = near.articleId
      ? // Up to seven of an article's ideas may already be on the ring, so ask for one more
        await ideasOnArticle(
          ctx,
          userId,
          near.articleId,
          { notes: 6, highlights: 3, answers: 1 },
          budget.discovery(),
        )
      : [];
    const title = near.articleId
      ? await articleTitle(ctx, userId, near.articleId, budget.discovery())
      : null;
    const options: { key: string; reason: Reason }[] = [
      ...nearLinks.map((key) => ({ key, reason: linkedReason() })),
      ...sameArticle.map((key) => ({
        key,
        reason:
          near.kind === "article" ? fromArticleReason() : articleReason(title),
      })),
    ];
    for (const option of options) {
      if (shown.has(option.key)) continue;
      const node = await loadNode(ctx, userId, option.key, budget, true);
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

  // An article that two or more ideas on the map come from joins as their common source
  const byArticle = new Map<string, LoadedNode[]>();
  for (const member of shown.values()) {
    if (member.kind === "article" || !member.articleId) continue;
    byArticle.set(member.articleId, [
      ...(byArticle.get(member.articleId) ?? []),
      member,
    ]);
  }
  const hubs = [...byArticle.entries()]
    .filter(([, members]) => members.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [articleId, members] of hubs) {
    const key = nodeKey("article", articleId);
    if (nodes.length >= MAX_NODES || shown.has(key)) continue;
    const hub = await loadNode(ctx, userId, key, budget, true);
    if (!hub) continue;
    shown.set(key, hub);
    nodes.push(view(hub, 2));
    // Neighbours first, so the article hangs off one of them on the map
    const first = members.sort(
      (a, b) => (a.key === centre.key ? 1 : 0) - (b.key === centre.key ? 1 : 0),
    );
    for (const member of first)
      edges.push({
        id: pairKey(member.key, key),
        a: member.key,
        b: key,
        reasons: [fromArticleReason()],
        needsAi: false,
      });
  }

  const kept = nodes.slice(0, MAX_NODES);
  const keys = new Set(kept.map((n) => n.key));
  return {
    centre: centre.key,
    nodes: kept,
    edges: edges.filter((e) => keys.has(e.a) && keys.has(e.b)),
  };
}

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
    // The note just written from the map, which must show whatever else is near
    pin: v.optional(v.string()),
  },
  handler: (ctx, args) => buildGraph(ctx, ctx.readerId, args),
});

export interface SearchHit {
  key: string;
  kind: NodeKind;
  label: string;
}

/** Finds an idea to start from, across notes, highlights, kept answers and vault notes. */
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
      ...[...new Set(chunks.map((r) => r.filePath))].map((path) =>
        nodeKey("vault", path),
      ),
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
    // An article reads as its one point, from the summary when there is one
    let text = found.text;
    if (found.kind === "article") {
      const summary = await ctx.db
        .query("summaries")
        .withIndex("by_article", (q) =>
          q.eq("articleId", found.id as Id<"articles">),
        )
        .first();
      text = summary?.thesis || summary?.gist || text;
    }
    return {
      key: found.key,
      kind: found.kind,
      text: text.slice(0, 8000),
      quote,
      prompt,
      createdAt: found.createdAt,
      filePath: found.filePath ?? null,
      // Notes belong to an article, so a vault idea with none can't be written beside
      canWrite: Boolean(await articleFor(ctx, ctx.readerId, found)),
      articleId: article?._id ?? null,
      articleTitle: article?.title ?? null,
    };
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
      case "article":
        return null;
      case "vault":
        return (
          (await ctx.db.get("noteChunks", node.id as Id<"noteChunks">))
            ?.embedding ?? null
        );
    }
  },
});

/** The files that vector-search hits on vault chunks belong to: ideas are keyed by file. */
export const vaultFiles = internalQuery({
  args: { userId: v.string(), chunkIds: v.array(v.id("noteChunks")) },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const files: Record<string, string> = {};
    for (const id of args.chunkIds.slice(0, 20)) {
      const chunk = await ctx.db.get("noteChunks", id);
      if (chunk && chunk.userId === args.userId) files[id] = chunk.filePath;
    }
    return files;
  },
});
