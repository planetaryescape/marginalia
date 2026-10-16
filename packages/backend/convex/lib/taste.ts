/**
 * What a reader tends to read, as counts anyone can check (rung 5c, D-DES-057).
 * No model: an affinity is (liked - disliked) / (all evidence + a prior), so a
 * thing seen once says little and a thing seen often says what it says. Every
 * affinity is in -1..1 and a thing nobody has evidence on sits at 0.
 */

export interface TasteEntry {
  key: string;
  affinity: number;
  /** Offers (feeds) or articles (authors, tags) behind the affinity */
  n: number;
}

export interface TasteProfile {
  feeds: TasteEntry[];
  authors: TasteEntry[];
  tags: TasteEntry[];
}

/** Most entries kept per list, strongest first; the row stays a few KB. */
export const PROFILE_CAP = 40;
/** Entries closer to zero than this say nothing and are not stored. */
const MIN_AFFINITY = 0.05;

/** Points the taste term can add to or take from a pick's score. Fit is worth 2 a minute, so taste can swing two articles by two minutes of fit: one three minutes closer always wins. */
export const TASTE_MAX = 2;
/** A signal speaks as the reason for a pick only above this share of the term. */
export const MIN_REASON = 0.2;

// Pseudo-observations pulling a feed toward the reader's overall rate
const OPEN_PRIOR = 10;
const FINISH_PRIOR = 3;
// Pseudo-observations for authors and tags: three articles' worth of doubt
const ENTITY_PRIOR = 3;

// How much each signal counts toward the term. An author says most about one
// article, a feed less, and a tag least because articles carry several.
const FEED_WEIGHT = 0.8;
const AUTHOR_WEIGHT = 1;
const TAG_WEIGHT = 0.6;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The same author however a feed spells them. */
export function normaliseAuthor(raw: string | undefined): string | undefined {
  const name = raw?.toLowerCase().replace(/\s+/g, " ").trim();
  return name && name.length <= 80 ? name : undefined;
}

export function entityAffinity(liked: number, disliked: number): number {
  return (liked - disliked) / (liked + disliked + ENTITY_PRIOR);
}

export interface FeedCounts {
  feedId: string;
  offered: number;
  opened: number;
  finished: number;
}

/**
 * A feed's affinity is how its smoothed open rate and finish rate compare with
 * the reader's own across all feeds, so a quiet reader isn't marked down for
 * opening little everywhere.
 */
export function feedAffinities(counts: FeedCounts[]): TasteEntry[] {
  const offered = counts.reduce((n, c) => n + c.offered, 0);
  if (offered === 0) return [];
  const opened = counts.reduce((n, c) => n + c.opened, 0);
  const finished = counts.reduce((n, c) => n + c.finished, 0);
  const openRate = opened / offered;
  const finishRate = opened > 0 ? finished / opened : 0;
  const overall = (openRate + finishRate) / 2;
  const entries: TasteEntry[] = [];
  for (const c of counts) {
    if (c.offered <= 0) continue;
    const feedOpen =
      (c.opened + OPEN_PRIOR * openRate) / (c.offered + OPEN_PRIOR);
    const feedFinish =
      (c.finished + FINISH_PRIOR * finishRate) / (c.opened + FINISH_PRIOR);
    entries.push({
      key: c.feedId,
      affinity: round3(clamp((feedOpen + feedFinish) / 2 - overall, -1, 1)),
      n: c.offered,
    });
  }
  return strongest(entries);
}

export interface ArticleSignals {
  finished: boolean;
  opened: boolean;
  /** Passed over with Another, or skipped, without being opened */
  skipped: boolean;
  loved: boolean;
  /** 1 to 5 */
  rating?: number;
}

/** What one article says for (pos) or against (neg) the things it carries. */
export function evidenceOf(s: ArticleSignals): { pos: number; neg: number } {
  let pos = 0;
  let neg = 0;
  if (s.finished) pos += 1;
  else if (s.opened) pos += 0.4;
  else if (s.skipped) neg += 1;
  if (s.loved) pos += 1;
  if (s.rating !== undefined) {
    if (s.rating >= 4) pos += 0.5;
    else if (s.rating <= 2) neg += 1;
  }
  return { pos, neg };
}

