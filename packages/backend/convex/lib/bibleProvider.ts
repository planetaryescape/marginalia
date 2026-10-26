import { z } from "zod";
import type { BibleReference } from "./bible";

export const TRANSLATION_CODES = [
  "web",
  "esv",
  "nasb",
  "niv",
  "nlt",
  "msg",
] as const;
export type TranslationCode = (typeof TRANSLATION_CODES)[number];
export const translationCode = z.enum(TRANSLATION_CODES);
const NAMES = {
  web: "World English Bible",
  esv: "English Standard Version",
  nasb: "New American Standard Bible",
  niv: "New International Version",
  nlt: "New Living Translation",
  msg: "The Message",
};
const STYLES = {
  web: "Literal",
  esv: "Literal",
  nasb: "Literal",
  niv: "Balanced",
  nlt: "Thought-for-thought",
  msg: "Paraphrase",
};

export function bibleTranslations() {
  return TRANSLATION_CODES.map((code) => ({
    code,
    name: NAMES[code],
    style: STYLES[code],
    available: code === "web",
  }));
}

export function requireTranslation(code: string): TranslationCode {
  const parsed = translationCode.parse(code);
  if (!bibleTranslations().some((t) => t.code === parsed && t.available))
    throw new Error(
      "That translation needs publisher permission and API access before it can be used here.",
    );
  return parsed;
}

const verseSchema = z.object({
  book_id: z.string(),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  text: z.string().trim().min(1),
});
const publicPassageSchema = z.object({
  translation: z.object({ identifier: z.literal("web") }),
  verses: z.array(verseSchema).min(1).max(176),
});

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function fetchBiblePassage(
  ref: BibleReference,
  code: TranslationCode,
) {
  requireTranslation(code);
  if (code === "web") {
    const url = `https://bible-api.com/data/web/${ref.bookId}/${ref.chapter}`;
    const chapters = await Promise.all(
      Array.from(
        { length: ref.endChapter - ref.chapter + 1 },
        async (_, index) => {
          const chapter = ref.chapter + index;
          const response = await fetch(
            `https://bible-api.com/data/web/${ref.bookId}/${chapter}`,
            { signal: AbortSignal.timeout(15_000) },
          );
          if (!response.ok)
            throw new Error(
              response.status === 404
                ? "That passage wasn't found. Check the chapter and verse numbers."
                : response.status === 429
                  ? "The Bible text service is busy. Wait 30 seconds and try again."
                  : "The Bible text service is unavailable. Please try again.",
            );
          const { verses } = publicPassageSchema.parse(await response.json());
          if (
            verses.some(
              (v) => v.book_id !== ref.bookId || v.chapter !== chapter,
            )
          )
            throw new Error(
              "The Bible text service returned a different passage. Please try again.",
            );
          return verses;
        },
      ),
    );
    const verses = chapters
      .flat()
      .filter(
        (v) =>
          ref.verse === undefined ||
          (v.verse >= ref.verse && v.verse <= (ref.endVerse ?? ref.verse)),
      );
    if (!verses.length)
      throw new Error("That verse range wasn't found in this translation.");
    if (
      ref.verse !== undefined &&
      (verses[0].verse !== ref.verse ||
        verses.at(-1)?.verse !== ref.endVerse ||
        verses.length !== (ref.endVerse ?? ref.verse) - ref.verse + 1)
    )
      throw new Error("That verse range wasn't found in this translation.");
    const content = verses
      .map((v) => `${v.chapter}:${v.verse} ${v.text}`)
      .join("\n\n");
    const contentHtml = verses
      .map(
        (v) =>
          `<p id="${ref.bookId}.${v.chapter}.${v.verse}"><sup>${v.chapter}:${v.verse}</sup> ${escapeHtml(v.text)}</p>`,
      )
      .join("\n");
    return {
      content,
      contentHtml,
      copyright:
        "World English Bible (WEB). Public domain. Text from bible-api.com.",
      url,
    };
  }
  throw new Error("This translation isn't available.");
}
