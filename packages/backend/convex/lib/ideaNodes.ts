// Loading one idea of the graph by its key, and the small reads every part of
// the graph shares. Everything checks the idea belongs to the reader.
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  type NodeKind,
  parseKey,
  type ReadBudget,
  snippet,
  UNLIMITED,
} from "./ideaGraph";

export type Db = Pick<QueryCtx, "db">;

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
  budget: ReadBudget = UNLIMITED,
): Promise<LoadedNode | null> {
  const ref = parseKey(key);
  if (!ref || budget.allow(1) === 0) return null;
  budget.spend(1);
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
    case "article": {
      const id = db.normalizeId("articles", ref.id);
      const row = id && (await db.get("articles", id));
      if (!row || row.userId !== userId) return null;
      return {
        key,
        kind: "article",
        id: row._id,
        articleId: row._id,
        label: snippet(row.title, 70),
        text: row.excerpt ?? row.title,
        createdAt: row.createdAt,
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

export async function articleTitle(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  budget: ReadBudget = UNLIMITED,
): Promise<string | null> {
  if (budget.allow(1) === 0) return null;
  budget.spend(1);
  const article = await ctx.db.get("articles", articleId);
  return article && article.userId === userId ? article.title : null;
}

// --- Links the reader makes ---

export async function linkRow(ctx: Db, userId: string, a: string, b: string) {
  const find = (from: string, to: string) =>
    ctx.db
      .query("ideaLinks")
      .withIndex("by_user_from_to", (q) =>
        q.eq("userId", userId).eq("from", from).eq("to", to),
      )
      .first();
  return (await find(a, b)) ?? (await find(b, a));
}

/** The article a new note beside this idea belongs to. */
export async function articleFor(ctx: Db, userId: string, from: LoadedNode) {
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
