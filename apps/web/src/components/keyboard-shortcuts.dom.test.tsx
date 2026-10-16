// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
