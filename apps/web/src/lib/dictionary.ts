import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { readLink } from "@/lib/notes-groups";

/** The most lookups the room loads. Past it the dictionary says so rather than reading on. */
export const DICTIONARY_CAP = 2000;

export type LookupRow = {
  _id: string;
  articleId: Id<"articles">;
  /** Null once the article is deleted, or when the server left it out to bound its reads */
  articleTitle: string | null;
  /** True only once the article is known to be deleted */
  articleGone: boolean;
  word: string;
  wordKey: string;
  sentence: string;
  paragraphIndex?: number;
  sense: string;
  createdAt: number;
};

export type Sense = {
  id: string;
  partOfSpeech: string | null;
  text: string;
  sentence: string;
  articleTitle: string | null;
  /** Whether the article is deleted, so there is nothing to open */
  articleGone: boolean;
  /** Where the sentence lives in its article, or null when the article is gone */
  href: string | null;
  createdAt: number;
};

export type Entry = {
  key: string;
  headword: string;
  /** "A" to "Z", or "#" for a word that doesn't start with a Latin letter */
  letter: string;
  senses: Sense[];
};

const ABBREVIATIONS = new Map(
  Object.entries({
    noun: "n.",
    n: "n.",
    verb: "v.",
    v: "v.",
    vb: "v.",
    adjective: "adj.",
    adj: "adj.",
    adverb: "adv.",
    adv: "adv.",
    preposition: "prep.",
    prep: "prep.",
    conjunction: "conj.",
    conj: "conj.",
    pronoun: "pron.",
    pron: "pron.",
    interjection: "interj.",
    interj: "interj.",
    determiner: "det.",
    det: "det.",
    abbreviation: "abbr.",
    abbr: "abbr.",
  }),
);
// A part of speech has to be followed by punctuation, so "Noun phrase for…" isn't read as one
const PART_OF_SPEECH = new RegExp(
  `^\\(?\\s*(${[...ABBREVIATIONS.keys()].join("|")})\\s*[.:,)–—]+\\s*(?=\\S)`,
  "i",
);

/** "adj. Changing a lot." becomes { partOfSpeech: "adj.", text: "Changing a lot." }. */
export function splitSense(sense: string) {
  const trimmed = sense.trim();
  const match = PART_OF_SPEECH.exec(trimmed);
  if (!match) return { partOfSpeech: null, text: trimmed };
  return {
    partOfSpeech: ABBREVIATIONS.get(match[1].toLowerCase()) ?? null,
    text: trimmed.slice(match[0].length),
  };
}

/** Lower case with accents removed, so "épistémique" files and searches beside "epistemic". */
export function foldAccents(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function letterOf(key: string) {
  const first = foldAccents(key).charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

/**
 * One entry per word, in alphabetical order, each with every sense the reader
 * met. The order depends only on the words, never on the order of the rows.
 */
export function groupLookups(rows: LookupRow[]): Entry[] {
  const byKey = new Map<string, LookupRow[]>();
  for (const row of rows) {
    if (!row.wordKey) continue;
    const group = byKey.get(row.wordKey);
    if (group) group.push(row);
    else byKey.set(row.wordKey, [row]);
  }
  return [...byKey.entries()]
    .map(([key, group]) => ({
      key,
      headword: key,
      letter: letterOf(key),
      senses: group
        .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id))
        .map(
          (row): Sense => ({
            id: row._id,
            ...splitSense(row.sense),
            sentence: row.sentence,
            articleTitle: row.articleTitle,
            articleGone: row.articleGone,
            href: row.articleGone
              ? null
              : readLink(row.articleId, row.sentence, row.paragraphIndex),
            createdAt: row.createdAt,
          }),
        ),
    }))
    .sort((a, b) => {
      const folded = foldAccents(a.key);
      const other = foldAccents(b.key);
      if (folded !== other) return folded < other ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
}

/** Words containing what was typed, accents and case ignored. Order is kept. */
export function searchEntries(entries: Entry[], query: string) {
  const needle = foldAccents(query.trim());
  if (!needle) return entries;
  return entries.filter((e) => foldAccents(e.key).includes(needle));
}

/** Every letter of the alphabet, dimmed where there is no word, plus "#" when some word needs it. */
export function thumbIndex(entries: Entry[]) {
  const present = new Set(entries.map((e) => e.letter));
  const letters = Array.from({ length: 26 }, (_, i) =>
    String.fromCharCode(65 + i),
  );
  return [...(present.has("#") ? ["#"] : []), ...letters].map((letter) => ({
    letter,
    hasWords: present.has(letter),
  }));
}

/** Two columns of about equal length, each sense counting as a line of its own. */
export function splitColumns(entries: Entry[]): [Entry[], Entry[]] {
  const weight = (e: Entry) => 1 + e.senses.length;
  const total = entries.reduce((n, e) => n + weight(e), 0);
  let seen = 0;
  let cut = entries.length;
  for (let i = 0; i < entries.length; i++) {
    seen += weight(entries[i]);
    if (seen >= total / 2) {
      cut = i + 1;
      break;
    }
  }
  return [entries.slice(0, cut), entries.slice(cut)];
}

/** The first and last headword of a column, as printed at the top of a dictionary page. */
export function guideWords(column: Entry[]) {
  return column.length
    ? ([column[0].headword, column[column.length - 1].headword] as const)
    : null;
}

/** Words first looked up in the calendar month of `now`, in the reader's local time. */
export function wordsThisMonth(rows: LookupRow[], now: Date) {
  const firstSeen = new Map<string, number>();
  for (const row of rows)
    firstSeen.set(
      row.wordKey,
      Math.min(firstSeen.get(row.wordKey) ?? row.createdAt, row.createdAt),
    );
  let n = 0;
  for (const at of firstSeen.values()) {
    const d = new Date(at);
    if (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth()
    )
      n++;
  }
  return n;
}
