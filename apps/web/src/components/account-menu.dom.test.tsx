// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu, sourceStatus } from "./account-menu";

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

interface MenuFixture {
  reader: { isOwner: boolean; email: string; name: string } | undefined;
  readwise: {
    connected: boolean;
    syncedAt: number | null;
    error: string | null;
  };
  feeds:
    | {
        ready: boolean;
        total: number | null;
        failed: number | null;
        failingTitle: string | null;
      }
    | undefined;
  queryError: boolean;
  subscriptions: string[];
  waiting: number;
}

const data = vi.hoisted(
  (): MenuFixture => ({
    reader: { isOwner: true, email: "bk@example.com", name: "BK" },
    readwise: {
      connected: true,
      syncedAt: Date.now() - 12 * 60_000,
      error: null,
    },
    feeds: { ready: true, total: 1, failed: 0, failingTitle: null },
    queryError: false,
    subscriptions: [],
    waiting: 2,
  }),
);

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    data.subscriptions.push(name);
    switch (name) {
      case "auth:currentReader":
        return data.reader;
      case "readwise:status":
        return data.readwise;
      case "feedStatus:status":
        if (data.queryError) throw new Error("Fixture status unavailable");
        return data.feeds;
      case "feeds:list":
      case "waitlist:pending":
        throw new Error("Avatar must not subscribe to full lists");
      case "waitlist:pendingCount":
        return data.reader?.isOwner ? data.waiting : undefined;
      default:
        return undefined;
    }
  },
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // happy-dom's localStorage is unavailable under this Node; the reader settings live there
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  });
  // Install detection reads the display mode; happy-dom has no matchMedia
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  data.reader = { isOwner: true, email: "bk@example.com", name: "BK" };
  data.readwise = {
    connected: true,
    syncedAt: Date.now() - 12 * 60_000,
    error: null,
  };
  data.feeds = { ready: true, total: 1, failed: 0, failingTitle: null };
  data.queryError = false;
  data.subscriptions = [];
  data.waiting = 2;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
});

const render = () => act(async () => root.render(<AccountMenu />));
const trigger = () =>
  container.querySelector<HTMLButtonElement>(
    "button[aria-label^='Account']",
  ) as HTMLButtonElement;
const menuItems = () =>
  [...document.querySelectorAll("[role=menuitem]")] as HTMLElement[];
const swatches = () =>
  [...document.querySelectorAll("[role=menuitemradio]")] as HTMLElement[];
const labels = () => menuItems().map((el) => el.textContent ?? "");
const key = (el: Element, k: string) =>
  act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("sourceStatus", () => {
  const now = Date.now();
  it("reports a healthy Readwise sync and the source count", () => {
    expect(
      sourceStatus(
        { connected: true, syncedAt: now - 12 * 60_000, error: null },
        { ready: true, total: 2, failed: 0, failingTitle: null },
      ),
    ).toEqual({
      line: "Readwise synced 12 min ago · 2 sources",
      failed: false,
    });
  });

  it("names a failed Readwise sync in one sentence", () => {
    expect(
      sourceStatus(
        { connected: true, syncedAt: null, error: "outage" },
        { ready: true, total: 2, failed: 2, failingTitle: null },
      ),
    ).toEqual({ line: "Readwise sync failed.", failed: true });
  });

  it("names one failed feed, or counts several", () => {
    expect(
      sourceStatus(null, {
        ready: true,
        total: 5,
        failed: 1,
        failingTitle: "Example",
      }).line,
    ).toBe("“Example” couldn’t be fetched.");
    expect(
      sourceStatus(null, {
        ready: true,
        total: 5,
        failed: 2,
        failingTitle: null,
      }).line,
    ).toBe("2 sources couldn’t be fetched.");
  });

  it("preserves empty/singular counts, disconnected and first-pending wording", () => {
    expect(
      sourceStatus(
        { connected: false, syncedAt: null, error: null },
        {
          ready: true,
          total: 0,
          failed: 0,
          failingTitle: null,
        },
      ),
    ).toEqual({
      line: "Readwise not connected · No sources yet",
      failed: false,
    });
    expect(
      sourceStatus(
        { connected: true, syncedAt: null, error: null },
        {
          ready: true,
          total: 1,
          failed: 0,
          failingTitle: null,
        },
      ),
    ).toEqual({
      line: "Readwise first sync pending · 1 source",
      failed: false,
    });
    expect(
      sourceStatus(
        { connected: true, syncedAt: null, error: "known failure" },
        undefined,
      ),
    ).toEqual({ line: "Readwise sync failed.", failed: true });
    expect(
      sourceStatus(undefined, {
        ready: true,
        total: 0,
        failed: 0,
        failingTitle: null,
      }),
    ).toMatchObject({ unknown: true });
  });
});

