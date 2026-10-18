// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesList } from "./notes-list";

const mocks = vi.hoisted(() => ({
  headerCalls: [] as string[][],
  listAll: [] as unknown[] | undefined,
  listKept: [] as unknown[] | undefined,
  removeThread: vi.fn(),
  removeNote: vi.fn(),
  push: vi.fn(),
  // articleId -> the article, or null when it has been deleted
  articles: {} as Record<string, object | null>,
  marks: {
    results: [] as unknown[],
    status: "Exhausted" as string,
    loadMore: vi.fn(),
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args?: { articleIds?: string[] } | "skip") => {
    if (ref === "threadBody") return mocks.listKept?.[0];
    if (ref !== "headers") return (mocks as never)[ref];
    if (args === "skip") return undefined;
    mocks.headerCalls.push(args?.articleIds ?? []);
    return args?.articleIds?.map((articleId) => ({
      articleId,
      article: mocks.articles[articleId],
    }));
  },
  useMutation: (ref: string) => (mocks as never)[ref],
  usePaginatedQuery: (ref: string) =>
    ref === "listMine"
      ? mocks.marks
      : {
          results: (mocks as never)[ref] ?? [],
          status:
            (mocks as never)[ref] === undefined
              ? "LoadingFirstPage"
              : "Exhausted",
          loadMore: vi.fn(),
        },
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    userNotes: { listPreviews: "listAll", remove: "removeNote" },
    companionThreads: {
      listKeptPreviews: "listKept",
      getBody: "threadBody",
      remove: "removeThread",
    },
    articleMetadata: { headers: "headers" },
    highlights: { listMine: "listMine" },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: PropsWithChildren<{ href: string; className?: string }>) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const note = (over: object) => ({
  _id: "n1",
  articleId: "art1",
  selectedText: "",
  contentPlain: "My own thought",
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});
const thread = (over: object) => ({
  _id: "t1",
  articleId: "art1",
  mode: "define",
  selection: "tarn",
  turns: [{ role: "assistant", content: "A small mountain lake." }],
  keptAt: 2000,
  createdAt: 2000,
  updatedAt: 2000,
  ...over,
});
const mark = (over: object) => ({
  _id: "h1",
  articleId: "art1",
  kind: "highlight",
  text: "The number was large enough",
  createdAt: 1500,
  ...over,
});
const ARTICLE = { title: "The quiet cost", url: "https://www.example.com/a" };

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.listAll = [];
  mocks.headerCalls = [];
  mocks.listKept = [];
  mocks.articles = { art1: ARTICLE, art2: ARTICLE };
  mocks.marks = { results: [], status: "Exhausted", loadMore: vi.fn() };
  mocks.removeThread.mockReset();
  mocks.push.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<NotesList />));
const lines = () => [
  ...host.querySelectorAll<HTMLElement>('[data-hand="pencil"] > button'),
];

