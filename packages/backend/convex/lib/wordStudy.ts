import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { BIBLE_BOOKS, type BibleReference } from "./bible";

const GREEK_REV = "27a45ff1b7be6c17ccbfeac414f3f55732ae8e28";
const HEBREW_REV = "3d15126fb1ef74867fc1434be1942e837932691f";
const STRONGS_REV = "0acd2f251c2d35ff8db2dece4e0593979d3ac223";
const dictionaryUrl = `https://raw.githubusercontent.com/openscriptures/strongs/${STRONGS_REV}/strongs-dictionary.xhtml`;
const hebrewBase = `https://raw.githubusercontent.com/openscriptures/morphhb/${HEBREW_REV}/wlc/`;
const greekBase = `https://raw.githubusercontent.com/byztxt/byzantine-majority-text/${GREEK_REV}/csv-unicode/strongs/with-parsing/`;
const publicFiles = new Map<string, Promise<string>>();
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
  isArray: (name) => ["book", "chapter", "verse", "w"].includes(name),
});

async function resource(url: string) {
  const cached = publicFiles.get(url);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length")) > 8_000_000
    )
      throw new Error(
        "The original-language source is unavailable. Please retry.",
      );
    const text = await response.text();
    if (text.length > 8_000_000)
      throw new Error("The original-language source is too large.");
    return text;
  })();
  if (publicFiles.size >= 6)
    publicFiles.delete(publicFiles.keys().next().value ?? "");
  publicFiles.set(url, pending);
  try {
    return await pending;
  } catch (error) {
    publicFiles.delete(url);
    throw error;
  }
}

export interface StudyWord {
  surface: string;
  lemma: string;
  strongs: string[];
  morphology: string[];
}
interface StudyVerse {
  id: string;
  chapter: number;
  verse: number;
  words: StudyWord[];
}
function csvFields(line: string) {
  const fields: string[] = [];
  let field = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      fields.push(field);
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Invalid original-language CSV.");
  fields.push(field);
  return fields;
}

export function parseGreekBook(csv: string, bookId: string): StudyVerse[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const fields = csvFields(line);
      if (
        fields.length !== 3 ||
        !/^\d+$/.test(fields[0]) ||
        !/^\d+$/.test(fields[1])
      )
        throw new Error("Invalid Greek source row.");
      const chapter = Number(fields[0]),
        verse = Number(fields[1]);
      const tokens = fields[2].split(/\s+/);
      const words: StudyWord[] = [];
      for (let i = 0; i < tokens.length; i++) {
        if (!/\p{Script=Greek}/u.test(tokens[i])) continue;
        const word: StudyWord = {
          surface: tokens[i],
          lemma: "",
          strongs: [],
          morphology: [],
        };
        while (
          /^\d{1,5}$/.test(tokens[i + 1] ?? "") &&
          /^\{[^}]+\}$/.test(tokens[i + 2] ?? "")
        ) {
          const strongs = `G${Number(tokens[i + 1])}`;
          if (!word.strongs.includes(strongs)) word.strongs.push(strongs);
          word.morphology.push(tokens[i + 2].slice(1, -1));
          i += 2;
        }
        words.push(word);
      }
      return { id: `${bookId}.${chapter}.${verse}`, chapter, verse, words };
    });
}

