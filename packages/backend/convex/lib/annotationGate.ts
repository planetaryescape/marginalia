import { type AnnotationKind, isAnnotationKind } from "./annotationKinds";
import { MIN_RELEVANCE_SCORE } from "./constants";

/**
 * Bumped when the margin's contract changes. Articles annotated below it are
 * re-annotated by reannotateBackfill.ts. 2 = the three families, library
 * connections, tags and the import-time summary (rung 2c).
 */
export const CURRENT_ANNOTATION_VERSION = 2;

// A screen of text is about this many words at reading size.
const WORDS_PER_SCREEN = 350;
const MIN_NOTES = 2;
const MAX_NOTES = 40;

/**
 * Notes are budgeted by length (D-DES-042): about one per screen on average.
 * `target` is what the prompt asks for; `cap` is the most kept, so dense
 * passages can earn more than the average without a runaway.
 */
export function annotationBudget(wordCount: number) {
  const screens = Math.max(1, wordCount / WORDS_PER_SCREEN);
  const target = Math.max(MIN_NOTES, Math.round(screens));
  const cap = Math.min(
    MAX_NOTES,
    Math.max(MIN_NOTES + 2, Math.ceil(target * 1.6)),
  );
  return { target, cap };
}

/** What the model returns for one note, before it is trusted. */
export interface CandidateNote {
  type: string;
  anchorText: string;
  content: string;
  notePath?: string;
  noteExcerpt?: string;
  articleRefId?: string;
  fallacyName?: string;
  relevanceScore: number;
}

export interface GatedNote extends Omit<CandidateNote, "type"> {
  type: AnnotationKind;
  startOffset: number;
}

export interface GateRejections {
  kind: number;
  anchor: number;
  relevance: number;
  connection: number;
  articleRef: number;
}

const MAX_FALLACY_NAME = 60;

/**
 * Which of the model's notes are kept. Anything it invents is dropped: an
 * unknown kind, an anchor that isn't in the article, a connection with
 * nothing to point at, or an article id that wasn't offered to it.
 */
export function gateNotes(
  candidates: readonly CandidateNote[],
  options: {
    content: string;
    /** Ids of the library articles the model was shown. */
    offeredArticleIds: ReadonlySet<string>;
    cap: number;
  },
): { notes: GatedNote[]; rejected: GateRejections } {
  const rejected: GateRejections = {
    kind: 0,
    anchor: 0,
    relevance: 0,
    connection: 0,
    articleRef: 0,
  };
  const kept: GatedNote[] = [];
  for (const candidate of candidates) {
    if (!isAnnotationKind(candidate.type)) {
      rejected.kind++;
      continue;
    }
    const startOffset = options.content.indexOf(candidate.anchorText);
    if (!candidate.anchorText || startOffset === -1) {
      rejected.anchor++;
      continue;
    }
    if (!(candidate.relevanceScore >= MIN_RELEVANCE_SCORE)) {
      rejected.relevance++;
      continue;
    }
    const isConnection = candidate.type === "cross_reference";
    // Only a connection can cite an article, and only one that was offered
    const articleRefId = isConnection
      ? candidate.articleRefId?.trim() || undefined
      : undefined;
    if (articleRefId && !options.offeredArticleIds.has(articleRefId)) {
      rejected.articleRef++;
      continue;
    }
    if (isConnection && !candidate.notePath && !articleRefId) {
      rejected.connection++;
      continue;
    }
    kept.push({
      ...candidate,
      type: candidate.type,
      articleRefId,
      fallacyName:
        candidate.type === "fallacy"
          ? candidate.fallacyName?.trim().slice(0, MAX_FALLACY_NAME) ||
            undefined
          : undefined,
      startOffset,
    });
  }

  // Highest relevance first; a note overlapping a stronger one gives way to it
  const byRelevance = kept.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const notes: GatedNote[] = [];
  for (const note of byRelevance) {
    const end = note.startOffset + note.anchorText.length;
    const overlaps = notes.some(
      (other) =>
        note.startOffset < other.startOffset + other.anchorText.length &&
        end > other.startOffset,
    );
    if (!overlaps) notes.push(note);
    if (notes.length >= options.cap) break;
  }
  return { notes, rejected };
}
