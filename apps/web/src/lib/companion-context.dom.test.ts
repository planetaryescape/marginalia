// @vitest-environment happy-dom

import {
  LOCAL_PARAGRAPH_CHARS,
  MAX_CONTEXT_CHARS,
} from "@marginalia/backend/local-context";
import { expect, it } from "vitest";
import { companionContext, isSummarySelection } from "./companion-context";

it("distinguishes summary prose from verse wording and rejects a mixed selection", () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<section aria-label="Summary"><p>ascetic</p></section><div data-article-body><p id="COL.2.1">regulations</p></div>';
  const summary = container.querySelector("section p")?.firstChild;
  const verse = container.querySelector("[data-article-body] p")?.firstChild;
  if (!summary || !verse) throw new Error("Missing fixture text");
  const range = document.createRange();
  range.selectNodeContents(summary);
  expect(isSummarySelection(range)).toBe(true);
  range.setEnd(verse, 3);
  expect(isSummarySelection(range)).toBe(false);
  range.selectNodeContents(verse);
  expect(isSummarySelection(range)).toBe(false);
});

it("uploads only selected original-index neighbours and excludes inline UI", () => {
  const container = document.createElement("div");
  container.innerHTML = `<div data-article-body>${Array.from({ length: 300 }, (_, i) => `<p data-para="${i + 1}">paragraph ${i}</p>`).join("")}</div>`;
  const local = companionContext(container, {
    mode: "explain",
    paragraphIndex: 150,
    paragraphEnd: 152,
  });
  expect(local.paragraphIndices).toEqual([149, 150, 151, 152, 153]);
  expect(local.paragraphs).toEqual(
    [149, 150, 151, 152, 153].map((i) => `paragraph ${i}`),
  );
  const define = companionContext(container, {
    mode: "define",
    paragraphIndex: 200,
  });
  expect(define.paragraphIndices).toEqual([200]);
  expect(define.paragraphs).toEqual(["paragraph 200"]);
  expect(
    companionContext(container, { mode: "article", paragraphIndex: null })
      .paragraphs,
  ).toHaveLength(300);
});

it("bounds huge local packets around the actual repeated occurrence and retains its sentence", () => {
  const container = document.createElement("div");
  const text = `${"The river bank is muddy. ".repeat(12_000)}This bank lends money.`;
  container.innerHTML = '<div data-article-body><p data-para="150"></p></div>';
  container.querySelector("p")!.textContent = text;
  const local = companionContext(container, {
    mode: "define",
    paragraphIndex: 149,
    selection: "bank",
    occurrence: 12_000,
  });
  expect(local.paragraphIndices).toEqual([149]);
  expect(local.paragraphs[0].length).toBeLessThanOrEqual(LOCAL_PARAGRAPH_CHARS);
  expect(local.paragraphs[0]).toContain("This bank lends money.");
  expect(local.sentence).toBe("This bank lends money.");
  expect(local.contextOccurrence).toBeGreaterThan(0);
  expect(local.contextOccurrence).toBeLessThan(12_000);
  expect(JSON.stringify(local).length).toBeLessThan(25_000);
});

it("bounds multi-paragraph selections even when an older kept thread lacks its end index", () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<div data-article-body><p data-para="1">neighbour before</p><p data-para="2"></p><p data-para="3"></p><p data-para="4">neighbour after</p></div>';
  container.querySelector('[data-para="2"]')!.textContent =
    `${"x".repeat(145_000)}selected tail`;
  container.querySelector('[data-para="3"]')!.textContent =
    `selected head${"y".repeat(145_000)}`;
  const local = companionContext(container, {
    mode: "explain",
    paragraphIndex: 1,
    selection: "selected tail selected head",
  });
  expect(local.paragraphEnd).toBe(2);
  expect(local.paragraphIndices).toEqual([0, 1, 2, 3]);
  expect(local.paragraphs.join("")).toContain("selected tail");
  expect(local.paragraphs.join("")).toContain("selected head");
  expect(
    local.paragraphs.reduce((sum, text) => sum + text.length, 0),
  ).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  expect(JSON.stringify(local).length).toBeLessThan(45_000);
});
