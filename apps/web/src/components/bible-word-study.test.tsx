// @vitest-environment happy-dom
import type { api } from "@marginalia/backend/convex/_generated/api";
import { type FunctionReturnType, getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BibleWordStudy } from "./bible-word-study";

const words = vi.hoisted(() => vi.fn());
const explain = vi.hoisted(() => vi.fn());
const define = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "actions/bible:originalWords"
      ? words
      : getFunctionName(ref) === "actions/bible:defineEnglishWord"
        ? define
        : explain,
}));
let root: Root;
const button = (text: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (node) => node.textContent === text,
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  define.mockReset().mockResolvedValue({
    word: "word",
    entries: [
      {
        phonetic: "/wɜːd/",
        meanings: [
          { partOfSpeech: "noun", definitions: ["A unit of language."] },
        ],
        sourceUrls: ["https://en.wiktionary.org/wiki/word"],
        license: {
          name: "CC BY-SA 3.0",
          url: "https://creativecommons.org/licenses/by-sa/3.0",
        },
      },
    ],
  });
  words.mockReset().mockResolvedValue({
    reference: "John 1:1",
    originalId: "JHN.1.1",
    language: "Greek",
    edition: "Verified Greek edition",
    words: [
      {
        surface: "λογος",
        lemma: "",
        strongs: ["G3056"],
        morphology: ["N-NSM"],
      },
    ],
    entries: [
      {
        id: "G3056",
        lemma: "λόγος",
        transliteration: "logos",
        definition: "Source dictionary definition",
      },
    ],
    occurrences: [{ id: "G3056", references: ["JHN.1.2"] }],
    notices: ["Examples in this book, not an exhaustive concordance"],
    sources: [
      {
        title: "Source attribution",
        url: "https://example.com",
        license: "Public domain",
        revision: "fixture",
      },
    ],
  });
  explain.mockReset().mockResolvedValue({
    explanation: "An evidence-based explanation",
    reference: "John 1:1",
    wordIndex: 0,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
describe("original-language word study in the reader", () => {
  it("does not call AI or sources until requested, then explains a verified original-word position", async () => {
    await act(async () =>
      root.render(<BibleWordStudy reference="John 1:1-5" />),
    );
    expect(words).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
    await act(async () => button("Load original words")?.click());
    expect(words).toHaveBeenCalledWith({ reference: "John 1:1" });
    expect(document.body.textContent).not.toContain(
      "Source dictionary definition",
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label^="Inspect original word"]',
        )
        ?.click(),
    );
    expect(document.body.textContent).toContain("G3056");
    expect(document.body.textContent).toContain("Source dictionary definition");
    expect(document.body.textContent).toContain("JHN.1.2");
    expect(explain).not.toHaveBeenCalled();
    await act(async () => button("Explain this original word")?.click());
    expect(explain).toHaveBeenCalledWith({
      reference: "John 1:1",
      wordIndex: 0,
    });
    expect(document.body.textContent).toContain(
      "An evidence-based explanation",
    );
  });
  it("shows the selected English wording without inventing an original-word match", async () => {
    await act(async () =>
      root.render(<BibleWordStudy reference="John 1:1" selectedText="word" />),
    );
    expect(document.querySelector("details")?.open).toBe(false);
    expect(
      document.querySelector("[data-selected-english]")?.textContent,
    ).toContain("word");
    expect(define).toHaveBeenCalledWith({ word: "word" });
    expect(
      document.querySelector('[aria-label="English meaning"]')?.textContent,
    ).toContain("A unit of language.");
    expect(document.body.textContent).toContain("CC BY-SA 3.0");
    expect(words).not.toHaveBeenCalled();
    await act(async () => button("Load original words")?.click());
    expect(document.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(document.body.textContent).not.toContain(
      "Source dictionary definition",
    );
    expect(document.body.textContent).toContain("logos");
    expect(explain).not.toHaveBeenCalled();
  });
  it("fences a late English response when another word is selected", async () => {
    let resolveOld: (
      value: FunctionReturnType<typeof api.actions.bible.defineEnglishWord>,
    ) => void = () => {};
    define
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ word: "comfort", entries: [] });
    await act(async () =>
      root.render(<BibleWordStudy reference="John 1:1" selectedText="word" />),
    );
    await act(async () =>
      root.render(
        <BibleWordStudy reference="John 1:1" selectedText="comfort" />,
      ),
    );
    await act(async () =>
      resolveOld({
        word: "word",
        entries: [
          {
            phonetic: "old response must not display",
            meanings: [],
            sourceUrls: [],
            license: {
              name: "CC BY-SA 3.0",
              url: "https://creativecommons.org/licenses/by-sa/3.0",
            },
          },
        ],
      }),
    );
    expect(document.body.textContent).not.toContain(
      "old response must not display",
    );
    expect(
      document.querySelector("[data-selected-english]")?.textContent,
    ).toContain("comfort");
  });
});
