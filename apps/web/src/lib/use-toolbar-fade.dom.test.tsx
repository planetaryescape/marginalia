// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextScrollHidden, useToolbarFade } from "./use-toolbar-fade";

describe("nextScrollHidden", () => {
  it("stays shown until 120px in, however fast the scroll down", () => {
    expect(nextScrollHidden(false, 119, 0)).toBe(false);
    expect(nextScrollHidden(false, 120, 100)).toBe(true);
  });
  it("shows again on any scroll up, even deep in the article", () => {
    expect(nextScrollHidden(true, 900, 910)).toBe(false);
  });
  it("keeps its state when the scroll position did not change", () => {
    expect(nextScrollHidden(true, 500, 500)).toBe(true);
    expect(nextScrollHidden(false, 500, 500)).toBe(false);
  });
  it("shows near the top even when scrolling down", () => {
    expect(nextScrollHidden(true, 40, 10)).toBe(false);
  });
});

let wide = true;
let mediaListeners: (() => void)[] = [];
let pinned = false;
let root: Root;

function Harness() {
  const { hidden, focusProps } = useToolbarFade(pinned);
  return (
    <div data-testid="bar" data-hidden={hidden} {...focusProps}>
      <button type="button" id="inside">
        inside
      </button>
    </div>
  );
}

const bar = () => document.querySelector("[data-testid=bar]") as HTMLElement;
const hidden = () => bar().dataset.hidden === "true";

async function scrollTo(y: number) {
  await act(async () => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
}
async function render() {
  await act(async () => root.render(<Harness />));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  wide = true;
  pinned = false;
  mediaListeners = [];
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return wide;
    },
    addEventListener: (_: string, fn: () => void) => mediaListeners.push(fn),
    removeEventListener: (_: string, fn: () => void) => {
      mediaListeners = mediaListeners.filter((l) => l !== fn);
    },
  }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useToolbarFade", () => {
  it("hides on scrolling down past 120px and returns on scrolling up", async () => {
    await scrollTo(60);
    expect(hidden()).toBe(false);
    await scrollTo(300);
    expect(hidden()).toBe(true);
    await scrollTo(280);
    expect(hidden()).toBe(false);
    await scrollTo(600);
    expect(hidden()).toBe(true);
  });

  it("returns when the pointer enters the top 64px and fades again when it leaves", async () => {
    await scrollTo(300);
    expect(hidden()).toBe(true);
    await act(async () => {
      document.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientY: 20 }),
      );
    });
    expect(hidden()).toBe(false);
    await act(async () => {
      document.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientY: 300 }),
      );
    });
    expect(hidden()).toBe(true);
  });

  it("returns when keyboard focus enters it (Tab), and fades after focus leaves", async () => {
    await scrollTo(300);
    expect(hidden()).toBe(true);
    const inside = document.getElementById("inside") as HTMLElement;
    await act(async () => {
      inside.focus();
    });
    expect(hidden()).toBe(false);
    await act(async () => {
      inside.blur();
    });
    expect(hidden()).toBe(true);
  });

  it("stays shown while a menu or the notes pane holds it open", async () => {
    await scrollTo(300);
    expect(hidden()).toBe(true);
    pinned = true;
    await render();
    expect(hidden()).toBe(false);
    await scrollTo(500);
    expect(hidden()).toBe(false);
    pinned = false;
    await render();
    expect(hidden()).toBe(true);
  });

  it("shows again when the window narrows below the wide breakpoint", async () => {
    await scrollTo(500);
    expect(hidden()).toBe(true);
    wide = false;
    await act(async () => {
      for (const listener of mediaListeners) listener();
    });
    expect(hidden()).toBe(false);
    await scrollTo(900);
    expect(hidden()).toBe(false);
  });

  it("removes its listeners on unmount", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const removeDoc = vi.spyOn(document, "removeEventListener");
    await act(async () => root.unmount());
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(removeDoc).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(mediaListeners).toHaveLength(0);
    root = createRoot(document.getElementById("root") as HTMLElement);
  });
});
