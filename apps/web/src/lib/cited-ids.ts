/** The most articles shown under one answer; matches the server's bound. */
export const MAX_CITED = 8;

const CITATION = /\]\(\/read\/([A-Za-z0-9_-]+)[^)\s]*\)/g;

/**
 * The article ids the librarian linked as `[title](/read/ID)`, in the order
 * they first appear. The server decides which are real articles of the reader's.
 */
export function citedIds(answer: string): string[] {
  const ids = new Set<string>();
  for (const match of answer.matchAll(CITATION)) ids.add(match[1]);
  return [...ids].slice(0, MAX_CITED);
}
