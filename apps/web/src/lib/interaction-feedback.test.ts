// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<button id="action">Save</button>';
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
  }));
  vi.stubGlobal("navigator", {});
  // Simulate Safari's switch capability, not a physical haptic motor.
  Object.defineProperty(HTMLInputElement.prototype, "switch", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLInputElement.prototype, "switch");
  document.body.innerHTML = "";
});

describe("touch feedback", () => {
  it("toggles a native switch synchronously when vibration is unavailable", async () => {
    const { touchFeedback } = await import("./interaction-feedback");
    const button = document.getElementById("action");
    button?.focus();
    touchFeedback({ haptics: true, sound: false });
    const input = document.querySelector<HTMLInputElement>("input[switch]");
    expect(input?.checked).toBe(true);
    expect(input?.tabIndex).toBe(-1);
    expect(input?.closest("[aria-hidden=true]")).not.toBeNull();
    expect(document.activeElement).toBe(button);
    touchFeedback({ haptics: true, sound: false });
    expect(input?.checked).toBe(false);
    expect(document.querySelectorAll("input[switch]")).toHaveLength(1);
  });
  it("uses the vibration API without creating a switch when available", async () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    const { touchFeedback } = await import("./interaction-feedback");
    touchFeedback({ haptics: true, sound: false });
    expect(vibrate).toHaveBeenCalledWith(8);
    expect(document.querySelector("input[switch]")).toBeNull();
  });
  it.each([
    "off",
    "reduced motion",
    "fine pointer",
    "unsupported switch",
  ])("does not toggle feedback for %s", async (mode) => {
    const { touchFeedback } = await import("./interaction-feedback");
    if (mode === "unsupported switch")
      Reflect.deleteProperty(HTMLInputElement.prototype, "switch");
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)"
          ? mode === "reduced motion"
          : mode !== "fine pointer",
    }));
    touchFeedback({ haptics: mode !== "off", sound: false });
    expect(document.querySelector("input[switch]")).toBeNull();
  });
  it("removes the switch on cleanup and can recreate it", async () => {
    const { touchFeedback, disposeTouchFeedback } = await import(
      "./interaction-feedback"
    );
    touchFeedback({ haptics: true, sound: false });
    expect(document.querySelectorAll("input[switch]")).toHaveLength(1);
    disposeTouchFeedback();
    expect(document.querySelector("input[switch]")).toBeNull();
    touchFeedback({ haptics: true, sound: false });
    expect(
      document.querySelector<HTMLInputElement>("input[switch]")?.checked,
    ).toBe(true);
  });
  it("does not throw when the browser denies vibration", async () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("Denied");
      },
    });
    const { touchFeedback } = await import("./interaction-feedback");
    expect(() => touchFeedback({ haptics: true, sound: false })).not.toThrow();
  });
});