describe("the Notes page", () => {
  it("batches small headings within the article read-byte bound", async () => {
    mocks.listAll = Array.from({ length: 9 }, (_, i) =>
      note({ _id: `n${i}`, articleId: `a${i}` }),
    );
    for (let i = 0; i < 9; i++) mocks.articles[`a${i}`] = ARTICLE;
    await render();
    expect(mocks.headerCalls.map((ids) => ids.length)).toEqual([8, 1]);
    expect(host.querySelectorAll("a.text-xl")).toHaveLength(9);
  });
  it("shows a kept answer as one pencil line under its article, and expands it in place", async () => {
    mocks.listKept = [thread({})];
    await render();
    expect(host.textContent).not.toContain("No notes yet");
    const [line] = lines();
    expect(line.textContent).toContain("Marginalia’s answer · Define");
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("A small mountain lake.");
    await act(async () => line.click());
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("A small mountain lake.");
    expect(host.textContent).toContain("tarn");
  });

  it("puts the answer under the same article as the reader's notes, notes first", async () => {
    mocks.listAll = [note({})];
    mocks.listKept = [thread({})];
    await render();
    expect(
      host.querySelectorAll('a[href="/read/art1"]').length,
    ).toBeGreaterThan(0);
    const text = host.textContent ?? "";
    expect(text.indexOf("My own thought")).toBeLessThan(
      text.indexOf("Marginalia’s answer"),
    );
    // One article heading for both
    expect(host.querySelectorAll("a.text-xl")).toHaveLength(1);
  });

  it("orders articles by their most recent note or kept answer", async () => {
    mocks.articles = { old: ARTICLE, new: ARTICLE };
    mocks.listAll = [note({ articleId: "old", updatedAt: 100, _id: "n1" })];
    mocks.listKept = [thread({ articleId: "new", keptAt: 5000, _id: "t9" })];
    await render();
    const hrefs = [
      ...host.querySelectorAll<HTMLAnchorElement>("a.text-xl"),
    ].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/read/new", "/read/old"]);
  });

  it("deletes a kept answer by removing its record", async () => {
    mocks.listKept = [thread({})];
    await render();
    await act(async () => lines()[0].click());
    const del = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Delete",
    ) as HTMLElement;
    await act(async () => del.click());
    expect(mocks.removeThread).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("shows a failed delete on the page with Retry, and the answer stays", async () => {
    mocks.listKept = [thread({})];
    mocks.removeThread.mockRejectedValueOnce(new Error("offline"));
    await render();
    await act(async () => lines()[0].click());
    const del = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Delete",
    ) as HTMLElement;
    await act(async () => del.click());
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't delete the answer.");
    expect(host.textContent).toContain("A small mountain lake.");
    await act(async () => alert?.querySelector("button")?.click());
    expect(mocks.removeThread).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("waits for both lists, and says so when there is nothing", async () => {
    mocks.listKept = undefined;
    await render();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    mocks.listKept = [];
    await render();
    expect(host.textContent).toContain("No notes yet");
  });
  it("lays a note out with its line in italic and its words under a pen rule", async () => {
    mocks.listAll = [note({ selectedText: "a quoted line" })];
    await render();
    const quote = [...host.querySelectorAll("blockquote")].find(
      (b) => b.textContent === "a quoted line",
    );
    expect(quote?.className).toContain("italic");
    const words = [...host.querySelectorAll("p")].find(
      (p) => p.textContent === "My own thought",
    );
    expect(words?.className).toContain("border-[var(--pen)]");
  });

  it("shows highlights in the highlighter and underlines with a pen underline", async () => {
    mocks.marks.results = [
      mark({ _id: "h1", text: "a highlighted line" }),
      mark({ _id: "h2", kind: "underline", text: "an underlined line" }),
    ];
    await render();
    const hi = [...host.querySelectorAll("span")].find(
      (s) => s.textContent === "a highlighted line",
    );
    const ul = [...host.querySelectorAll("span")].find(
      (s) => s.textContent === "an underlined line",
    );
    expect(hi?.className).toContain("bg-[var(--highlighter)]");
    expect(ul?.className).toContain("decoration-[var(--pen)]");
    expect(ul?.className).not.toContain("bg-[var(--highlighter)]");
  });

  it("shows a mark in its own colour, whatever the reader's highlighter is now", async () => {
    mocks.marks.results = [
      mark({ _id: "h1", color: "pink", text: "a pink line" }),
      mark({
        _id: "h2",
        kind: "underline",
        color: "vermilion",
        text: "a red line",
      }),
    ];
    await render();
    const find = (text: string) =>
      [...host.querySelectorAll("span")].find((s) => s.textContent === text);
    expect(find("a pink line")?.getAttribute("data-color")).toBe("pink");
    expect(find("a pink line")?.className).toContain("bg-[var(--mark)]");
    expect(find("a red line")?.getAttribute("data-color")).toBe("vermilion");
    expect(find("a red line")?.className).toContain("decoration-[var(--mark)]");
  });

  it("keeps each article's notes, marks and answers in the order they were made", async () => {
    mocks.listAll = [note({ contentPlain: "first note", createdAt: 100 })];
    mocks.marks.results = [mark({ text: "a mark", createdAt: 200 })];
    mocks.listKept = [thread({ keptAt: 300 })];
    await render();
    const text = host.textContent ?? "";
    expect(text.indexOf("first note")).toBeLessThan(text.indexOf("a mark"));
    expect(text.indexOf("a mark")).toBeLessThan(
      text.indexOf("Marginalia’s answer"),
    );
  });

  it("links a note, a mark and a kept answer to the reader at their line", async () => {
    mocks.listAll = [note({ selectedText: "the passage" })];
    mocks.marks.results = [mark({ text: "a marked line" })];
    mocks.listKept = [thread({ selection: "tarn" })];
    await render();
    const hrefs = [...host.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(
      hrefs.filter((h) => h?.startsWith("/read/art1?quote=the+passage")),
    ).toHaveLength(1);
    expect(
      hrefs.find((h) => h?.startsWith("/read/art1?quote=the+passage")),
    ).toMatch(/&note=/);
    expect(hrefs).toContain("/read/art1?quote=a+marked+line");
    await act(async () => lines()[0].click());
    const answerHrefs = [...host.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(
      answerHrefs.find((h) => h?.startsWith("/read/art1?quote=tarn")),
    ).toMatch(/&answer=/);
  });

  it("loads the next page of marks on Show more, and hides it when there are none left", async () => {
    mocks.marks = {
      results: [mark({})],
      status: "CanLoadMore",
      loadMore: vi.fn(),
    };
    await render();
    const more = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Show more",
    ) as HTMLElement;
    await act(async () => more.click());
    expect(mocks.marks.loadMore).toHaveBeenCalledWith(25);
    mocks.marks = {
      results: [mark({})],
      status: "Exhausted",
      loadMore: vi.fn(),
    };
    await render();
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Show more",
      ),
    ).toBe(false);
  });

  it("waits for the first page of marks before showing the notes", async () => {
    mocks.listAll = [note({})];
    mocks.marks = {
      results: [],
      status: "LoadingFirstPage",
      loadMore: vi.fn(),
    };
    await render();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Loading notes",
    );
    expect(host.textContent).not.toContain("My own thought");
  });

  it("keeps the page usable when an article has been deleted", async () => {
    mocks.articles = { art1: null, art2: ARTICLE };
    mocks.listAll = [
      note({ articleId: "art1", contentPlain: "orphaned note" }),
    ];
    mocks.marks.results = [mark({ articleId: "art2", text: "still here" })];
    await render();
    expect(host.textContent).toContain("Article no longer in your library");
    expect(host.textContent).toContain("orphaned note");
    expect(host.textContent).toContain("still here");
    expect(host.querySelector('a[href="/read/art1"]')).toBeNull();
    expect(host.querySelector('a[href="/read/art2"]')).not.toBeNull();
  });
});
