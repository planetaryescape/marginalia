import { type FunctionReference, getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FeedsPage from "./feeds/page";
import DeskLayout from "./layout";
import LibraryPage from "./library/page";
import NotesPage from "./notes/page";
import HomePage from "./page";
import ReadingPage from "./reading/page";
import SavedPage from "./saved/page";

interface NoteFixture {
  _id: string;
  articleId: string;
  selectedText: string;
  content: string;
  contentPlain: string;
  createdAt: number;
}

const state: {
  notes: NoteFixture[] | undefined;
  pathname: string;
  isOwner: boolean;
} = vi.hoisted(() => ({
  notes: undefined,
  pathname: "/notes",
  isOwner: false,
}));
const applyTheme = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/reader-settings", () => ({
  useReaderSettings: () => ({ settings: { theme: "ink" } }),
}));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: applyTheme }));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) => {
    switch (getFunctionName(ref)) {
      case "userNotes:listAll":
        return state.notes;
      case "companionThreads:listKept":
        return [];
      case "savedArticles:count":
        return 1;
      case "articles:getById":
        return { title: "An article I read", author: "An author" };
      case "auth:currentReader":
        return { isOwner: state.isOwner, email: "r@example.com", name: "R" };
      default:
        return undefined;
    }
  },
  useConvex: () => ({ prewarmQuery: vi.fn() }),
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));

describe("Reading desk navigation", () => {
  beforeEach(() => {
    state.notes = undefined;
    state.pathname = "/notes";
    state.isOwner = false;
    applyTheme.mockClear();
  });

  it.each([
    "loading",
    "empty",
    "populated",
  ])("keeps the shared navigation and reader theme when %s", (status) => {
    state.notes =
      status === "loading"
        ? undefined
        : status === "empty"
          ? []
          : [
              {
                _id: "note1",
                articleId: "article1",
                selectedText: "A passage I saved",
                content: "<p>My existing note</p>",
                contentPlain: "My existing note",
                createdAt: 1700000000000,
              },
            ];
    const html = renderToStaticMarkup(
      <DeskLayout>
        <NotesPage />
      </DeskLayout>,
    );
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    for (const path of ["/library", "/notes", "/reading", "/saved", "/feeds"]) {
      expect(header).toContain(`href="${path}"`);
    }
    expect(header).toContain('aria-current="page"');
    expect(html.match(/href="\/library"/g)).toHaveLength(2);
    expect(applyTheme).toHaveBeenCalledWith({ theme: "ink" });
    if (status === "populated") {
      expect(html).toContain("My existing note");
      expect(html).toContain('href="/read/article1"');
    }
  });

  it.each([
    ["/", HomePage],
    ["/library", LibraryPage],
    ["/notes", NotesPage],
    ["/reading", ReadingPage],
    ["/saved", SavedPage],
    ["/feeds", FeedsPage],
  ] as const)("renders one shared shell around %s", (pathname, Page) => {
    state.pathname = pathname;
    const html = renderToStaticMarkup(
      <DeskLayout>
        <Page />
      </DeskLayout>,
    );
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/href="\/library"/g)).toHaveLength(2);
    expect(html).toContain("h-dvh flex flex-col overflow-hidden");
    expect(html).not.toContain("← Back");
    expect(applyTheme).toHaveBeenCalledTimes(1);
  });

  it.each([
    [false, 6],
    [true, 7],
  ])("gives the owner (%s) Readers in the bottom navigation", (isOwner, count) => {
    state.isOwner = isOwner;
    const html = renderToStaticMarkup(
      <DeskLayout>
        <NotesPage />
      </DeskLayout>,
    );
    const mobile =
      html.match(/<nav[^>]*mobile-app-nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(mobile.match(/<a /g)).toHaveLength(count);
    expect(mobile).toContain(`repeat(${count}, minmax(0, 1fr))`);
    expect(mobile.includes('href="/readers"')).toBe(isOwner);
    // On the narrowest phones the seven labels stay as accessible names
    expect(mobile.includes("max-[359px]:sr-only")).toBe(isOwner);
    if (isOwner) expect(mobile).toMatch(/<span[^>]*>Readers<\/span>/);
  });
});
