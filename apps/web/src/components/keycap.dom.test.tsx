// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AltHintProvider } from "@/lib/use-alt-hint";
import { Keycap } from "./keycap";

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Keycap", () => {
  it("shows its key only once Alt has been held, and hides it on release", async () => {
    await act(async () =>
      root.render(
        <AltHintProvider>
          <Keycap>/</Keycap>
        </AltHintProvider>,
      ),
    );
    expect(document.querySelector("kbd")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(document.querySelector("kbd")?.textContent).toBe("/");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    });
    expect(document.querySelector("kbd")).toBeNull();
  });
});
