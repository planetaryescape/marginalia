// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BibleWordStudy } from "./bible-word-study";

const words = vi.hoisted(() => vi.fn());
const explain = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "actions/bible:originalWords" ? words : explain,
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
  it("opens from the normal reader’s Define action using a verse identity, without sending English wording", async () => {
    await act(async () => root.render(<BibleWordStudy reference="John 1" />));
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("bible-word-study", {
          detail: { reference: "John 1:1" },
        }),
      ),
    );
    expect(document.querySelector("details")?.open).toBe(true);
    expect(words).toHaveBeenCalledWith({ reference: "John 1:1" });
    expect(explain).not.toHaveBeenCalled();
  });
});