describe("AccountMenu", () => {
  it("subscribes to compact status while closed, never full feed or request lists", async () => {
    await render();
    expect(document.querySelector("[role=menu]")).toBeNull();
    expect(data.subscriptions).toContain("feedStatus:status");
    expect(data.subscriptions).not.toContain("feeds:list");
    expect(data.subscriptions).not.toContain("waitlist:pending");
  });

  it("does not disguise loading or migration as healthy and recovers to exact status", async () => {
    data.feeds = undefined;
    await render();
    expect(trigger().getAttribute("aria-label")).toBe(
      "Account, source status unavailable",
    );
    expect(
      container.querySelector("[data-source-status=unknown]"),
    ).not.toBeNull();
    data.feeds = {
      ready: false,
      total: null,
      failed: null,
      failingTitle: null,
    };
    await render();
    await key(trigger(), "Enter");
    expect(document.querySelector("[role=menu]")?.textContent).toContain(
      "Checking source status…",
    );
    expect(document.querySelector("[role=menu]")?.textContent).not.toContain(
      "No sources yet",
    );
    data.feeds = {
      ready: true,
      total: 18,
      failed: 1,
      failingTitle: "Paused example",
    };
    await render();
    expect(trigger().getAttribute("aria-label")).toBe(
      "Account, a source needs attention",
    );
    expect(document.querySelector("[role=menu]")?.textContent).toContain(
      "“Paused example” couldn’t be fetched.",
    );
    data.readwise.error = "Readwise fixture error";
    await render();
    expect(document.querySelector("[role=menu]")?.textContent).toContain(
      "Readwise sync failed.",
    );
    data.readwise.error = null;
    data.feeds = { ready: true, total: 18, failed: 0, failingTitle: null };
    await render();
    expect(trigger().getAttribute("aria-label")).toBe("Account");
    expect(document.querySelector("[role=menu]")?.textContent).toContain(
      "18 sources",
    );
  });

  it.each([
    false,
    true,
  ])("keeps Sources reachable and an attention marker when the compact query throws (Readwise failure=%s)", async (readwiseFailed) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      data.queryError = true;
      data.readwise.error = readwiseFailed ? "Readwise fixture failure" : null;
      await render();
      expect(trigger().getAttribute("aria-label")).toBe(
        readwiseFailed
          ? "Account, a source needs attention"
          : "Account, source status unavailable",
      );
      await key(trigger(), "Enter");
      expect(document.querySelector("[role=menu]")?.textContent).toContain(
        readwiseFailed
          ? "Readwise sync failed."
          : "Source status unavailable. Open Sources to check.",
      );
      expect(labels()).toContain("Sources");
      data.queryError = false;
      data.readwise.error = null;
      const retry = menuItems().find(
        (item) => item.textContent === "Retry source status",
      );
      if (!retry) throw new Error("Missing status retry action");
      await key(retry, "Enter");
      expect(trigger().getAttribute("aria-label")).toBe("Account");
      expect(container.querySelector("[data-source-status]")).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it("shows Readers with the waiting count to the owner only", async () => {
    await render();
    await key(trigger(), "Enter");
    expect(labels()).toEqual([
      "Your reading",
      "Sources",
      "Readers2 waiting",
      "Account",
      "Install app",
      "Keyboard shortcuts?",
      "About Marginalia",
    ]);
    expect(document.querySelector("[role=menu]")?.textContent).toContain(
      "Owner",
    );
  });

  it("shows Your reading first, only at phone widths where the bottom bar has no slot for it", async () => {
    await render();
    await key(trigger(), "Enter");
    const [first] = menuItems();
    expect(first.textContent).toBe("Your reading");
    // Same breakpoint as the bottom bar (`mobile-app-nav md:hidden`) in site-header.tsx
    expect(first.className).toContain("md:hidden");
  });

  it("hides Readers and the owner line from a reader who isn't the owner", async () => {
    data.reader = { isOwner: false, email: "r@example.com", name: "R" };
    await render();
    await key(trigger(), "Enter");
    expect(labels()).not.toContain("Readers2 waiting");
    expect(labels()).toContain("Your reading");
    expect(labels().some((label) => label.startsWith("Readers"))).toBe(false);
    expect(document.querySelector("[role=menu]")?.textContent).not.toContain(
      "Owner",
    );
  });

  it("marks the avatar when a source fails, and clears when it recovers", async () => {
    await render();
    expect(container.querySelector("[data-source-status=failed]")).toBeNull();
    data.feeds = { ready: true, total: 1, failed: 1, failingTitle: "Example" };
    await render();
    expect(
      container.querySelector("[data-source-status=failed]"),
    ).not.toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe(
      "Account, a source needs attention",
    );
    data.feeds = { ready: true, total: 1, failed: 0, failingTitle: null };
    await render();
    expect(container.querySelector("[data-source-status=failed]")).toBeNull();
  });

  it("offers the six themes and Auto, and changes the stored theme live", async () => {
    await render();
    await key(trigger(), "Enter");
    expect(swatches().map((el) => el.textContent)).toEqual([
      "AaAuto",
      "AaPaper",
      "AaSepia",
      "AaSnow",
      "AaDusk",
      "AaNight",
      "AaInk",
    ]);
    const pressed = () =>
      swatches()
        .filter((el) => el.getAttribute("aria-checked") === "true")
        .map((el) => el.textContent);
    expect(pressed()).toEqual(["AaAuto"]);
    const night = swatches().find((el) => el.textContent === "AaNight");
    await act(async () => {
      night?.focus();
      await key(night as HTMLElement, "Enter");
    });
    expect(pressed()).toEqual(["AaNight"]);
    expect(localStorage.getItem("marginalia:reader-settings")).toContain(
      '"theme":"night"',
    );
    // The menu stays open so the change can be seen
    expect(document.querySelector("[role=menu]")).not.toBeNull();
  });

  it("opens with Enter, moves with arrows and closes on Escape", async () => {
    await render();
    trigger().focus();
    await key(trigger(), "Enter");
    expect(menuItems()).toHaveLength(7);
    const first = document.activeElement as HTMLElement;
    expect(first.textContent).toBe("Your reading");
    await key(first, "ArrowDown");
    expect((document.activeElement as HTMLElement).textContent).toBe("Sources");
    await key(document.activeElement as Element, "Escape");
    // Radix returns focus to the trigger after its close timer
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });
});
