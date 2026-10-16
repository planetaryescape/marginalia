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

const data = vi.hoisted(() => ({
  reader: { isOwner: true, email: "bk@example.com", name: "BK" } as
    | { isOwner: boolean; email: string; name: string }
    | undefined,
  readwise: {
    connected: true,
    syncedAt: Date.now() - 12 * 60_000,
    error: null,
  } as { connected: boolean; syncedAt: number | null; error: string | null },
  feeds: [{ title: "Example", lastError: undefined }] as {
    title: string;
    lastError?: string;
  }[],
  waiting: 2,
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    switch (getFunctionName(ref as Parameters<typeof getFunctionName>[0])) {
      case "auth:currentReader":
        return data.reader;
      case "readwise:status":
        return data.readwise;
      case "feeds:list":
        return data.feeds;
      case "waitlist:listRequests":
        return data.reader?.isOwner
          ? { pending: Array.from({ length: data.waiting }), recent: [] }
          : undefined;
      default:
        return undefined;
    }
  },
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  data.feeds = [{ title: "Example" }];
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
        [{ title: "a" }, { title: "b" }],
      ),
    ).toEqual({
      line: "Readwise synced 12 min ago · 2 sources",
      failed: false,
    });
  });

  it("names a failed Readwise sync in one sentence", () => {
    expect(
      sourceStatus({ connected: true, syncedAt: null, error: "outage" }, []),
    ).toEqual({ line: "Readwise sync failed.", failed: true });
  });

  it("names one failed feed, or counts several", () => {
    expect(
      sourceStatus(null, [{ title: "Example", lastError: "404" }]).line,
    ).toBe("“Example” couldn’t be fetched.");
    expect(
      sourceStatus(null, [
        { title: "a", lastError: "x" },
        { title: "b", lastError: "y" },
      ]).line,
    ).toBe("2 sources couldn’t be fetched.");
  });
});

describe("AccountMenu", () => {
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
    data.feeds = [{ title: "Example", lastError: "404" }];
    await render();
    expect(
      container.querySelector("[data-source-status=failed]"),
    ).not.toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe(
      "Account, a source needs attention",
    );
    data.feeds = [{ title: "Example" }];
    await render();
    expect(container.querySelector("[data-source-status=failed]")).toBeNull();
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
