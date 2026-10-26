// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savedScroll } from "@/lib/reader-return";
import { RoomMemoryTracker } from "./reader-room-memory";

let root: Root;
let scroller: HTMLElement;

const frames = () => new Promise((resolve) => setTimeout(resolve, 60));

/** Moves the page to a path the way the App Router does: the URL and pathname change together. */
async function goTo(pathname: string) {
  window.history.replaceState({}, "", pathname);
  await act(async () => root.render(<RoomMemoryTracker pathname={pathname} />));
}
/** A scroll event at a given position, as the browser fires them. */
function scrollEvent(y: number) {
  scroller.scrollTop = y;
  scroller.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = vi.fn();
  document.body.innerHTML =
    '<div class="desk-route"><div id="root"></div></div>';
  const viewport = document.querySelector<HTMLElement>(".desk-route");
  const host = document.getElementById("root");
  if (!viewport || !host) throw new Error("Missing room fixture");
  scroller = viewport;
  Object.defineProperty(scroller, "clientHeight", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(scroller, "scrollHeight", {
    value: 3000,
    configurable: true,
  });
  scroller.scrollTo = vi.fn((opts?: ScrollToOptions | number, y?: number) => {
    scroller.scrollTop = typeof opts === "number" ? (y ?? 0) : (opts?.top ?? 0);
  });
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("room scroll memory", () => {
  it("waits for the actual room viewport rather than restoring the article window", async () => {
    await goTo("/library?shelf=loved");
    scrollEvent(600);
    await goTo("/read/a1");
    scroller.remove();
    await goTo("/library?shelf=loved");
    await frames();
    expect(window.scrollTo).not.toHaveBeenCalled();
    document.body.append(scroller);
    await frames();
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({
      top: 600,
      behavior: "instant",
    });
  });
  it("restores the desk viewport and keeps shelf/search identity", async () => {
    await goTo("/library?shelf=saved");
    scroller.scrollTop = 900;
    scroller.dispatchEvent(new Event("scroll"));
    expect(savedScroll("/library?shelf=saved")).toBe(900);
    await goTo("/read/a1");
    await goTo("/library?shelf=saved");
    await frames();
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({
      top: 900,
      behavior: "instant",
    });
    expect(window.scrollTo).not.toHaveBeenCalled();
    await goTo("/library?q=focus");
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "instant",
    });
  });
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
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({
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
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "instant",
    });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
