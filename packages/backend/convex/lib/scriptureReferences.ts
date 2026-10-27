import { BIBLE_BOOKS, type BibleReference, parseBibleReference } from "./bible";

export function referenceFromKey(key: string): BibleReference | null {
  const match = /^([1-3]?[A-Z]{2,3})\.(\d+)(?:\.(\d+))?(?:-([1-3]?[A-Z]{2,3})\.(\d+)(?:\.(\d+))?)?$/.exec(key);
  if (!match || (match[4] && match[4] !== match[1])) return null;
  const book = BIBLE_BOOKS.find(([id]) => id === match[1]);
  if (!book || (match[3] && match[5] && match[5] !== match[2])) return null;
  const input = match[3]
    ? `${book[1]} ${match[2]}:${match[3]}${match[6] ? `-${match[6]}` : ""}`
    : `${book[1]} ${match[2]}${match[5] ? `-${match[5]}` : ""}`;
  const ref = parseBibleReference(input);
  return ref?.passageId === key ? ref : null;
}

const bookNames = [...BIBLE_BOOKS.flatMap(([id, name]) => [name, id]), "Psalm", "Song of Songs"]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const references = new RegExp(`(?<![\\p{L}\\p{N}])(${bookNames.join("|")})\\s+(\\d{1,3})(?::(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?|\\s*[-–]\\s*(\\d{1,3}))?(?![\\p{L}\\p{N}:])`, "giu");

/** Conservative reference recognition for existing plain-text Scripture margin notes.
 * A citation is a connection, not a claim that its interpretation is verified.
 */
export function citedScriptureReferences(text: string): BibleReference[] {
  const found = new Map<string, BibleReference>();
  for (const match of text.slice(0, 20_000).matchAll(references)) {
    const ref = parseBibleReference(match[0]);
    if (ref) found.set(ref.passageId, ref);
    if (found.size >= 8) break;
  }
  return [...found.values()];
}
