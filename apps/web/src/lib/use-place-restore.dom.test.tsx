// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaceRestore } from "./use-place-restore";

let root: Root;
const container = { current: null as HTMLElement | null };

function Probe({
  paragraph,
  version,
}: {
  paragraph: number | undefined;
  version: number;
}) {
  usePlaceRestore(container, "a:", 40, paragraph, version);
  return null;
}
const render = (paragraph: number | undefined, version: number) =>
  act(async () =>
    root.render(<Probe paragraph={paragraph} version={version} />),
  );
const scrolls = () =>
  (window.scrollTo as unknown as { mock: { calls: { top: number }[][] } }).mock
    .calls;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  // Body 3000px tall; paragraph i sits at i * 100
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = Number(this.dataset.index ?? -1);
      const top = index < 0 ? 0 : index * 100;
      return {
        top,
        bottom: top + 100,
        height: index < 0 ? 3000 : 100,
      } as DOMRect;
    },
  );
  document.body.innerHTML =
    '<div id="mount"></div><article id="article"><div data-article-body></div></article>';
  const body = document.querySelector("[data-article-body]") as HTMLElement;
  for (let i = 0; i < 20; i++) {
    const p = document.createElement("p");
    p.dataset.index = String(i);
    body.appendChild(p);
  }
  container.current = document.getElementById("article");
  root = createRoot(document.getElementById("mount") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("restoring a saved paragraph", () => {
  it("waits for the paragraphs to be numbered instead of settling on the percent", async () => {
    // The saved place arrives before tagging has run
    await render(7, 0);
    expect(scrolls()).toHaveLength(0);

    for (const p of document.querySelectorAll<HTMLElement>("[data-index]"))
      p.dataset.para = String(Number(p.dataset.index) + 1);
    await render(7, 1);
    expect(scrolls()).toHaveLength(1);
    expect(scrolls()[0][0].top).toBe(700 - 64);
  });

  it("restores by percent for a row saved without a paragraph", async () => {
    await render(undefined, 0);
    expect(scrolls()).toHaveLength(1);
  });

  it("falls back to the percent once tagged when the paragraph no longer exists", async () => {
    for (const p of document.querySelectorAll<HTMLElement>("[data-index]"))
      p.dataset.para = String(Number(p.dataset.index) + 1);
    await render(99, 1);
    expect(scrolls()).toHaveLength(1);
    expect(scrolls()[0][0].top).not.toBe(99 * 100 - 64);
  });
});
