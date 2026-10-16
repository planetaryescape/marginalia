import type { LibraryFindMatch } from "@marginalia/backend/library-search";

export type TopicMatch = LibraryFindMatch;

/** Later copies of the same article are dropped, so a card is never shown twice. */
export function dedupeMatches(matches: TopicMatch[]): TopicMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    if (seen.has(match.articleId)) return false;
    seen.add(match.articleId);
    return true;
  });
}

/** An article of unknown length can't be promised to fit a chosen time. */
function fits(match: TopicMatch, limit: number | null) {
  return limit === null || (match.minutes !== null && match.minutes <= limit);
}

export type TopicCard =
  | { kind: "empty" }
  /** Matches exist but none fits the chosen time. */
  | { kind: "none-fit"; shortest: TopicMatch | null }
  /** Everything that fits has been shown. */
  | { kind: "end"; count: number }
  | {
      kind: "card";
      match: TopicMatch;
      index: number;
      /** 1-based place among the matches that fit. */
      ordinal: number;
      total: number;
      hasNext: boolean;
      hasPrevious: boolean;
    };

/**
 * The card for a position in the fixed, ranked match list. `position` is an
 * index into the full list, so applying or clearing a time limit never
 * reorders the cards: it only changes which of them are offered.
 */
export function topicCard(
  matches: TopicMatch[],
  position: number,
  limit: number | null,
): TopicCard {
  if (!matches.length) return { kind: "empty" };
  const offered = matches.flatMap((match, index) =>
    fits(match, limit) ? [index] : [],
  );
  if (!offered.length) {
    const timed = matches.filter((match) => match.minutes !== null);
    const shortest = timed.reduce<TopicMatch | null>(
      (best, match) =>
        !best || (match.minutes ?? 0) < (best.minutes ?? 0) ? match : best,
      null,
    );
    return { kind: "none-fit", shortest };
  }
  const at = offered.findIndex((index) => index >= position);
  if (at === -1) return { kind: "end", count: offered.length };
  const index = offered[at];
  return {
    kind: "card",
    match: matches[index],
    index,
    ordinal: at + 1,
    total: offered.length,
    hasNext: at < offered.length - 1,
    hasPrevious: at > 0,
  };
}

/** The position of the next card after the one at `index`. */
export function nextPosition(index: number) {
  return index + 1;
}

/** The position of the offered card before the one at `index`. */
export function previousPosition(
  matches: TopicMatch[],
  index: number,
  limit: number | null,
) {
  for (let i = index - 1; i >= 0; i--) if (fits(matches[i], limit)) return i;
  return index;
}
