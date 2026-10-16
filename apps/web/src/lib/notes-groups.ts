import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";

/** A kept answer as the Notes page receives it: the record without its embedding. */
export type KeptThread = Omit<Doc<"companionThreads">, "embedding">;

/** A highlight or underline as the Notes page receives it, from `highlights.listMine`. */
export type KeptMark = Pick<
  Doc<"highlights">,
  "_id" | "articleId" | "kind" | "text" | "createdAt" | "paragraphIndex"
>;

export type GroupItem =
  | { type: "note"; at: number; note: Doc<"userNotes"> }
  | { type: "mark"; at: number; mark: KeptMark }
  | { type: "answer"; at: number; thread: KeptThread };

export interface ArticleGroup {
  articleId: Id<"articles">;
  /** Newest activity in the article, which orders the groups. */
  latest: number;
  /** The reader's notes, marks and kept answers in the order they were made. */
  items: GroupItem[];
}

/**
 * Notes, marks and kept answers grouped under their article. Articles come
 * newest activity first. Within an article, items run oldest first, the way
 * the reader made them, so the page reads like a commonplace book.
 */
export function groupByArticle(
  notes: Doc<"userNotes">[],
  kept: KeptThread[],
  marks: KeptMark[] = [],
): ArticleGroup[] {
  const groups = new Map<Id<"articles">, ArticleGroup>();
  // `activity` orders the groups; an edited note is newer activity than its creation.
  const add = (
    articleId: Id<"articles">,
    activity: number,
    item: GroupItem,
  ) => {
    let g = groups.get(articleId);
    if (!g) {
      g = { articleId, latest: 0, items: [] };
      groups.set(articleId, g);
    }
    g.items.push(item);
    g.latest = Math.max(g.latest, activity);
  };
  for (const note of notes)
    add(note.articleId, note.updatedAt, {
      type: "note",
      at: note.createdAt,
      note,
    });
  for (const mark of marks)
    add(mark.articleId, mark.createdAt, {
      type: "mark",
      at: mark.createdAt,
      mark,
    });
  for (const thread of kept) {
    const keptAt = thread.keptAt ?? thread.updatedAt;
    add(thread.articleId, keptAt, { type: "answer", at: keptAt, thread });
  }
  // Your words lead, then your marks, then Marginalia's kept answers; time orders within each
  const rank = { note: 0, mark: 1, answer: 2 } as const;
  for (const g of groups.values())
    g.items.sort((a, b) => rank[a.type] - rank[b.type] || a.at - b.at);
  return [...groups.values()].sort((a, b) => b.latest - a.latest);
}

/**
 * The reader at a passage. The quote is what the reader finds again in the
 * article, so it survives re-rendering in a way a paragraph number does not.
 */
export function readLink(
  articleId: Id<"articles">,
  quote?: string,
  paragraphIndex?: number,
): string {
  const base = `/read/${articleId}`;
  if (!quote) return base;
  const params = new URLSearchParams({ quote });
  // The paragraph picks the right occurrence when the quote appears more than once
  if (paragraphIndex !== undefined) params.set("p", String(paragraphIndex));
  return `${base}?${params.toString()}`;
}
