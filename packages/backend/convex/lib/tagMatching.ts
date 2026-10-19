/**
 * Tag vocabulary rules (blueprint 02, Tags; D-DES-059, spike S9).
 *
 * The thresholds are priors, not measurements: S9 had no embedding key, so the
 * precision and recall of name embeddings were never scored. Tune them here
 * once the labelled pairs have been run.
 */
export const TAG_MERGE_SIMILARITY = 0.9;
export const TAG_NEAR_SIMILARITY = 0.8;
/** A candidate becomes a visible tag after it recurs on this many articles. */
export const TAG_PROMOTE_AFTER = 3;
/** Most tags an article carries. */
export const MAX_TAGS_PER_ARTICLE = 3;
/** Most active tags shown to the model; the most used first. */
export const MAX_VOCABULARY_IN_PROMPT = 150;

/** Folder-like vault tags that name where a note lives, not what it is about. */
const STRUCTURAL_KEYS = new Set([
  "archive",
  "area",
  "project",
  "resource",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "meeting",
  "inbox",
  "journal",
  "template",
  "note",
  "todo",
]);

/** Words that end in "s" without being plural. */
const SINGULAR_ALREADY = new Set(["news", "bias", "atlas", "alias", "canvas"]);

/** Plain plural rules; English topic names only, and only as a normalising aid. */
function singular(word: string): string {
  if (word.length <= 3) return word;
  if (/(ss|us|is|ics)$/.test(word) || SINGULAR_ALREADY.has(word)) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(sses|shes|ches|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * The comparison key for a tag name: last path segment, lowercased, `#` and
 * punctuation stripped, singularised. "Areas/Knowledge-Management", "#knowledge
 * management" and "knowledgemanagements" share one key. Empty when nothing is left.
 */
export function normaliseTag(raw: string): string {
  const leaf = raw.split("/").filter(Boolean).pop() ?? "";
  const words = leaf
    .toLowerCase()
    .replace(/#/g, "")
    .split(/[\s_-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (!words.length) return "";
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join("");
}

/** A seed tag worth keeping: it has a key and isn't vault structure. */
export function isTopicKey(key: string): boolean {
  return key.length > 0 && !STRUCTURAL_KEYS.has(key);
}

/** The name shown to the reader: the leaf, lowercase, words separated by spaces. */
export function tagDisplayName(raw: string): string {
  const leaf = raw.split("/").filter(Boolean).pop() ?? "";
  return leaf
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

export interface KnownTag<Id extends string = string> {
  id: Id;
  key: string;
  aliases: readonly string[];
  embedding?: readonly number[];
}

export type TagMatch<Id extends string = string> =
  /** The proposal is this tag; `alias` is its key when the tag didn't know it yet. */
  | { kind: "existing"; tagId: Id; alias?: string }
  /** A new candidate; `nearestTagId` is also linked when it was a near miss. */
  | { kind: "candidate"; nearestTagId?: Id }
  /** Nothing to compare and no way to compare it: don't grow the vocabulary. */
  | { kind: "skip" };

/**
 * Where one proposed tag lands. Order: exact key or alias, then embedding. A
 * Map keeps names like "constructor" and "__proto__" ordinary.
 */
export function matchTag<Id extends string>(
  proposal: { key: string; embedding?: readonly number[] },
  tags: readonly KnownTag<Id>[],
): TagMatch<Id> {
  const byKey = new Map<string, Id>();
  for (const tag of tags) {
    byKey.set(tag.key, tag.id);
    for (const alias of tag.aliases)
      if (!byKey.has(alias)) byKey.set(alias, tag.id);
  }
  const exact = byKey.get(proposal.key);
  if (exact) return { kind: "existing", tagId: exact };

  return matchTagEmbedding(proposal, tags);
}

/** Shared exact ranking, including the legacy first-NaN and ID tie behavior. */
export function matchTagEmbedding<Id extends string>(
  proposal: { key: string; embedding?: readonly number[] },
  tags: readonly Pick<KnownTag<Id>, "id" | "embedding">[],
): TagMatch<Id> {
  if (!proposal.embedding) return { kind: "skip" };
  let best: { id: Id; score: number } | null = null;
  for (const tag of tags) {
    if (!tag.embedding) continue;
    const score = cosine(proposal.embedding, tag.embedding);
    // Ties go to the smaller id, so the result doesn't depend on storage order
    if (
      !best ||
      score > best.score ||
      (score === best.score && tag.id < best.id)
    )
      best = { id: tag.id, score };
  }
  if (best && best.score >= TAG_MERGE_SIMILARITY)
    return { kind: "existing", tagId: best.id, alias: proposal.key };
  if (best && best.score >= TAG_NEAR_SIMILARITY)
    return { kind: "candidate", nearestTagId: best.id };
  return { kind: "candidate" };
}