const wordXml = z.object({
  "#text": z.string(),
  "@_lemma": z.string().optional(),
  "@_morph": z.string().optional(),
});
const hebrewXml = z.object({
  osis: z.object({
    osisText: z.object({
      div: z.object({
        chapter: z.array(
          z.object({
            verse: z.array(
              z.object({
                "@_osisID": z.string(),
                w: z.array(wordXml).optional(),
              }),
            ),
          }),
        ),
      }),
    }),
  }),
});
export function parseHebrewBook(xml: string): StudyVerse[] {
  const raw: unknown = parser.parse(xml);
  const data = hebrewXml.parse(raw);
  return data.osis.osisText.div.chapter.flatMap((chapter) =>
    chapter.verse.map((verse) => {
      const parts = verse["@_osisID"].split(".");
      return {
        id: verse["@_osisID"],
        chapter: Number(parts[1]),
        verse: Number(parts[2]),
        words: (verse.w ?? []).map((word) => ({
          // Do not Unicode-normalize OSHB Hebrew; preserve the source's marks.
          surface: word["#text"],
          lemma: word["@_lemma"] ?? "",
          strongs: Array.from(
            new Set(
              Array.from(
                (word["@_lemma"] ?? "").matchAll(/\d{1,5}/g),
                (match) => `H${Number(match[0])}`,
              ),
            ),
          ),
          morphology: word["@_morph"] ? [word["@_morph"]] : [],
        })),
      };
    }),
  );
}
const mapXml = z.object({
  verseMap: z.object({
    book: z.array(
      z.object({
        "@_osisID": z.string(),
        verse: z
          .array(
            z.object({
              "@_wlc": z.string(),
              "@_kjv": z.string(),
              "@_type": z.string(),
            }),
          )
          .optional(),
      }),
    ),
  }),
});
export function hebrewVerseId(
  xml: string,
  osis: string,
  chapter: number,
  verse: number,
) {
  const raw: unknown = parser.parse(xml);
  const english = `${osis}.${chapter}.${verse}`;
  const matches = (
    mapXml.parse(raw).verseMap.book.find((book) => book["@_osisID"] === osis)
      ?.verse ?? []
  ).filter((row) => row["@_kjv"] === english);
  if (matches.some((row) => row["@_type"] !== "full") || matches.length > 1)
    throw new Error(
      "This verse has a partial Hebrew/English alignment. A word study cannot safely assume a one-to-one verse mapping.",
    );
  return matches[0]?.["@_wlc"] ?? english;
}

