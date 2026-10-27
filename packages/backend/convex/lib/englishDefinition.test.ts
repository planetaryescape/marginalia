import { afterEach, expect, it, vi } from "vitest";
import { englishDefinition } from "./englishDefinition";

afterEach(() => vi.unstubAllGlobals());
const entry = {
  word: "comfort",
  meanings: [
    {
      partOfSpeech: "verb",
      definitions: [{ definition: "To relieve distress." }],
    },
  ],
  license: {
    name: "CC BY-SA 3.0",
    url: "https://creativecommons.org/licenses/by-sa/3.0",
  },
  sourceUrls: ["https://en.wiktionary.org/wiki/comfort"],
};
it("returns attributed ordinary English meanings without a model or verse context", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json([entry]));
  vi.stubGlobal("fetch", fetch);
  expect(await englishDefinition("Comfort")).toMatchObject({
    word: "comfort",
    entries: [
      {
        meanings: [{ definitions: ["To relieve distress."] }],
        sourceUrls: entry.sourceUrls,
        license: entry.license,
      },
    ],
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "https://api.dictionaryapi.dev/api/v2/entries/en/comfort",
  );
  expect(fetch.mock.calls[0][1].body).toBeUndefined();
});
it("does not transmit phrases, URLs or arbitrary display context to the dictionary", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const text of ["a whole verse", "https://example.com", "x".repeat(81)])
    expect((await englishDefinition(text)).entries).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it("does not invent a definition for a missing word or unattributed entry", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(
        Response.json([{ ...entry, sourceUrls: ["javascript:alert(1)"] }]),
      ),
  );
  expect((await englishDefinition("unknownword")).entries).toEqual([]);
  expect((await englishDefinition("comfort")).entries).toEqual([]);
});
it("bounds streamed source responses even without a content-length header", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("x".repeat(256_001))),
  );
  await expect(englishDefinition("comfort")).rejects.toThrow("too large");
});

it("diagnoses rejection with only safe HTTP and body-bound signals", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("private-upstream-payload-canary", { status: 403 }),
      ),
  );
  await expect(englishDefinition("comfort")).rejects.toThrow(
    "HTTP 403; body present; size within_limit",
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("private-upstream-payload-canary", { status: 403 }),
      ),
  );
  await expect(englishDefinition("comfort")).rejects.not.toThrow(
    "private-upstream-payload-canary",
  );
});
