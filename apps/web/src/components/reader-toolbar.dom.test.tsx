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
  onRatingOpenChange: vi.fn(),
  onToggleLove: vi.fn(),
  onToggleListen: vi.fn(),
  onToggleSummary: vi.fn(),
  onReannotate: vi.fn(),
};

function props(over: Partial<ReaderToolbarProps> = {}): ReaderToolbarProps {
  return {
    articleId: "a1" as never,
    title: "A title",
    originalUrl: "https://example.com/post",
    backHref: "/",
    maxWidth: "42rem",
    noteCount: 2,
    notesOpen: false,
    rating: undefined,
    ratingOpen: false,
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
const scrollTo = (y: number) =>
  act(async () => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("toolbar", () => {
  it("shows Desk, Notes, Aa, rate, love and more, and nothing else", async () => {
    await render({ backHref: "/session/s1" });
    const names = [...toolbar().querySelectorAll("a, button")].map(
      (el) => el.getAttribute("aria-label") ?? el.textContent?.trim(),
    );
    expect(names).toEqual([
      "Back to Desk",
      "Notes2",
      "Reading settings",
      "Rate this article",
      "Love this article",
      "More actions",
    ]);
    expect(toolbar().querySelector("a")?.getAttribute("href")).toBe(
      "/session/s1",
    );
    expect(toolbar().querySelector("a[href*='github']")).toBeNull();
    expect(toolbar().textContent).not.toMatch(/min left/);
  });

  it("opens the notes pane from the Notes button", async () => {
    await render();
    const notes = [...toolbar().querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Notes"),
    ) as HTMLElement;
    await act(async () => notes.click());
    expect(handlers.onToggleNotes).toHaveBeenCalledTimes(1);
  });
});

describe("overflow menu", () => {
  it("opens on Enter and lists the actions in order", async () => {
    await render({ onMarkUnread: vi.fn() });
    expect(menuItems()).toHaveLength(0);
    trigger().focus();
    await key(trigger(), "Enter");
    expect(menuItems().map(label)).toEqual([
      "Notes · 2",
      "Summary",
      "Listen",
      "Love",
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

  it("keeps the toolbar shown while it is open", async () => {
    await render();
    await scrollTo(400);
    expect(toolbar().dataset.hidden).toBe("true");
    await key(trigger(), "Enter");
    expect(toolbar().dataset.hidden).toBe("false");
  });

  it("keeps the toolbar shown while the notes pane is open", async () => {
    await render({ notesOpen: true });
    await scrollTo(400);
    expect(toolbar().dataset.hidden).toBe("false");
  });
});
