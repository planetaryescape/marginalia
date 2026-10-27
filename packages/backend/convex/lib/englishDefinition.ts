import { z } from "zod";

const entrySchema = z.object({
  word: z.string().max(100),
  phonetic: z.string().max(200).optional(),
  meanings: z
    .array(
      z.object({
        partOfSpeech: z.string().max(100),
        definitions: z
          .array(z.object({ definition: z.string().max(4000) }))
          .max(100),
      }),
    )
    .max(30),
  license: z.object({
    name: z.string().max(100),
    url: z.string().url().max(300),
  }),
  sourceUrls: z.array(z.string().url().max(500)).max(30),
});

/** Only a single English headword leaves the app, never the displayed verse.
 * Dictionary meanings are not evidence of alignment to an original-language token. */
export async function englishDefinition(selection: string) {
  const word = selection.trim().toLowerCase();
  if (!/^[a-z]+(?:['’-][a-z]+)*$/.test(word) || word.length > 80)
    return { word: selection.slice(0, 200), entries: [] };
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (response.status === 404) return { word, entries: [] };
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length")) > 256_000
  )
    throw new Error(
      `The English dictionary is unavailable (HTTP ${response.status}; body ${response.body ? "present" : "missing"}; size ${Number(response.headers.get("content-length")) > 256_000 ? "over_limit" : "within_limit"}). Try again later.`,
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256_000)
        throw new Error("The English dictionary response is too large.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const entries = z.array(entrySchema).max(30).parse(JSON.parse(text));
  return {
    word,
    entries: entries
      .slice(0, 3)
      .filter((entry) => entry.word.toLowerCase() === word)
      .map((entry) => ({
        phonetic: entry.phonetic ?? "",
        meanings: entry.meanings.slice(0, 4).map((meaning) => ({
          partOfSpeech: meaning.partOfSpeech,
          definitions: meaning.definitions
            .slice(0, 2)
            .map((item) => item.definition),
        })),
        license: entry.license,
        sourceUrls: entry.sourceUrls
          .filter((url) => new URL(url).origin === "https://en.wiktionary.org")
          .slice(0, 3),
      }))
      .filter(
        (entry) =>
          entry.sourceUrls.length &&
          /^https:\/\/creativecommons\.org\/licenses\//.test(entry.license.url),
      ),
  };
}
