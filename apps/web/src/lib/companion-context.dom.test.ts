// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { companionContext } from "./companion-context";

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