function plain(text: string) {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
export function strongsEntry(xml: string, id: string) {
  if (!/^[GH]\d{1,5}$/.test(id)) return null;
  const fragment = new RegExp(
    `<li\\b[^>]*\\bid=["']${id[0] === "G" ? "nt" : "ot"}:${Number(id.slice(1))}["'][^>]*>([\\s\\S]*?)<\\/li>`,
  ).exec(xml)?.[1];
  if (!fragment) return null;
  const lemma = /^\s*<i\b[^>]*>([\s\S]*?)<\/i>/.exec(fragment)?.[1] ?? "";
  const transliteration =
    /^\s*<i\b[^>]*title=(["'])(.*?)\1/.exec(fragment)?.[2] ?? "";
  return {
    id,
    lemma: plain(lemma),
    transliteration,
    definition: plain(fragment).slice(0, 4000),
  };
}

const hebrewNames = [
  "Gen",
  "Exod",
  "Lev",
  "Num",
  "Deut",
  "Josh",
  "Judg",
  "Ruth",
  "1Sam",
  "2Sam",
  "1Kgs",
  "2Kgs",
  "1Chr",
  "2Chr",
  "Ezra",
  "Neh",
  "Esth",
  "Job",
  "Ps",
  "Prov",
  "Eccl",
  "Song",
  "Isa",
  "Jer",
  "Lam",
  "Ezek",
  "Dan",
  "Hos",
  "Joel",
  "Amos",
  "Obad",
  "Jonah",
  "Mic",
  "Nah",
  "Hab",
  "Zeph",
  "Hag",
  "Zech",
  "Mal",
];
const greekNames: Record<string, string> = {
  MRK: "MAR",
  JHN: "JOH",
  JAS: "JAM",
  "1JN": "1JO",
  "2JN": "2JO",
  "3JN": "3JO",
};

export async function wordStudy(ref: BibleReference) {
  if (
    ref.verse === undefined ||
    ref.endVerse !== ref.verse ||
    ref.endChapter !== ref.chapter
  )
    throw new Error(
      "Choose one verse for an original-language word study, such as John 3:16.",
    );
  const bookIndex = BIBLE_BOOKS.findIndex(([id]) => id === ref.bookId);
  const hebrew = bookIndex >= 0 && bookIndex < 39;
  const name = hebrew
    ? hebrewNames[bookIndex]
    : (greekNames[ref.bookId] ?? ref.bookId);
  const bookUrl = hebrew
    ? `${hebrewBase}${name}.xml`
    : `${greekBase}${name}.csv`;
  const [bookText, dictionary, verseMap] = await Promise.all([
    resource(bookUrl),
    resource(dictionaryUrl),
    hebrew ? resource(`${hebrewBase}VerseMap.xml`) : Promise.resolve(""),
  ]);
  const verses = hebrew
    ? parseHebrewBook(bookText)
    : parseGreekBook(bookText, ref.bookId);
  const originalId = hebrew
    ? hebrewVerseId(verseMap, name, ref.chapter, ref.verse)
    : `${ref.bookId}.${ref.chapter}.${ref.verse}`;
  const verse = verses.find((v) => v.id === originalId);
  if (!verse?.words.length)
    throw new Error(
      "This original-language edition does not contain the requested verse.",
    );
  if (verse.words.length > 300)
    throw new Error("This verse exceeds the word-study limit.");
  const ids = Array.from(new Set(verse.words.flatMap((word) => word.strongs)));
  const entries = ids.flatMap((id) => {
    const entry = strongsEntry(dictionary, id);
    return entry ? [entry] : [];
  });
  const context = verses
    .filter(
      (v) =>
        v.chapter === verse.chapter && Math.abs(v.verse - verse.verse) <= 1,
    )
    .map((v) => ({ id: v.id, text: v.words.map((w) => w.surface).join(" ") }));
  const occurrences = ids.map((id) => {
    const examples = verses
      .filter(
        (v) =>
          v.id !== originalId &&
          v.words.some((word) => word.strongs.includes(id)),
      )
      .slice(0, 8)
      .map((v) => ({
        id: v.id,
        text: v.words.map((word) => word.surface).join(" "),
      }));
    return { id, references: examples.map((verse) => verse.id), examples };
  });
  return {
    reference: ref.reference,
    originalId,
    language: hebrew ? "Hebrew / Biblical Aramaic" : "Greek",
    edition: hebrew
      ? "Open Scriptures Hebrew Bible / Westminster Leningrad Codex"
      : "Robinson-Pierpont 2018 Byzantine Greek text (unaccented parsed edition)",
    words: verse.words,
    entries,
    context,
    occurrences,
    notices: [
      "English words are not automatically aligned to these words. Select an original-language word; Strong’s numbers identify dictionary entries, not a single contextual meaning.",
      "Occurrences shown are bounded examples in this book, not an exhaustive concordance.",
      "Dictionary entries reproduce a historical reference work, not a modern contextual lexicon. Missing spellings or entries are left missing.",
      ...(hebrew
        ? []
        : [
            "This Byzantine textform can differ from the critical Greek text underlying NIV.",
          ]),
    ],
    sources: [
      {
        title: hebrew
          ? "Original work of the Open Scriptures Hebrew Bible"
          : "Robinson-Pierpont / ByzTxt",
        url: hebrew
          ? "https://github.com/openscriptures/morphhb"
          : "https://github.com/ByzTxt/byzantine-majority-text",
        license: hebrew
          ? "WLC text: public domain; lemma/morphology: CC BY 4.0"
          : "Public domain",
        revision: hebrew ? HEBREW_REV : GREEK_REV,
        sourceUrl: bookUrl,
        licenseUrl: hebrew
          ? "https://creativecommons.org/licenses/by/4.0/"
          : "https://github.com/ByzTxt/byzantine-majority-text/blob/27a45ff1b7be6c17ccbfeac414f3f55732ae8e28/README.md",
        attribution: hebrew
          ? "Original work of the Open Scriptures Hebrew Bible available at https://github.com/openscriptures/morphhb. Verse tokens and lemma/morphology tags extracted; Hebrew marks are not normalized."
          : "Robinson-Pierpont / ByzTxt public-domain parsed Greek text. Verse tokens and tags extracted.",
      },
      {
        title: "Open Scriptures unified Strong’s dictionaries",
        url: "https://github.com/openscriptures/strongs",
        license: "GPL-3.0 (electronic transcription)",
        revision: STRONGS_REV,
        sourceUrl: dictionaryUrl,
        licenseUrl: "https://www.gnu.org/licenses/gpl-3.0.txt",
        attribution:
          "Copyright (c) 2008 Open Scriptures. Unicode spellings enhanced by Darrell H. Smith (2009). Dictionary excerpts remain GPL-3.0, separate from the application’s code license. Changes: selected entries extracted, markup removed and whitespace collapsed; definitions limited to 4,000 characters.",
      },
    ],
  };
}
