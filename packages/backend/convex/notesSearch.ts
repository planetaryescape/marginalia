import { v } from "convex/values";
import { query } from "./functions";

/** Most rows the picker's "In your notes" group shows. */
export const MAX_NOTE_HITS = 5;
const MAX_QUERY = 200;
const SNIPPET = 160;

const trim = (text: string) =>
  text.length > SNIPPET ? `${text.slice(0, SNIPPET).trimEnd()}…` : text;

/**
 * The reader's own notes and highlights that match a few words, for the
 * picker. Reads are the full-text indexes, filtered to `ctx.readerId` and
 * capped, so this stays cheap beside the article search.
 */
export const find = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const text = args.query.trim().slice(0, MAX_QUERY);
    if (text.length < 2) return [];
    const userId = ctx.readerId;
    const [notes, marks] = await Promise.all([
      ctx.db
        .query("userNotes")
        .withSearchIndex("search_content", (q) =>
          q.search("contentPlain", text).eq("userId", userId),
        )
        .take(MAX_NOTE_HITS),
      ctx.db
        .query("highlights")
        .withSearchIndex("search_text", (q) =>
          q.search("text", text).eq("userId", userId),
        )
        .take(MAX_NOTE_HITS),
    ]);
    // The two indexes rank separately, so take turns, notes first.
    const merged: Array<
      | { kind: "note"; row: (typeof notes)[number] }
      | { kind: "mark"; row: (typeof marks)[number] }
    > = [];
    for (let i = 0; i < MAX_NOTE_HITS; i++) {
      if (notes[i]) merged.push({ kind: "note", row: notes[i] });
      if (marks[i]) merged.push({ kind: "mark", row: marks[i] });
    }
    const hits = [];
    for (const hit of merged) {
      if (hits.length >= MAX_NOTE_HITS) break;
      const article = await ctx.db.get("articles", hit.row.articleId);
      // A note can outlive its article; nowhere to open it then.
      if (!article || article.userId !== userId) continue;
      hits.push(
        hit.kind === "note"
          ? {
              kind: "note" as const,
              id: hit.row._id as string,
              articleId: hit.row.articleId,
              articleTitle: article.title,
              text: trim(hit.row.contentPlain),
              quote: hit.row.selectedText,
              paragraphIndex: undefined,
              unitIndex: hit.row.unitIndex,
            }
          : {
              kind: "highlight" as const,
              id: hit.row._id as string,
              articleId: hit.row.articleId,
              articleTitle: article.title,
              text: trim(hit.row.text),
              quote: hit.row.text,
              paragraphIndex: hit.row.paragraphIndex,
              unitIndex: hit.row.unitIndex,
            },
      );
    }
    return hits;
  },
});
