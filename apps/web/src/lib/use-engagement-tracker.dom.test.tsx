// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerUnfold } from "@/components/note-unfold";
import { useParagraphs } from "./paragraphs";
import { useEngagementTracker } from "./use-engagement-tracker";

class FakeObserver {
  static all: FakeObserver[] = [];
  observed: HTMLElement[] = [];
  disconnected = false;
  constructor(readonly callback: (entries: unknown[]) => void) {
    FakeObserver.all.push(this);
  }
  observe(el: HTMLElement) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  show(...labels: number[]) {
    const entries = this.observed
      .filter((el) => labels.includes(Number(el.dataset.para)))
      .map((target) => ({ target, isIntersecting: true }));
    this.callback(entries);
  }
}
const live = () => FakeObserver.all.filter((o) => !o.disconnected);
const labels = (o: FakeObserver) => o.observed.map((el) => el.dataset.para);

let root: Root;

function Reader({ articleId }: { articleId: string }) {
  const ref = useRef<HTMLElement>(null);
  const { version } = useParagraphs(ref, true);
  useEngagementTracker({
    articleId,
    sessionId: null,
    ready: true,
    containerRef: ref,
    listening: false,
    paragraphVersion: version,
  });
  return (
    <>
      <article ref={ref}>
        <div data-article-body>
          <p>First paragraph of the piece.</p>
          <p>Second paragraph of the piece.</p>
          <p>Third paragraph of the piece.</p>
        </div>
      </article>
      <AnswerUnfold
        containerRef={ref}
        version={version}
        id="answer"
        paragraphIndex={0}
      >
        <div>
          <p>An answer that is not part of the article.</p>
        </div>
      </AnswerUnfold>
    </>
  );
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const leave = async () => {
  sentBlobs = [];
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
  });
  return Promise.all(sentBlobs.map((b) => b.text().then((t) => JSON.parse(t))));
};
let sentBlobs: Blob[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  FakeObserver.all = [];
  sentBlobs = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (_url: string, blob: Blob) => {
      sentBlobs.push(blob);
      return true;
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("paragraph dwell in the reader", () => {
  it("observes only the article's own numbered paragraphs, never an unfolded answer", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    const [observer] = live();
    expect(labels(observer)).toEqual(["1", "2", "3"]);
    expect(
      document.querySelector("[data-marginalia-ui] p")?.textContent,
    ).toContain("An answer");
  });

  it("reports cumulative dwell for the paragraphs on screen, the same from the beacon on every leave", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    await act(async () => live()[0].show(1, 2));
    await advance(3000);
    const [first] = await leave();
    expect(first.dwell["1"]).toBeGreaterThanOrEqual(2900);
    expect(first.dwell["2"]).toBe(first.dwell["1"]);
    expect(first.dwell["3"]).toBeUndefined();
    const [again] = await leave();
    expect(again.dwell).toEqual(first.dwell);
  });

  it("drops the old observer when the article changes and starts clean", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    const old = live()[0];
    await act(async () => old.show(1));
    await advance(2000);
    await act(async () => root.render(<Reader articleId="b" />));
    await advance(100);
    expect(old.disconnected).toBe(true);
    expect(live().every((o) => o !== old)).toBe(true);
    await advance(3000);
    const sent = await leave();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((s) => s.articleId === "b" && !s.dwell)).toBe(true);
  });

  it("stops observing on unmount", async () => {
    await act(async () => root.render(<Reader articleId="a" />));
    await advance(100);
    await act(async () => root.unmount());
    expect(live()).toHaveLength(0);
    root = createRoot(document.getElementById("root") as HTMLElement);
  });
});
