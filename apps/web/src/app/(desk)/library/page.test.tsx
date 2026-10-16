// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LibraryPage from "./page";

const shelf = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(shelf.value ? `shelf=${shelf.value}` : ""),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    switch (getFunctionName(ref as Parameters<typeof getFunctionName>[0])) {
      case "home:overview":
        return { waiting: 130, upNext: [], countsReady: true };
      case "savedArticles:count":
        return 1;
      case "savedArticles:list":
        return [
          {
            _id: "s1",
            article: {
              _id: "a1",
              title: "A saved piece",
              estimatedReadMinutes: 9,
            },
          },
        ];
      case "lovedArticles:listAll":
        return [];
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
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));

describe("Library shelves", () => {
  beforeEach(() => {
    shelf.value = null;
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
    expect(html).not.toContain("Your impressions");
  });

  it("selects the Saved shelf from the URL and drops the other shelves", () => {
    shelf.value = "saved";
    const html = renderToStaticMarkup(<LibraryPage />);
    expect(html).toContain('href="/library?shelf=saved" aria-current="page"');
    expect(html).toContain("A saved piece");
    expect(html).not.toContain("A finished piece");
  });

  it("shows ratings as stars in the pen colour, not squares", () => {
    shelf.value = "finished";
    const html = renderToStaticMarkup(<LibraryPage />);
    expect(html).toContain('aria-label="Fine"');
    expect(html).not.toContain("rounded-[2px]");
    expect(html.match(/text-\[var\(--pen\)\]/g)).toHaveLength(3);
    expect(html.match(/text-\[var\(--ink-muted\)\]/g)).toHaveLength(2);
    expect(html).toContain("It stayed");
  });
});
