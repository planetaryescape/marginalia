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
import type { MarkColor } from "./markColours";

export type Db = Pick<QueryCtx, "db">;

/** A source-first removal's children are not live graph inputs. If the graph
 * cannot afford this compact authority read, fail closed rather than infer
 * absence. The claim disappears only after all generated children are gone. */
export async function articleCleanupPending(
  ctx: Db,
  articleId: Id<"articles">,
  budget: ReadBudget = UNLIMITED,
) {
  if (budget.allow(1) === 0) return true;
  const [job] = await budget.take(1, (limit) =>
    ctx.db
      .query("feedArticleCleanup")
      .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
      .take(limit),
  );
  return !!job && job.phase !== "checking" && job.phase !== "feed";
}

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
  /** For a highlight: the colour it was made in, when it has one. */
  color?: MarkColor;
}

/** The node a key names, or null when it is gone or belongs to someone else. */
export async function loadNode(
  ctx: Db,
  userId: string,
  key: string,
  budget: ReadBudget = UNLIMITED,
  // The key was derived from the reader's own ideas, not typed by the client
  trusted = false,
  // For a vault idea: the chunk (passage) that matched, when one did
  via?: string,
): Promise<LoadedNode | null> {
  const ref = parseKey(key);
  if (!ref || budget.allow(1) === 0) return null;
  budget.spend(1);
  const { db } = ctx;
  switch (ref.kind) {
    case "note": {
      const id = db.normalizeId("userNotes", ref.id);
      const row = id && (await db.get("userNotes", id));
      budget.charge(row);
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
      budget.charge(row);
      if (!row || row.userId !== userId) return null;
      return {
        key,
        kind: "highlight",
        id: row._id,
        articleId: row.articleId,
        label: snippet(row.text, 70),
        text: row.text,
        createdAt: row.createdAt,
        color: row.color,
      };
    }
    case "answer": {
      const id = db.normalizeId("companionThreads", ref.id);
      const row = id && (await db.get("companionThreads", id));
      budget.charge(row);
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
      if (!id) return null;
      if (!budget.mayReadArticle)
        return articleFromSummary(ctx, userId, id, key, budget, trusted);
      budget.spendArticle();
      const row = await db.get("articles", id);
      budget.charge(row);
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
      // A vault idea is its file, so it survives the file being reindexed
      // (which replaces its chunks). The passage that matched stands for it
      // when that chunk still exists in the file; otherwise the first chunk does.
      const matched = via ? db.normalizeId("noteChunks", via) : null;
      const chunk = matched ? await db.get("noteChunks", matched) : null;
      budget.charge(chunk);
      let row =
        chunk && chunk.userId === userId && chunk.filePath === ref.id
          ? chunk
          : null;
      if (!row) {
        row = await db
          .query("noteChunks")
          .withIndex("by_user_file", (q) =>
            q.eq("userId", userId).eq("filePath", ref.id),
          )
          .first();
        budget.charge(row);
      }
      if (!row) return null;
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

/**
 * An article read from its summary instead of itself, once the whole-article
 * reads of this query are spent (see ARTICLE_READS). The summary is small and
 * carries the reader's id, which proves the article is theirs; without one, an
 * article the graph itself derived from the reader's own ideas is still shown,
 * as plain "An article".
 */
async function articleFromSummary(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  key: string,
  budget: ReadBudget,
  trusted: boolean,
): Promise<LoadedNode | null> {
  if (await articleCleanupPending(ctx, articleId, budget)) return null;
  const [summary] = await budget.take(1, (limit) =>
    ctx.db
      .query("summaries")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .take(limit),
  );
  const owned = summary?.userId === userId;
  if (!owned && !trusted) return null;
  const point = owned ? summary.thesis || summary.gist : "";
  return {
    key,
    kind: "article",
    id: articleId,
    articleId,
    label: point ? snippet(point, 70) : "An article",
    text: point || "An article in your library",
    createdAt: owned ? summary.createdAt : 0,
  };
}

export async function articleTitle(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
  budget: ReadBudget = UNLIMITED,
): Promise<string | null> {
  // Past the whole-article reads this query may make, reasons just say "Same article"
  if (!budget.mayReadArticle) return null;
  budget.spendArticle();
  const article = await ctx.db.get("articles", articleId);
  budget.charge(article);
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
  if (!from.filePath) return null;
  const filePath = from.filePath;
  const rows = await ctx.db
    .query("annotations")
    .withIndex("by_user_note_path", (q) =>
      q.eq("userId", userId).eq("notePath", filePath),
    )
    .order("desc")
    .take(5);
  for (const row of rows) {
    if (row.userId !== userId) continue;
    if (!(await articleCleanupPending(ctx, row.articleId)))
      return row.articleId;
  }
  return null;
}
