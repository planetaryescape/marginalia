// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsIntersecting } from "./use-is-intersecting";

let callback: (entries: { isIntersecting: boolean }[]) => void = () => {};
const disconnect = vi.fn();
let root: Root;

function Probe({ target }: { target: Element | null }) {
  return <p data-testid="out">{String(useIsIntersecting(target))}</p>;
}
const out = () => document.querySelector("[data-testid=out]")?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  document.body.innerHTML =
    '<div id="root"></div><section id="back"></section>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  disconnect.mockReset();
});

describe("useIsIntersecting", () => {
  it("is false without an element, true while it intersects, false after it leaves", async () => {
    await act(async () => root.render(<Probe target={null} />));
    expect(out()).toBe("false");
    const el = document.getElementById("back") as HTMLElement;
    await act(async () => root.render(<Probe target={el} />));
    expect(out()).toBe("false");
    await act(async () => callback([{ isIntersecting: true }]));
    expect(out()).toBe("true");
    await act(async () => callback([{ isIntersecting: false }]));
    expect(out()).toBe("false");
  });

  it("disconnects its observer on unmount", async () => {
    const el = document.getElementById("back") as HTMLElement;
    await act(async () => root.render(<Probe target={el} />));
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalled();
    root = createRoot(document.getElementById("root") as HTMLElement);
  });
});
