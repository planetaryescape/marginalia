// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderToolbar, type ReaderToolbarProps } from "./reader-toolbar";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./impression-panel", () => ({
  RATINGS: ["Skip", "Fine", "Good", "Great", "Reread"],
  ImpressionPanel: () => <div>impression</div>,
}));
vi.mock("./reader-settings-panel", () => ({
  ReaderSettingsPanel: () => (
    <button type="button" aria-label="Reading settings">
      Aa
    </button>
  ),
}));

const handlers = {
  onToggleNotes: vi.fn(),
  onRate: vi.fn(),
  onToggleLove: vi.fn(),
  onToggleListen: vi.fn(),
  onToggleSummary: vi.fn(),
  onReannotate: vi.fn(),
};

function props(over: Partial<ReaderToolbarProps> = {}): ReaderToolbarProps {
  return {
    title: "A title",
    originalUrl: "https://example.com/post",
    backHref: "/",
    backLabel: "Desk",
    maxWidth: "42rem",
    headingElement: null,
    noteCount: 2,
    rating: undefined,
    loved: false,
    listening: false,
    settings: {} as never,
    onMarkUnread: null,
    ...handlers,
    ...over,
  };
}

let root: Root;
async function render(over: Partial<ReaderToolbarProps> = {}) {
  await act(async () => root.render(<ReaderToolbar {...props(over)} />));
}
const toolbar = () =>
  document.querySelector("[data-testid=reader-toolbar]") as HTMLElement;
const trigger = () =>
  document.querySelector("button[aria-label='More actions']") as HTMLElement;
/** Finds an element the test expects to exist, or fails with the selector. */
function required<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`No element matches ${selector}`);
  return found;
}
const menuItems = () =>
  [...document.querySelectorAll("[role=menuitem]")] as HTMLElement[];
const key = (el: Element, k: string) =>
  act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
    );
    // Radix moves focus in a timeout
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
/** Item text without its keyboard hint. */
const label = (el: Element) =>
  [...el.childNodes]
    .filter((n) => n.nodeName !== "KBD")
    .map((n) => n.textContent)
    .join("");
const titleSlot = () =>
  required<HTMLElement>(toolbar(), "[data-testid=reader-toolbar-title]");

