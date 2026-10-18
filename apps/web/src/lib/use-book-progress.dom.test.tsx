// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBookProgress } from "./use-book-reading";

const record = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({
  useMutation: () => record,
  useQuery: () => undefined,
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { books: { recordProgress: "r" }, articles: {} },
}));

let root: Root;
let scrolled = 0;
let paragraph: number | undefined;

function Probe({ unit, key2 }: { unit: number; key2?: string }) {
  const ref = useRef<HTMLElement | null>(null);
  // SAFETY: the mutation is replaced at the Convex boundary; this synthetic ID is never sent.
  useBookProgress(
    "b1" as never,
    unit,
    key2,
    () => ({
      percent: scrolled,
      paragraphIndex: paragraph,
    }),
    ref,
  );
  return null;
}
const show = (unit: number, key?: string) =>
  act(async () => root.render(<Probe unit={unit} key2={key} />));
const frame = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

beforeEach(() => {
  record.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  record.mockResolvedValue(undefined);
  scrolled = 0;
  paragraph = undefined;
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("recording progress through a book", () => {
  it("records nothing until the part's text is on screen", async () => {
    await show(0, undefined);
    await frame();
    expect(record).not.toHaveBeenCalled();
  });

  it("records the part's own position in steps of five", async () => {
    scrolled = 12;
    await show(0, "u0");
    await frame();
    expect(record).toHaveBeenLastCalledWith({
      articleId: "b1",
      unitIndex: 0,
      unitKey: "u0",
      scrollPercent: 10,
    });
    scrolled = 13;
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("sends the paragraph at the top of the view with the position", async () => {
    scrolled = 42;
    paragraph = 17;
    await show(0, "u0");
    await frame();
    expect(record).toHaveBeenLastCalledWith({
      articleId: "b1",
      unitIndex: 0,
      unitKey: "u0",
      scrollPercent: 40,
      paragraphIndex: 17,
    });
  });

  it("never records the old part's position against the next part", async () => {
    scrolled = 95;
    await show(0, "u0");
    await frame();
    expect(record).toHaveBeenLastCalledWith({
      articleId: "b1",
      unitIndex: 0,
      unitKey: "u0",
      scrollPercent: 95,
    });
    record.mockClear();

    // Next: the index moves on while the new text hasn't arrived; the page still measures 95
    await show(1, undefined);
    await frame();
    expect(record).not.toHaveBeenCalled();

    // The new text is laid out at the top
    scrolled = 0;
    await show(1, "u1");
    await frame();
    expect(record.mock.calls.map((c) => c[0])).toEqual([
      { articleId: "b1", unitIndex: 1, unitKey: "u1", scrollPercent: 0 },
    ]);
  });
});
