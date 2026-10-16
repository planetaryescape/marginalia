// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcuts } from "@/lib/shortcuts";
import { KeyboardShortcuts } from "./keyboard-shortcuts";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // happy-dom's localStorage is unavailable under this Node; the shortcut map reads it on mount
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
  });
  router.push.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
});

async function press(...keys: string[]) {
  for (const k of keys) {
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }
}

describe("g navigation", () => {
  it.each([
    ["g", "w", "/reading"],
    ["g", "s", "/library?shelf=saved"],
    ["g", "l", "/library"],
    ["g", "n", "/notes"],
    ["g", "h", "/"],
  ])("%s %s goes to %s", async (first, second, target) => {
    await act(async () => root.render(<KeyboardShortcuts />));
    await press(first, second);
    expect(router.push).toHaveBeenCalledWith(target);
  });
});

describe("aliases and the search fallback", () => {
  it.each([
    ["g", "d", "/"],
    ["g", "r", "/reading"],
  ])("%s %s goes to %s", async (first, second, target) => {
    await act(async () => root.render(<KeyboardShortcuts />));
    await press(first, second);
    expect(router.push).toHaveBeenCalledWith(target);
  });

  it("/ sends a page without a search to the desk's bar", async () => {
    await act(async () => root.render(<KeyboardShortcuts />));
    await press("/");
    expect(router.push).toHaveBeenCalledWith("/?find=1");
  });

  it("a page's own / wins over the fallback", async () => {
    const focus = vi.fn();
    function Page() {
      useShortcuts({ "/": focus });
      return null;
    }
    await act(async () =>
      root.render(
        <>
          <KeyboardShortcuts />
          <Page />
        </>,
      ),
    );
    await press("/");
    expect(focus).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("help lists the keys that work on this page", () => {
  const sheet = () =>
    Array.from(document.querySelectorAll("section")).map((section) => ({
      group: section.querySelector("h3")?.textContent,
      keys: Array.from(section.querySelectorAll("dt")).map(
        (dt) => dt.textContent,
      ),
    }));
  function Page({ on = true }: { on?: boolean }) {
    useShortcuts({ x: () => {} }, on, {
      help: { group: "Library", keys: [["x", "Archive"]] },
    });
    return null;
  }

  it("shows only the go-to and everywhere groups when the page registers none", async () => {
    await act(async () => root.render(<KeyboardShortcuts />));
    await press("?");
    expect(sheet().map((s) => s.group)).toEqual(["Go to", "Everywhere"]);
    expect(sheet()[0].keys).toContain("Go to the desk");
    expect(sheet()[0].keys).toContain("Go to your reading");
  });

  it("adds a page's group while it is mounted and enabled, and drops it after", async () => {
    const render = (page: React.ReactNode) =>
      act(async () =>
        root.render(
          <>
            <KeyboardShortcuts />
            {page}
          </>,
        ),
      );
    await render(<Page />);
    await press("?");
    expect(sheet().map((s) => s.group)).toEqual([
      "Go to",
      "Everywhere",
      "Library",
    ]);
    expect(sheet()[2].keys).toEqual(["Archive"]);
    await render(<Page on={false} />);
    expect(sheet().map((s) => s.group)).not.toContain("Library");
    await render(null);
    expect(sheet().map((s) => s.group)).toEqual(["Go to", "Everywhere"]);
  });
});
