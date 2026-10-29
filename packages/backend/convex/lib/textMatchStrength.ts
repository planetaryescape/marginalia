/** Too common to say anything about a topic. */
const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "about",
  "what",
  "how",
]);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * The words a hit must contain: typed words of three or more letters, minus
 * stop words. Returns null when none remain, so nothing is strong. The last
 * typed word is usually unfinished and counts as a prefix.
 */
export function requiredWords(query: string) {
  const typed = words(query);
  const last = typed.length - 1;
  const required = typed
    .map((word, index) => ({ word, prefix: index === last }))
    .filter(({ word }) => word.length >= 3 && !STOP_WORDS.has(word));
  return required.length ? required : null;
}

/**
 * Whether every required word appears as a whole word (the last as a word
 * prefix) in the article's title, excerpt or text. Full-text search ranks by
 * any shared term, so this is what makes a hit worth showing as the first card.
 */
export function isStrongTextMatch(
  required: NonNullable<ReturnType<typeof requiredWords>>,
  article: { title: string; excerpt?: string; content?: string },
) {
  const present = new Set(
    words(`${article.title} ${article.excerpt ?? ""} ${article.content ?? ""}`),
  );
  return required.every(({ word, prefix }) => {
    if (present.has(word)) return true;
    if (!prefix) return false;
    for (const candidate of present)
      if (candidate.startsWith(word)) return true;
    return false;
  });
}