/** Stands in for the browser's observer; `report` says whether the heading is on screen. */
let observed: IntersectionObserverCallback | null = null;
class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observed = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
const report = (visible: boolean) =>
  act(async () => {
    observed?.(
      [{ isIntersecting: visible } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  observed = null;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("toolbar", () => {
  it("shows Back, Aa and more, and nothing else", async () => {
    await render({ backHref: "/session/s1" });
    const names = [...toolbar().querySelectorAll("a, button")].map(
      (el) => el.getAttribute("aria-label") ?? el.textContent?.trim(),
    );
    expect(names).toEqual(["Back to Desk", "Reading settings", "More actions"]);
    expect(toolbar().querySelector("a")?.getAttribute("href")).toBe(
      "/session/s1",
    );
    expect(toolbar().querySelector("a[href*='github']")).toBeNull();
    expect(toolbar().textContent).not.toMatch(/min left/);
  });

  it("names the room Back returns to", async () => {
    await render({ backHref: "/library", backLabel: "Library" });
    const back = required<HTMLAnchorElement>(toolbar(), "a");
    expect(back.getAttribute("aria-label")).toBe("Back to Library");
    expect(back.getAttribute("href")).toBe("/library");
    expect(back.textContent).toBe("Library");
  });

  it("keeps the star and heart out of the bar until asked", async () => {
    await render({ rating: 3, loved: true });
    expect(toolbar().querySelector("[aria-keyshortcuts='r']")).toBeNull();
    expect(toolbar().querySelector("[aria-pressed]")).toBeNull();
  });

  it("keeps the title slot empty while the heading is on screen, then shows the title once it scrolls away", async () => {
    const heading = document.createElement("h1");
    document.body.append(heading);
    await render({ headingElement: heading });
    await report(true);
    expect(titleSlot().textContent).toBe("");
    expect(titleSlot().dataset.shown).toBe("false");

    await report(false);
    expect(titleSlot().textContent).toBe("A title");
    expect(titleSlot().dataset.shown).toBe("true");

    await report(true);
    expect(titleSlot().dataset.shown).toBe("false");
    // The text stays for the fade, then leaves
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(titleSlot().textContent).toBe("");
    heading.remove();
  });

  it("keeps the phone title in its own always-visible span", async () => {
    await render();
    const phone = required<HTMLElement>(toolbar(), "span.sm\\:hidden");
    expect(phone.textContent).toBe("A title");
  });

  it("names the key in the Notes tooltip and shows no keycap without Alt", async () => {
    await render();
    await key(trigger(), "Enter");
    expect(menuItems()[0].getAttribute("title")).toBe("Notes (n)");
    expect(toolbar().querySelector("kbd")).toBeNull();
  });
});

describe("overflow menu", () => {
  it("opens notes from the top of the menu, with its count", async () => {
    await render();
    trigger().focus();
    await key(trigger(), "Enter");
    const notes = menuItems()[0];
    expect(label(notes)).toBe("Notes · 2");
    expect(notes.className).not.toContain("sm:hidden");
    await key(notes, "Enter");
    expect(handlers.onToggleNotes).toHaveBeenCalledTimes(1);
  });

  it("opens on Enter and lists the actions in order", async () => {
    await render({ onMarkUnread: vi.fn() });
    expect(menuItems()).toHaveLength(0);
    trigger().focus();
    await key(trigger(), "Enter");
    expect(menuItems().map(label)).toEqual([
      "Notes · 2",
      "Summary",
      "Listen",
      "Rate this article",
      "Love this article",
      "Copy link",
      "Open original",
      "Mark unread",
      "Re-annotate with latest vault",
    ]);
    const original = menuItems().find((el) => label(el) === "Open original");
    expect(original?.getAttribute("href")).toBe("https://example.com/post");
    // Re-annotate is last, after a hairline
    const separators = document.querySelectorAll("[role=separator]");
    expect(separators).toHaveLength(2);
    expect(separators[1].nextElementSibling?.textContent).toBe(
      "Re-annotate with latest vault",
    );
  });

  it("rates from the menu with its key in the tooltip, and loves", async () => {
    await render({ rating: 3 });
    await key(trigger(), "Enter");
    const rate = menuItems().find((el) => label(el).startsWith("Rated"));
    expect(rate?.getAttribute("title")).toBe("You rated this Good (r)");
    expect(rate?.getAttribute("aria-keyshortcuts")).toBe("r");
    await key(rate as HTMLElement, "Enter");
    expect(handlers.onRate).toHaveBeenCalledTimes(1);
  });

  it("names the v key on the love item, in its tooltip and as a keycap", async () => {
    await render();
    await key(trigger(), "Enter");
    const love = menuItems().find((el) => label(el) === "Love this article");
    expect(love?.getAttribute("aria-keyshortcuts")).toBe("v");
    expect(love?.getAttribute("title")).toBe("Love this article (v)");
    expect(required<HTMLElement>(love as HTMLElement, "kbd").textContent).toBe(
      "v",
    );
  });

  it("loves from the menu", async () => {
    await render();
    await key(trigger(), "Enter");
    const love = menuItems().find((el) => label(el) === "Love this article");
    await key(love as HTMLElement, "Enter");
    expect(handlers.onToggleLove).toHaveBeenCalledTimes(1);
  });

  it("offers Mark unread only for a finished article", async () => {
    await render();
    await key(trigger(), "Enter");
    expect(menuItems().map(label)).not.toContain("Mark unread");
  });

  it("moves with the arrow keys and runs the focused item on Enter", async () => {
    await render();
    trigger().focus();
    await key(trigger(), "Enter");
    const first = document.activeElement as HTMLElement;
    expect(first.getAttribute("role")).toBe("menuitem");
    await key(first, "ArrowDown");
    expect(document.activeElement).toBe(menuItems()[1]);
    await key(menuItems()[1], "Enter");
    expect(handlers.onToggleSummary).toHaveBeenCalledTimes(1);
    expect(menuItems()).toHaveLength(0);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await render();
    trigger().focus();
    await key(trigger(), "Enter");
    expect(menuItems().length).toBeGreaterThan(0);
    await key(document.activeElement as HTMLElement, "Escape");
    expect(menuItems()).toHaveLength(0);
    // Focus is handed back after the menu unmounts
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(document.activeElement).toBe(trigger());
  });

  it("opens with Space as well", async () => {
    await render();
    trigger().focus();
    await key(trigger(), " ");
    expect(menuItems().length).toBeGreaterThan(0);
  });
});
