// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LibraryPage from "./page";

const shelf = vi.hoisted(() => ({
  value: null as string | null,
  topic: null as string | null,
}));

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams();
    if (shelf.value) params.set("shelf", shelf.value);
    if (shelf.topic) params.set("topic", shelf.topic);
    return params;
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    switch (getFunctionName(ref as Parameters<typeof getFunctionName>[0])) {
      case "home:counts":
        return { waiting: 130, upNext: [], countsReady: true };
      case "savedArticles:count":
        return 1;
      case "lovedArticles:count":
        return 4;
      case "impressions:recentCount":
        return 1;
      case "impressions:listRecent":
        return [
          {
            _id: "i1",
            articleId: "a2",
            title: "A finished piece",
            rating: 3,
            tags: ["tools"],
            note: "It stayed",
            updatedAt: 1,
          },
        ];
      default:
        return undefined;
    }
  },
  usePaginatedQuery: (ref: unknown) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    if (name === "savedArticles:page")
      return {
        results: [
          {
            _id: "s1",
            article: {
              _id: "a1",
              title: "A saved piece",
              estimatedReadMinutes: 9,
              annotationStatus: "pending",
            },
          },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
      };
    return name === "tags:articlesForTopic"
      ? {
          results: [
            {
              _id: "t1",
              title: "A topic piece",
              url: "https://www.example.com/p",
              minutes: 7,
              finished: false,
              annotating: false,
            },
          ],
          status: "CanLoadMore",
          loadMore: vi.fn(),
        }
      : { results: [], status: "Exhausted", loadMore: vi.fn() };
  },
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));

describe("Library shelves", () => {
  beforeEach(() => {
    shelf.value = null;
    shelf.topic = null;
  });

  it("opens on Up next with the four shelves as text tabs and their counts", () => {
    const html = renderToStaticMarkup(<LibraryPage />);
    const tabs =
      html.match(/<nav aria-label="Shelves"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(tabs).toContain('href="/library" aria-current="page"');
    expect(tabs).toContain('href="/library?shelf=saved"');
    expect(tabs).toContain('href="/library?shelf=loved"');
    expect(tabs).toContain('href="/library?shelf=finished"');
    expect(tabs).toContain("130");
    expect(tabs).toContain(">4<");
    expect(html).not.toContain("Your impressions");
  });

  it("lists the articles of a topic from ?topic= in place of the shelves", () => {
    shelf.topic = "deep work";
    const html = renderToStaticMarkup(<LibraryPage />);
    expect(html).toContain("Articles about deep work");
    expect(html).toContain("A topic piece");
    expect(html).toContain("example.com · 7 min read");
    expect(html).toContain("More");
    expect(html).not.toContain('aria-label="Shelves"');
  });

  it("selects the Saved shelf from the URL and drops the other shelves", () => {
    shelf.value = "saved";
    const html = renderToStaticMarkup(<LibraryPage />);
    expect(html).toContain('href="/library?shelf=saved" aria-current="page"');
    expect(html).toContain("A saved piece");
    expect(html).not.toContain("A finished piece");
  });

  it("says annotating in a row's meta while its notes are still being written", () => {
    shelf.value = "saved";
    const html = renderToStaticMarkup(<LibraryPage />);
    expect(html).toContain("9 min read · annotating");
  });

  it("shows ratings as stars in the reader's pen, not squares (D-DES-032)", () => {
    shelf.value = "finished";
    const html = renderToStaticMarkup(<LibraryPage />);
    expect(html).toContain('aria-label="Fine"');
    expect(html).not.toContain("rounded-[2px]");
    expect(html.match(/text-\[var\(--pen\)\]/g)).toHaveLength(3);
    expect(html.match(/text-\[var\(--ink-muted\)\]/g)).toHaveLength(2);
    expect(html).toContain("It stayed");
  });
});
