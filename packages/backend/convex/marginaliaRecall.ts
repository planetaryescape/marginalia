import { getConvexSize, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";
import {
  clipRecallText,
  RECALL_BATCH_OUTPUT_BYTES,
  RECALL_BATCH_READ_BYTES,
  RECALL_BATCH_ROWS,
  RECALL_BLOCK_BYTES,
  RECALL_PAGE_READ_BYTES,
  recallHash,
  textBytes,
} from "./lib/marginaliaRecallBudget";

const ref = v.union(
  v.object({ kind: v.literal("chunk"), id: v.id("noteChunks") }),
  v.object({ kind: v.literal("note"), id: v.id("userNotes") }),
  v.object({ kind: v.literal("highlight"), id: v.id("highlights") }),
  v.object({ kind: v.literal("thread"), id: v.id("companionThreads") }),
);

export type RecallItem = {
  id: string;
  source: string;
  articleId: Id<"articles"> | null;
  filePath: string | null;
  body: string;
  verb: string;
  clipped: boolean;
};

// Background work has no browser session. Revalidate its private library in
// every transaction, including an active row already marked for deletion.
async function active(ctx: QueryCtx, userId: string) {
  if (userId === DEFAULT_USER_ID) return true; // Owner cannot be purged.
  const reader = await ctx.db
    .query("readers")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", userId))
    .first();
  return reader?.status === "active" && reader.deletingAt === undefined;
}

export const authorize = internalQuery({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: currentArticle,
});

function compact(
  row:
    | Doc<"noteChunks">
    | Doc<"userNotes">
    | Doc<"highlights">
    | Doc<"companionThreads">,
): RecallItem | null {
  let source: string;
  let body: string;
  let verb = "From";
  let articleId: Id<"articles"> | null = null;
  let filePath: string | null = null;
  if ("filePath" in row) {
    // A clipped path would be a bogus citation. Omit it instead.
    if (textBytes(row.filePath) > 2048) return null;
    filePath = row.filePath;
    source = `chunk:${row._id}:${row.indexedAt}`;
    body = row.content;
  } else {
    articleId = row.articleId;
    if ("contentPlain" in row) {
      source = `note:${row._id}:${row.updatedAt}`;
      body = [
        row.selectedText
          ? `Highlighted: "${clipRecallText(row.selectedText, 2048)}"`
          : "",
        row.prompt ? `Responding to: ${clipRecallText(row.prompt, 2048)}` : "",
        `Their note: ${clipRecallText(row.contentPlain, 8192)}`,
      ]
        .filter(Boolean)
        .join("\n");
    } else if ("turns" in row) {
      source = `thread:${row._id}:${row.updatedAt}`;
      const action = {
        ask: "Asked about",
        explain: "Asked to explain",
        simplify: "Asked to simplify",
        define: "Asked to define in context",
        article: "Asked about the article",
      }[row.mode];
      const answer =
        row.turns.find((t) => t.role === "assistant")?.content ?? "";
      // Bound while accumulating; never transport or join the full history.
      let followUps = "";
      for (const turn of row.turns) {
        if (turn.role !== "user") continue;
        followUps = clipRecallText(
          `${followUps}${followUps ? " / " : ""}${turn.content}`,
          8192,
        );
        if (followUps.endsWith("[Context clipped]")) break;
      }
      body = [
        row.selection
          ? `${action}: "${clipRecallText(row.selection, 2048)}"`
          : action,
        row.question ? `Question: ${clipRecallText(row.question, 2048)}` : "",
        followUps ? `Follow-ups: ${followUps}` : "",
        answer
          ? `Answer began: ${answer.split(/\n{2,}/, 1)[0].slice(0, 300)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      source = `highlight:${row._id}:${row.createdAt}`;
      verb = row.kind === "underline" ? "Underlined" : "Highlighted";
      body = `"${row.text}"`;
    }
  }
  const clippedBody = clipRecallText(body, RECALL_BLOCK_BYTES);
  return {
    id: row._id,
    source,
    articleId,
    filePath,
    body: clippedBody,
    verb,
    clipped: clippedBody.includes("[Context clipped]"),
  };
}

/** At most two full source rows (2 MiB); deliberately NO article/title joins. */
export const hydrate = internalQuery({
  args: { userId: v.string(), refs: v.array(ref) },
  handler: async (ctx, args) => {
    if (args.refs.length > RECALL_BATCH_ROWS)
      throw new Error("Recall batch too large");
    if (!(await active(ctx, args.userId))) return [];
    const items: RecallItem[] = [];
    let readBytes = 0;
    for (const entry of args.refs) {
      const row = await ctx.db.get(entry.id);
      if (!row) continue;
      readBytes += getConvexSize(row);
      if (readBytes > RECALL_BATCH_READ_BYTES)
        throw new Error("Recall read budget exceeded");
      if (row.userId !== args.userId || !row.embedding) continue;
      const item = compact(row);
      if (item) items.push(item);
    }
    if (getConvexSize(items) > RECALL_BATCH_OUTPUT_BYTES)
      throw new Error("Recall output budget exceeded");
    return items;
  },
});

/** One full article per transaction, not four near-limit joins in a batch. */
export const article = internalQuery({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (!(await active(ctx, args.userId))) return null;
    const row = await ctx.db.get("articles", args.articleId);
    if (!row || row.userId !== args.userId) return null;
    const excerpt = (row.excerpt ?? row.content ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);
    return {
      id: row._id,
      title: clipRecallText(row.title, 2048),
      minutes: row.estimatedReadMinutes ?? null,
      excerpt,
      version: recallHash(`${row.title}|${excerpt}`),
      searchable: Boolean(row.embedding),
    };
  },
});

const activityArgs = {
  userId: v.string(),
  articleId: v.id("articles"),
  cursor: v.union(v.string(), v.null()),
};
const activityOptions = (cursor: string | null, numItems: number) => ({
  cursor,
  numItems,
  maximumBytesRead: RECALL_PAGE_READ_BYTES,
});

// Each function invokes paginate exactly ONCE, even for empty pages. The
// current article costs <=1 MiB; the page <=512 KiB + one document overshoot.
// Bodies/vectors are read physically but compacted before crossing the action
// boundary. The action requests at most 10/10/8 rows, over separate transactions.
async function currentArticle(
  ctx: QueryCtx,
  args: { userId: string; articleId: Id<"articles"> },
) {
  if (!(await active(ctx, args.userId))) return false;
  const row = await ctx.db.get("articles", args.articleId);
  return row?.userId === args.userId;
}

function activityPage(
  page: {
    page: (Doc<"userNotes"> | Doc<"highlights"> | Doc<"companionThreads">)[];
    isDone: boolean;
    continueCursor: string;
  },
  userId: string,
) {
  const items = page.page.flatMap((row) =>
    row.userId === userId ? (compact(row) ?? []) : [],
  );
  if (getConvexSize(items) > 160 * 1024)
    throw new Error("Recall activity output budget exceeded");
  return { items, isDone: page.isDone, continueCursor: page.continueCursor };
}

export const ownNotes = internalQuery({
  args: { ...activityArgs, limit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10)
      throw new Error("Recall activity limit");
    if (!(await currentArticle(ctx, args)))
      return { items: [], isDone: true, continueCursor: "" };
    return activityPage(
      await ctx.db
        .query("userNotes")
        .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
        .paginate(activityOptions(args.cursor, args.limit)),
      args.userId,
    );
  },
});
export const ownHighlights = internalQuery({
  args: { ...activityArgs, limit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10)
      throw new Error("Recall activity limit");
    if (!(await currentArticle(ctx, args)))
      return { items: [], isDone: true, continueCursor: "" };
    return activityPage(
      await ctx.db
        .query("highlights")
        .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
        .paginate(activityOptions(args.cursor, args.limit)),
      args.userId,
    );
  },
});
export const ownThreads = internalQuery({
  args: { ...activityArgs, limit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 8)
      throw new Error("Recall activity limit");
    if (!(await currentArticle(ctx, args)))
      return { items: [], isDone: true, continueCursor: "" };
    return activityPage(
      await ctx.db
        .query("companionThreads")
        .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
        .paginate(activityOptions(args.cursor, args.limit)),
      args.userId,
    );
  },
});
