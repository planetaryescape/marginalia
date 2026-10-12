// @vitest-environment happy-dom
import { Storage } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { disposeTouchFeedback } from "@/lib/interaction-feedback";
import {
  FeedbackPreferences,
  InteractionFeedback,
} from "./interaction-feedback";

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
  }));
  vi.stubGlobal("navigator", {});
  Object.defineProperty(HTMLInputElement.prototype, "switch", {
    configurable: true,
    value: false,
  });
  vi.stubGlobal("localStorage", new Storage());
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  disposeTouchFeedback();
  document.body.innerHTML = "";
  Reflect.deleteProperty(HTMLInputElement.prototype, "switch");
  vi.unstubAllGlobals();
});

it("offers a test tap that fires once, not once per pointerup and click", async () => {
  await act(async () =>
    root?.render(
      <>
        <InteractionFeedback />
        <FeedbackPreferences />
      </>,
    ),
  );
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent === "Test feedback",
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }),
    );
    button?.click();
  });
  expect(
    document.querySelector<HTMLInputElement>("input[switch]")?.checked,
  ).toBe(true);
  expect(document.querySelector("[role=status]")?.textContent).toContain(
    "device settings",
  );
});
