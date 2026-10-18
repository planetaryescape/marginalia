// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stepNav } from "@/lib/list-nav";
import { DictionaryTab } from "./dictionary-tab";

const mocks = vi.hoisted(() => ({
  calls: [] as {
    path: string;
    args: {
      after?: string | null;
      query?: string;
      letter?: string;
      paginationOpts?: { cursor: string | null };
    };
  }[],
  prepare: vi.fn(),
  complete: true,
  loadingLetter: false,
}));
const head = (wordKey: string, letter = "A") => ({
  _id: wordKey,
  wordKey,
  letter,
  occurrences: 2001,
  preview: "n. preview",
});
vi.mock("convex/react", () => ({
  useMutation: () => mocks.prepare,
  useQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: (typeof mocks.calls)[number]["args"] | "skip",
  ) => {
    if (args === "skip") return undefined;
    const path = getFunctionName(ref);
    mocks.calls.push({ path, args });
    if (path === "dictionary:monthCount")
      return { count: 3, done: true, cursor: null };
    if (path === "dictionary:summary")
      return {
        total: 2100,
        complete: mocks.complete,
        month: 256,
        monthComplete: false,
        monthCursor: "month-next",
        letters: ["#", "A", "E", "Z"].map((letter) => ({
          letter,
          hasWords: true,
        })),
      };
    if (path === "dictionary:headwords") {
      if (args.query === "tail")
        return {
          page: args.after ? [] : [head("retail", "R")],
          done: !!args.after,
          after: args.after ? null : "tail-next",
        };
      if (args.letter === "Z")
        return mocks.loadingLetter
          ? undefined
          : { page: [head("zyzzyva", "Z")], done: true, after: null };
      if (args.query)
        return args.after
          ? { page: [head("rare", "Z")], done: true, after: null }
          : { page: [], done: false, after: "scan1" };
      const start = args.after ? 40 : 0;
      return {
        page: Array.from({ length: 40 }, (_, i) =>
          head(`a${String(start + i).padStart(4, "0")}`),
        ),
        done: false,
        after: "next",
      };
    }
    if (path === "dictionary:senses") {
      const start = args.paginationOpts?.cursor ? 4 : 0;
      return {
        page: Array.from({ length: 4 }, (_, i) => ({
          _id: `s${start + i}`,
          word: "a0000",
          wordKey: "a0000",
          articleId: "art",
          articleTitle: "Book",
          articleGone: false,
          sentence: `sentence${start + i}`,
          sense: `n. distinct${start + i}`,
          unitIndex: 0,
          paragraphIndex: 2,
          createdAt: 1000 + i,
        })),
        isDone: false,
        continueCursor: "sense-next",
      };
    }
    if (path === "dictionary:page")
      return {
        page: [
          {
            _id: "old",
            word: "legacy",
            wordKey: "legacy",
            articleId: "art",
            articleTitle: "Article",
            articleGone: false,
            sentence: "old sentence",
            sense: "n. old",
            createdAt: 1,
          },
        ],
        isDone: false,
        continueCursor: "legacy-next",
      };
    throw new Error(`Unexpected query ${path}`);
  },
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/list-nav", () => ({ stepNav: vi.fn(), useListKeys: vi.fn() }));
vi.mock("@/lib/shortcuts", () => ({ useShortcuts: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.calls = [];
  mocks.complete = true;
  mocks.loadingLetter = false;
  mocks.prepare.mockReset();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  Element.prototype.scrollIntoView = vi.fn();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render() {
  act(() => root.render(<DictionaryTab />));
}
function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  if (!button) throw new Error(`Missing button ${text}`);
  act(() => button.click());
}
function search(value: string) {
  const input = host.querySelector("input");
  if (!input) throw new Error("Missing search input");
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("bounded dictionary DOM", () => {
  it("opens >2000 history without draining pages or mounting all senses, and replaces pages", () => {
    render();
    expect(host.querySelectorAll("article")).toHaveLength(40);
    expect(host.querySelectorAll("*").length).toBeLessThan(400);
    expect(mocks.calls.some((c) => c.path === "dictionary:senses")).toBe(false);
    expect(mocks.calls.some((c) => c.args.after != null)).toBe(false);
    expect(host.textContent).toContain("2100 words · at least 256 this month");
    click("Next words");
    expect(host.querySelectorAll("article")).toHaveLength(40);
    expect(host.textContent).not.toContain("a0000");
    expect(host.textContent).toContain("a0040");
    expect(host.querySelectorAll("h2")[0].textContent).toContain(
      "a0040 — a0059",
    );
  });
  it("loads only the chosen headword and replaces paginated senses, retaining unit links", () => {
    render();
    const button = host.querySelector<HTMLButtonElement>("article button");
    act(() => button?.click());
    expect(host.querySelectorAll("article a")).toHaveLength(4);
    expect(host.querySelector("article a")?.getAttribute("href")).toBe(
      "/read/art?unit=0&quote=sentence0&p=2",
    );
    click("Next senses");
    expect(host.querySelectorAll("article a")).toHaveLength(4);
    expect(host.textContent).not.toContain("distinct0");
    expect(host.textContent).toContain("distinct4");
    click("Close senses");
    expect(host.querySelectorAll("article a")).toHaveLength(0);
  });
  it("jumps directly to a rare letter outside the first page and focuses its first anchor", () => {
    render();
    click("Z");
    expect(host.querySelectorAll("article")).toHaveLength(1);
    expect(document.activeElement?.id).toBe("letter-Z");
    expect(host.textContent).toContain("zyzzyva");
    expect(
      mocks.calls.some(
        (c) =>
          c.path === "dictionary:headwords" &&
          c.args.letter === "Z" &&
          c.args.after === null,
      ),
    ).toBe(true);
  });
  it("never presents an unfinished empty search as no match, and resets continuation when filters change", () => {
    render();
    search("condit");
    expect(host.textContent).toContain("Keep searching to check the rest");
    expect(host.textContent).not.toContain("No word or sense contains");
    click("Keep searching");
    expect(host.textContent).toContain("rare");
    search("new");
    expect(host.textContent).not.toContain("rare");
    expect(mocks.calls.at(-1)?.args.after).toBeNull();
    click("Z");
    expect(host.textContent).toContain("zyzzyva");
  });
  it("keeps initial legacy content during migration without launching background writes or drains", () => {
    mocks.complete = false;
    render();
    expect(host.textContent).toContain("old sentence");
    expect(host.textContent).toContain("filter only checks the current page");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.calls.some((c) => c.args.paginationOpts?.cursor != null)).toBe(
      false,
    );
  });
  it("only continues a bounded month count on explicit intent and removes the lower-bound label when done", () => {
    render();
    expect(mocks.calls.some((c) => c.path === "dictionary:monthCount")).toBe(
      false,
    );
    click("Count more");
    expect(host.textContent).toContain("259 this month");
    expect(host.textContent).not.toContain("at least 259");
  });
  it("keeps keyboard navigation and discards a pending old letter when the filter changes", () => {
    render();
    const input = host.querySelector("input");
    if (!input) throw new Error("Missing input");
    act(() => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(stepNav).toHaveBeenCalledWith(1);
    act(() => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.activeElement).not.toBe(input);
    mocks.loadingLetter = true;
    click("Z");
    search("new filter");
    mocks.loadingLetter = false;
    render();
    expect(host.textContent).not.toContain("zyzzyva");
    expect(host.querySelector("#letter-Z")).toBeNull();
    expect(host.textContent).toContain("Keep searching to check the rest");
  });
  it("does not claim a whole search has no matches when its final continuation page is empty", () => {
    render();
    search("tail");
    expect(host.textContent).toContain("retail");
    click("Keep searching");
    expect(host.textContent).toContain("No more matches.");
    expect(host.textContent).not.toContain("No word or sense contains");
  });
});
