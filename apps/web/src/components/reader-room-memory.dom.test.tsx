// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savedScroll } from "@/lib/reader-return";
import { ReaderRoomMemory } from "./reader-room-memory";

const nav = vi.hoisted(() => ({ pathname: "/library" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

let root: Root;
let scrollY = 0;

const frames = () => new Promise((resolve) => setTimeout(resolve, 60));

/** Moves the page to a path the way the App Router does: the URL and pathname change together. */
async function goTo(pathname: string) {
  nav.pathname = pathname;
  window.history.replaceState({}, "", pathname);
  await act(async () => root.render(<ReaderRoomMemory />));
}
/** A scroll event at a given position, as the browser fires them. */
function scrollEvent(y: number) {
  scrollY = y;
  window.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => scrollY,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => 3000,
  });
  window.scrollTo = vi.fn((opts: ScrollToOptions) => {
    scrollY = opts.top ?? 0;
  }) as unknown as typeof window.scrollTo;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("room scroll memory", () => {
  it("keeps the saved position when Next scrolls the room to the top around the restore", async () => {
    await goTo("/library");
    scrollEvent(1200);
    expect(savedScroll("/library")).toBe(1200);

    // Opening an article: the room is left, and scroll events from the reader are ignored
    await goTo("/read/a1");
    scrollEvent(0);
    expect(savedScroll("/library")).toBe(1200);

    // Back to the room: the restore runs once the page is tall enough, and Next's
    // scroll-to-top arrives as a scroll event while the restore is settling
    await goTo("/library");
    scrollEvent(0);
    await frames();
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 1200,
      behavior: "instant",
    });
    expect(savedScroll("/library")).toBe(1200);

    // The restore's own jump lands on the saved position too
    scrollEvent(1200);
    await frames();
    expect(savedScroll("/library")).toBe(1200);
  });

  it("starts a plain visit to a room at the top, without restoring", async () => {
    await goTo("/notes");
    scrollEvent(400);
    await goTo("/saved");
    await goTo("/notes");
    await frames();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
