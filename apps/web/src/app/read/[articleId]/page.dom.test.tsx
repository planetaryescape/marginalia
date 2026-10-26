// @vitest-environment happy-dom

import { sourceHash } from "@marginalia/backend/prepared-representation";
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/reader-settings";
import ReadPage from "./page";

// Test settled UI states; happy-dom cannot finish/cancel native motion reliably.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const { createElement, Fragment } = await import("react");
  const tags = new Map<string, unknown>();
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => {
          if (!tags.has(tag))
            tags.set(
              tag,
              ({
                children,
                initial: _initial,
                animate: _animate,
                exit: _exit,
                transition: _transition,
                variants: _variants,
                layout: _layout,
                ...props
              }: Record<string, unknown>) =>
                createElement(tag, props, children as React.ReactNode),
            );
          return tags.get(tag);
        },
      },
    ),
  };
});

const state = vi.hoisted(() => ({
  progress: 0,
  empty: [],
  noop: () => {},
  asyncNoop: async () => {},
  observers: 0,
  reflectionSaved: true,
  bible: false,
  licensed: false,
  summarize: vi.fn(async () => {}),
  reflection: null as {
    _id: string;
    strongestPoint: string;
    weakestAssumption: string;
    credibleCounterview: string;
    questionForYou: string;
  } | null,
  finish: vi.fn(async () => {}),
  push: vi.fn(),
  query: vi.fn(),
  open: vi.fn(),
  stop: vi.fn(),
  loadMore: vi.fn(),
  pages: [] as { name: string; args: unknown }[],
  params: "",
  scopeReady: true,
  more: false,
  landed: false,
  marginMode: "sidenotes",
  fragmented: false,
  clicked: [] as string[],
  thread: null as import("@/lib/companion").CompanionThread | null,
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ articleId: "article-1" }),
  useSearchParams: () => new URLSearchParams(state.params),
  useRouter: () => ({ push: state.push, replace: state.noop }),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name === "annotations:listByArticle") return annotations;
    if (name === "reflections:getByArticle") return state.reflection;
    if (
      [
        "userNotes:listByArticle",
        "companionThreads:listByArticle",
        "highlights:listByArticle",
      ].includes(name)
    )
      return state.empty;
    return null;
  },
  useMutation: () => state.asyncNoop,
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "actions/summarize:generate"
      ? state.summarize
      : state.asyncNoop,
  useConvex: () => ({ query: state.query }),
  usePaginatedQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: unknown,
  ) => {
    const name = getFunctionName(ref);
    state.pages.push({ name, args });
    return {
      results:
        args === "skip"
          ? state.empty
          : name === "annotations:listPresentationByArticle"
            ? annotations
            : state.empty,
      status:
        args === "skip"
          ? "LoadingFirstPage"
          : state.more
            ? "CanLoadMore"
            : "Exhausted",
      loadMore: state.loadMore,
    };
  },
}));
const annotations = [{ _id: "a1", type: "context", content: "A margin note." }];
const article = {
  title: "Invented article",
  content: "Invented prose",
  contentHtml: "<p>Invented prose</p>",
  url: "https://example.com",
  wordCount: 2,
  annotationStatus: "annotated",
  estimatedReadMinutes: 1,
};
vi.mock("@/lib/use-book-reading", () => ({
  useReadable: () => ({
    article: state.licensed
      ? {
          ...article,
          title: "Psalms 23",
          content: "Licensed-display-canary",
          contentHtml: "<p>Licensed-display-canary</p>",
        }
      : state.bible
        ? {
            ...article,
            _id: "article-1",
            bible: {
              reference: "Psalms 23",
              translation: "web",
              copyright: "Public domain",
            },
          }
        : article,
    sourceArticle: state.licensed
      ? {
          ...article,
          title: "Psalms 23",
          content: "23:1 Public-domain WEB source",
          contentHtml: undefined,
          bible: {
            reference: "Psalms 23",
            translation: "web",
            displayVersionId: 111,
            copyright: "Public domain",
          },
        }
      : undefined,
    isBook: false,
    unitIndex: null,
    scopeReady: state.scopeReady,
  }),
  useBookProgress: () => {},
}));
vi.mock("@/lib/reader-settings", async (original) => {
  const module = await original<typeof import("@/lib/reader-settings")>();
  return {
    ...module,
    useReaderSettings: () => ({
      settings: DEFAULT_SETTINGS,
      update: state.noop,
      resetText: state.noop,
    }),
  };
});
vi.mock("@/lib/companion", () => ({
  usePassageHighlight: () => {},
  useCompanion: () => ({
    answers: state.empty,
    thread: state.thread,
    openId: null,
    start: state.noop,
    collapse: state.noop,
    open: state.open,
    stop: state.stop,
    openAnswer: state.noop,
    startArticle: state.noop,
    keep: state.asyncNoop,
    remove: state.asyncNoop,
    forget: state.noop,
  }),
}));
vi.mock("@/lib/use-engagement-tracker", () => ({
  useEngagementTracker: () => ({
    progress: state.progress,
    trackAnnotationOpen: state.noop,
    finish: state.finish,
    retry: state.asyncNoop,
  }),
}));
vi.mock("@/lib/reading-modes", () => ({
  useReadingPosition: () => ({ current: 0, firstVisible: 0, lastVisible: 0 }),
  useListen: () => ({ active: false, stop: state.noop }),
}));
vi.mock("@/lib/use-margin-mode", () => ({
  useMarginMode: () => state.marginMode,
  usePrefersReducedMotion: () => true,
}));
vi.mock("@/lib/highlights", () => ({
  useHighlights: () => state.empty,
  findMark: () => null,
}));
vi.mock("@/lib/saved-passages", () => ({
  useSavedPassages: () => state.empty,
}));
vi.mock("@/lib/use-mark-paint", () => ({ useMarkPaint: () => {} }));
vi.mock("@/lib/use-mark-default", () => ({
  useSetMarkDefault: () => state.noop,
  useLegacyMarkDefaults: () => ({ colors: DEFAULT_SETTINGS }),
}));
vi.mock("@/lib/use-read-alongside", () => ({ useReadAlongside: () => null }));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: () => {} }));
vi.mock("@/lib/use-place-restore", () => ({ usePlaceRestore: () => {} }));
vi.mock("@/lib/use-quote-landing", async (original) => ({
  ...(await original<typeof import("@/lib/use-quote-landing")>()),
  useQuoteLanding: () => state.landed,
}));
vi.mock("@/lib/use-is-intersecting", () => ({
  useIsIntersecting: () => false,
}));
vi.mock("@/lib/use-start-annotation", () => ({
  useStartAnnotation: () => {},
  marginNotesPending: () => false,
}));
vi.mock("@/components/article-renderer", () => ({
  ArticleRenderer: () => (
    <div data-article-body>
      <p>
        <mark
          className="annotation-mark"
          data-annotation-id="a1"
          onClick={() => state.clicked.push("a1")}
        >
          Invented prose.
        </mark>
        {state.fragmented && (
          <>
            <mark
              className="annotation-mark"
              data-annotation-id="a1"
              onClick={() => state.clicked.push("a1")}
            >
              Second fragment.
            </mark>
            <mark
              className="annotation-mark"
              data-annotation-id="a2"
              onClick={() => state.clicked.push("a2")}
            >
              Another annotation.
            </mark>
          </>
        )}
      </p>
    </div>
  ),
}));
vi.mock("@/components/article-tags", () => ({ ArticleTags: () => null }));
vi.mock("@/components/article-ask", () => ({ ArticleAsk: () => null }));
vi.mock("@/components/companion-card", () => ({
  CompanionCard: ({ onStop }: { onStop: () => void }) => (
    <button id="fixture-stop" onClick={onStop}>
      Stop answer fixture
    </button>
  ),
}));
vi.mock("@/components/article-back-matter", () => ({
  ArticleBackMatter: ({
    reflectionFlush,
    onDone,
    reflection,
  }: {
    reflectionFlush: { current: (() => Promise<boolean>) | null };
    onDone: () => void;
    reflection?: { questionForYou: string } | null;
  }) => {
    reflectionFlush.current = async () => state.reflectionSaved;
    return (
      <>
        {reflection ? (
          <p data-testid="standard-reflection">{reflection.questionForYou}</p>
        ) : null}
        <button id="fixture-done" onClick={onDone}>
          Done fixture
        </button>
      </>
    );
  },
}));
vi.mock("@/components/reader-toolbar", () => ({ ReaderToolbar: () => null }));
vi.mock("@/components/selection-toolbar", () => ({
  SelectionToolbar: () => null,
}));
vi.mock("@/components/notes-panel", () => ({ NotesPanel: () => null }));
vi.mock("@/components/listen-bar", () => ({ ListenBar: () => null }));
vi.mock("@/components/reader-map", () => ({ ReaderMap: () => null }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.progress = 0;
  state.observers = 0;
  state.reflectionSaved = true;
  state.bible = false;
  state.licensed = false;
  state.summarize.mockClear();
  state.reflection = null;
  state.finish.mockClear();
  state.push.mockClear();
  state.query.mockReset();
  state.open.mockClear();
  state.stop.mockClear();
  state.loadMore.mockClear();
  state.pages = [];
  state.params = "";
  state.scopeReady = true;
  state.more = false;
  state.landed = false;
  state.marginMode = "sidenotes";
  state.fragmented = false;
  state.clicked = [];
  state.thread = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor() {
        state.observers++;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  if (!CSS.escape) CSS.escape = (value) => value;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      const rects = this.matches("mark")
        ? [new DOMRect(100, 100, 100, 20)]
        : [];
      return Object.assign(rects, { item: (at: number) => rects[at] });
    },
  );
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
it("binds Bible summaries to the saved WEB source even when it has no HTML", async () => {
  state.licensed = true;
  await act(async () => root.render(<ReadPage />));
  const entry = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Summary, key claims"),
  )!;
  await act(async () => entry.click());
  await vi.waitFor(() => expect(state.summarize).toHaveBeenCalledOnce());
  expect(state.summarize).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Psalms 23",
      paragraphs: ["23:1 Public-domain WEB source"],
      sourceHash: await sourceHash("23:1 Public-domain WEB source"),
    }),
  );
  expect(JSON.stringify(state.summarize.mock.calls)).not.toContain(
    "Licensed-display-canary",
  );
});
it("does not finish or navigate away from a reflection whose save failed", async () => {
  state.reflectionSaved = false;
  await act(async () => root.render(<ReadPage />));
  await act(async () =>
    document.querySelector<HTMLButtonElement>("#fixture-done")?.click(),
  );
  expect(state.finish).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Couldn't save");
});
it("keeps the standard summary entry, header and bottom reflection for Bible content", async () => {
  state.bible = true;
  state.reflection = {
    _id: "reflection-fixture",
    strongestPoint: "A point",
    weakestAssumption: "An assumption",
    credibleCounterview: "An alternative",
    questionForYou: "The standard reflection question",
  };
  await act(async () => root.render(<ReadPage />));
  const summary = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Summary, key claims and a map"),
  );
  expect(summary).toBeDefined();
  const body = document.querySelector("[data-article-body]")!;
  const reflection = document.querySelector(
    '[data-testid="standard-reflection"]',
  )!;
  expect(
    summary!.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    body.compareDocumentPosition(reflection) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(document.querySelector("article header nav")).toBeNull();
});
it("skips every preview collection until the readable unit scope resolves", async () => {
  state.scopeReady = false;
  await act(async () => root.render(<ReadPage />));
  expect(new Set(state.pages.map((page) => page.name))).toEqual(
    new Set([
      "annotations:listPresentationByArticle",
      "userNotes:listPreviewsByArticle",
      "companionThreads:listPreviewsByArticle",
      "highlights:listPresentationByArticle",
    ]),
  );
  expect(state.pages.every((page) => page.args === "skip")).toBe(true);
});
it("hydrates a linked saved answer outside the preview page, without a model call", async () => {
  state.params = "answer=saved-answer&quote=Invented";
  state.landed = true;
  const body = {
    _id: "saved-answer",
    articleId: "article-1",
    mode: "ask",
    turns: [{ role: "assistant", content: "Saved body" }],
  };
  state.query.mockResolvedValue(body);
  await act(async () => root.render(<ReadPage />));
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(getFunctionName(state.query.mock.calls[0][0])).toBe(
    "companionThreads:getBody",
  );
  expect(state.query.mock.calls[0][1]).toEqual({ threadId: "saved-answer" });
  expect(state.open).toHaveBeenCalledWith(body);
});
it("does not reopen a pending linked answer after Cancel", async () => {
  state.params = "answer=late-answer&quote=Invented";
  state.landed = true;
  let resolve!: (body: unknown) => void;
  state.query.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(<ReadPage />));
  const cancel = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel",
  );
  expect(cancel).toBeDefined();
  await act(async () => cancel!.click());
  await act(async () =>
    resolve({ _id: "late-answer", articleId: "article-1", turns: [] }),
  );
  expect(state.open).not.toHaveBeenCalled();
});
it("offers explicit continuation for additional margin data", async () => {
  state.more = true;
  await act(async () => root.render(<ReadPage />));
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === "Load more margin notes and marks",
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(state.loadMore).toHaveBeenCalledTimes(4);
});
it("connects Stop to the currently open answer rather than cancelling another stream", async () => {
  state.marginMode = "sheet";
  state.thread = {
    id: "active-answer",
    mode: "article",
    selection: "",
    question: "Why?",
    paragraphIndex: null,
    turns: [],
    doneTurns: [],
    status: "streaming",
    model: null,
  };
  await act(async () => root.render(<ReadPage />));
  await act(async () =>
    document.querySelector<HTMLButtonElement>("#fixture-stop")?.click(),
  );
  expect(state.stop).toHaveBeenCalledWith("active-answer");
});
it("cycles split annotations once per identity with the paragraph shortcut", async () => {
  state.fragmented = true;
  await act(async () => root.render(<ReadPage />));
  for (let i = 0; i < 3; i++) {
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "o", bubbles: true }),
      ),
    );
  }
  expect(state.clicked).toEqual(["a1", "a2", "a1"]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps sidenote measurement and observer identity unchanged when page reading progress updates", async () => {
  await act(async () => {
    root.render(<ReadPage />);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(
    document.querySelector('.sidenote[data-placed="true"]')?.textContent,
  ).toContain("A margin note.");
  const measure = vi.mocked(HTMLElement.prototype.getClientRects);
  measure.mockClear();
  const observers = state.observers;
  state.progress = 45;
  await act(async () => root.render(<ReadPage />));
  expect(
    document.querySelector<HTMLElement>(".reading-progress")?.style.width,
  ).toBe("45%");
  expect(measure).not.toHaveBeenCalled();
  expect(state.observers).toBe(observers);
});
