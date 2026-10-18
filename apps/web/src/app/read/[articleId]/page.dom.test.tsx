// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/reader-settings";
import ReadPage from "./page";

const state = vi.hoisted(() => ({
  progress: 0,
  empty: [],
  noop: () => {},
  asyncNoop: async () => {},
  observers: 0,
  reflectionSaved: true,
  finish: vi.fn(async () => {}),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ articleId: "article-1" }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: state.push, replace: state.noop }),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name === "annotations:listByArticle") return annotations;
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
  useAction: () => state.asyncNoop,
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
    article,
    isBook: false,
    unitIndex: null,
    scopeReady: true,
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
    thread: null,
    openId: null,
    start: state.noop,
    collapse: state.noop,
    open: state.noop,
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
  useMarginMode: () => "sidenotes",
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
vi.mock("@/lib/use-quote-landing", () => ({
  useQuoteLanding: () => false,
  openAfterLanding: () => null,
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
        <mark data-annotation-id="a1">Invented prose.</mark>
      </p>
    </div>
  ),
}));
vi.mock("@/components/article-tags", () => ({ ArticleTags: () => null }));
vi.mock("@/components/article-ask", () => ({ ArticleAsk: () => null }));
vi.mock("@/components/article-back-matter", () => ({
  ArticleBackMatter: ({
    reflectionFlush,
    onDone,
  }: {
    reflectionFlush: { current: (() => Promise<boolean>) | null };
    onDone: () => void;
  }) => {
    reflectionFlush.current = async () => state.reflectionSaved;
    return (
      <button id="fixture-done" onClick={onDone}>
        Done fixture
      </button>
    );
  },
}));
vi.mock("@/components/summary-panel", () => ({ SummaryPanel: () => null }));
vi.mock("@/components/reader-toolbar", () => ({ ReaderToolbar: () => null }));
vi.mock("@/components/selection-toolbar", () => ({
  SelectionToolbar: () => null,
}));
vi.mock("@/components/notes-panel", () => ({ NotesPanel: () => null }));
vi.mock("@/components/listen-bar", () => ({ ListenBar: () => null }));
vi.mock("@/components/reader-map", () => ({ ReaderMap: () => null }));
vi.mock("@/components/reader-opening", () => ({
  ReaderOpening: () => null,
  ReaderTitle: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.progress = 0;
  state.observers = 0;
  state.reflectionSaved = true;
  state.finish.mockClear();
  state.push.mockClear();
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
