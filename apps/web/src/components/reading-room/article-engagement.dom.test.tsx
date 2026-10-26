// @vitest-environment happy-dom

import type { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ArticleEngagement } from "./article-engagement";

const report: FunctionReturnType<typeof api.stats.readingEngagement> = {
  period: {
    start: Date.UTC(2026, 9, 1),
    end: Date.UTC(2026, 9, 25),
    timeZone: "UTC",
    period: "month",
    days: 25,
  },
  partial: false,
  articlesPartial: false,
  articles: [
    {
      // SAFETY: the component treats this value as an opaque route segment.
      articleId: "article-one" as Id<"articles">,
      title: "An article",
      wordCount: 2000,
      personalHighlights: 2,
      personalUnderlines: 1,
      notes: 1,
      importedHighlights: 2,
      importedUnderlines: 1,
      aiMarginNotes: 1,
      lastPersonalAt: Date.UTC(2026, 9, 24),
      lastImportedAt: Date.UTC(2026, 9, 23),
      personalMarksPerThousandWords: 1.5,
    },
  ],
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  // SAFETY: React requires this test-only global before rendering DOM roots.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("renders personal marks, imported marks and AI opens in separate columns", async () => {
  await act(async () =>
    root.render(<ArticleEngagement report={report} period="month" />),
  );
  expect(container.textContent).toContain("Your marks and notes");
  expect(container.textContent).toContain(
    "2 highlights · 1 underline · 1 note",
  );
  expect(container.textContent).toContain("AI margin notes opened");
  expect(container.textContent).toContain("1 distinct note");
  expect(container.textContent).toContain("Imported from Readwise");
  expect(container.textContent).toContain("2 highlights · 1 underline");
  expect(container.textContent).toContain("including disagreement");
  expect(
    container.querySelector('a[href="/read/article-one"]')?.textContent,
  ).toBe("An article");
});

it("does not show a response from the previous period", async () => {
  await act(async () =>
    root.render(<ArticleEngagement report={report} period="90days" />),
  );
  expect(container.textContent).toContain("Loading article activity");
  expect(container.textContent).not.toContain("An article");
});

it("gives an empty period a next step", async () => {
  await act(async () =>
    root.render(
      <ArticleEngagement report={{ ...report, articles: [] }} period="month" />,
    ),
  );
  expect(container.textContent).toContain(
    "No marks, notes or AI margin-note opens",
  );
  expect(container.querySelector('a[href="/"]')?.textContent).toBe(
    "Choose an article to read.",
  );
});

it("does not call a bounded empty report complete", async () => {
  await act(async () =>
    root.render(
      <ArticleEngagement
        report={{
          ...report,
          partial: true,
          articlesPartial: true,
          articles: [],
        }}
        period="month"
      />,
    ),
  );
  expect(container.textContent).toContain("This report is incomplete");
  expect(container.textContent).toContain(
    "some article activity may be omitted",
  );
  expect(container.querySelector('a[href="/"]')).toBeNull();
});
