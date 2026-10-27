/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest, saveTestCredential } from "../test/owner";
import { api } from "./_generated/api";
import * as aiModels from "./lib/aiModels";

const modules = import.meta.glob("./**/*.ts");
const dictionary =
  '<li value="3056" id="nt:3056"><i title="logos">λόγος</i> A word or saying (synthetic test entry).</li>';
const csv =
  "chapter,verse,text\n1,1,εν 1722 {PREP} λογος 3056 {N-NSM}\n1,2,λογος 3056 {N-NSM}\n";
function sources() {
  return vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.hostname === "bible-api.com")
      return Response.json({
        translation: { identifier: "web" },
        verses: [
          {
            book_id: "JHN",
            chapter: 1,
            verse: 1,
            text: "Public WEB study verse",
          },
        ],
      });
    if (url.pathname.endsWith("/JOH.csv")) return new Response(csv);
    if (url.pathname.endsWith("/strongs-dictionary.xhtml"))
      return new Response(dictionary);
    throw new Error(`Unexpected source request: ${url.hostname}`);
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("source-grounded original-language study", () => {
  it("requires Bible opt-in for English definitions and never dispatches an AI model", async () => {
    const t = await ownerTest(modules);
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const generate = vi.spyOn(aiModels, "generateObjectWithFallback");
    await expect(
      t.action(api.actions.bible.defineEnglishWord, { word: "comfort" }),
    ).rejects.toThrow("Enable Bible");
    expect(fetch).not.toHaveBeenCalled();
    await t.mutation(api.bible.setPreferences, { enabled: true });
    expect(
      await t.action(api.actions.bible.defineEnglishWord, { word: "comfort" }),
    ).toMatchObject({ entries: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });
  it("requires opt-in and never needs an AI provider just to inspect words and dictionary entries", async () => {
    const t = await ownerTest(modules);
    const fetch = sources();
    vi.stubGlobal("fetch", fetch);
    await expect(
      t.action(api.actions.bible.originalWords, { reference: "John 1:1" }),
    ).rejects.toThrow("Enable Bible");
    expect(fetch).not.toHaveBeenCalled();
    await t.mutation(api.bible.setPreferences, { enabled: true });
    const study = await t.action(api.actions.bible.originalWords, {
      reference: "John 1:1",
    });
    expect(study.words[1]).toMatchObject({
      surface: "λογος",
      strongs: ["G3056"],
      morphology: ["N-NSM"],
    });
    expect(study.entries[0].lemma).toBe("λόγος");
    expect(
      study.occurrences.find((item) => item.id === "G3056")?.references,
    ).toEqual(["JHN.1.2"]);
    expect(
      study.sources.some((source) => source.license.includes("GPL-3.0")),
    ).toBe(true);
    await expect(
      t.action(api.actions.bible.originalWords, { reference: "John 1" }),
    ).rejects.toThrow("one verse");
    await expect(
      t.action(api.actions.bible.explainOriginalWord, {
        reference: "John 1:1",
        wordIndex: 1,
      }),
    ).rejects.toThrow("Connect an AI provider");
  });
  it("sends verified original words, morphology, selected lexical entries and WEB context, never a licensed display edition", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    await saveTestCredential(t, "default_user", "anthropic", "fixture-key");
    const fetch = sources();
    vi.stubGlobal("fetch", fetch);
    const generate = vi
      .spyOn(aiModels, "generateObjectWithFallback")
      .mockResolvedValue({
        modelId: "anthropic:fixture",
        object: { explanation: "A source-grounded word study." },
      });
    const result = await t.action(api.actions.bible.explainOriginalWord, {
      reference: "John 1:1",
      wordIndex: 1,
    });
    expect(result.explanation).toBe("A source-grounded word study.");
    const input = JSON.stringify(generate.mock.calls[0]);
    for (const evidence of [
      "λογος",
      "λόγος",
      "G3056",
      "N-NSM",
      "JHN.1.2",
      "Public WEB study verse",
      "GPL-3.0",
    ])
      expect(input).toContain(evidence);
    expect(
      fetch.mock.calls.every(([url]) => !url.includes("api.youversion.com")),
    ).toBe(true);
    await expect(
      t.action(api.actions.bible.explainOriginalWord, {
        reference: "John 1:1",
        wordIndex: 299,
      }),
    ).rejects.toThrow("not present");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
