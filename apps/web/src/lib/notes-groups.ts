import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";

/** A kept answer as the Notes page receives it: the record without its embedding. */
export type KeptThread = Omit<Doc<"companionThreads">, "embedding">;

export interface ArticleGroup {
  articleId: Id<"articles">;
  notes: Doc<"userNotes">[];
  answers: KeptThread[];
}

/**
 * Notes and kept answers grouped under their article. Articles come in the
 * order of their most recent note or kept answer, and within an article the
 * reader's own notes come before Marginalia's answers, each newest first.
 */
export function groupByArticle(
  notes: Doc<"userNotes">[],
  kept: KeptThread[],
): ArticleGroup[] {
  const latest = new Map<Id<"articles">, number>();
  const seen = (articleId: Id<"articles">, at: number) =>
    latest.set(articleId, Math.max(latest.get(articleId) ?? 0, at));
  const groups = new Map<Id<"articles">, ArticleGroup>();
  const group = (articleId: Id<"articles">) => {
    let g = groups.get(articleId);
    if (!g) {
      g = { articleId, notes: [], answers: [] };
      groups.set(articleId, g);
    }
    return g;
  };
  for (const note of notes) {
    group(note.articleId).notes.push(note);
    seen(note.articleId, note.updatedAt);
  }
  for (const thread of kept) {
    group(thread.articleId).answers.push(thread);
    seen(thread.articleId, thread.keptAt ?? thread.updatedAt);
  }
  return [...groups.values()].sort(
    (a, b) => (latest.get(b.articleId) ?? 0) - (latest.get(a.articleId) ?? 0),
  );
}