export type Tally = Record<string, { pos: number; neg: number }>;

export function addTally(
  tally: Tally,
  key: string,
  evidence: { pos: number; neg: number },
) {
  if (evidence.pos === 0 && evidence.neg === 0) return;
  const seen = tally[key] ?? { pos: 0, neg: 0 };
  tally[key] = { pos: seen.pos + evidence.pos, neg: seen.neg + evidence.neg };
}

export function tallyEntries(tally: Tally, cap = PROFILE_CAP): TasteEntry[] {
  return strongest(
    Object.entries(tally).map(([key, { pos, neg }]) => ({
      key,
      affinity: round3(entityAffinity(pos, neg)),
      n: Math.round(pos + neg),
    })),
    cap,
  );
}

// Strongest first by distance from zero; the key breaks ties so a recompute of
// the same history stores the same row
function strongest(entries: TasteEntry[], cap = PROFILE_CAP): TasteEntry[] {
  return entries
    .filter((e) => Math.abs(e.affinity) >= MIN_AFFINITY)
    .sort(
      (a, b) =>
        Math.abs(b.affinity) - Math.abs(a.affinity) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, cap);
}

export type TasteSource = "author" | "feed" | "tag";

export interface Taste {
  /** -1..1, to be scaled by TASTE_MAX */
  term: number;
  /** The signal that speaks for a pick, when one is strong enough to say */
  because?: { source: TasteSource; key: string };
}

const NO_TASTE: Taste = { term: 0 };

function lookup(entries: TasteEntry[]) {
  return new Map(entries.map((e) => [e.key, e.affinity]));
}

/** An article's taste term and the strongest signal behind it. */
export function tasteOf(
  profile: TasteProfile | null,
  article: { feedId?: string; author?: string; tagIds: readonly string[] },
): Taste {
  if (!profile) return NO_TASTE;
  const feeds = lookup(profile.feeds);
  const authors = lookup(profile.authors);
  const tags = lookup(profile.tags);

  const parts: { source: TasteSource; key: string; value: number }[] = [];
  if (article.feedId !== undefined) {
    const a = feeds.get(article.feedId);
    if (a !== undefined)
      parts.push({
        source: "feed",
        key: article.feedId,
        value: a * FEED_WEIGHT,
      });
  }
  const author = normaliseAuthor(article.author);
  if (author !== undefined) {
    const a = authors.get(author);
    if (a !== undefined)
      parts.push({ source: "author", key: author, value: a * AUTHOR_WEIGHT });
  }
  // One tag speaks for the topic: the most extreme, ties to the smaller key
  let tag: { key: string; value: number } | undefined;
  for (const id of article.tagIds) {
    const a = tags.get(id);
    if (a === undefined) continue;
    if (
      !tag ||
      Math.abs(a) > Math.abs(tag.value) ||
      (Math.abs(a) === Math.abs(tag.value) && id < tag.key)
    )
      tag = { key: id, value: a };
  }
  if (tag)
    parts.push({ source: "tag", key: tag.key, value: tag.value * TAG_WEIGHT });

  const term = clamp(
    parts.reduce((n, p) => n + p.value, 0),
    -1,
    1,
  );
  // Source order breaks ties: the author, then the feed, then the topic
  const order: TasteSource[] = ["author", "feed", "tag"];
  const best = parts
    .filter((p) => p.value >= MIN_REASON)
    .sort(
      (a, b) =>
        b.value - a.value || order.indexOf(a.source) - order.indexOf(b.source),
    )[0];
  return best
    ? { term, because: { source: best.source, key: best.key } }
    : { term };
}

/** The pick's reason in plain words: no scores, no mention of a model. */
export function whyLine(
  because: NonNullable<Taste["because"]>,
  tagName?: string,
): string | undefined {
  switch (because.source) {
    case "author":
      return "You usually finish pieces like this from this writer.";
    case "feed":
      return "You usually read what this source sends.";
    case "tag":
      return tagName ? `You often finish pieces on ${tagName}.` : undefined;
  }
}
