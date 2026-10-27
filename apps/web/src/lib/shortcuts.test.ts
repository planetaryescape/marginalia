import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerShortcuts, type ShortcutMap } from "./shortcuts";

// A small EventTarget-backed DOM harness exercises the actual document listener
// without installing a browser DOM just for keyboard dispatcher tests.
class ElementTarget extends EventTarget {
  constructor(
    public typing = false,
    public inDialog = false,
  ) {
    super();
  }
  closest(selector: string) {
    return (selector.includes("input") ? this.typing : this.inDialog)
      ? this
      : null;
  }
}
class KeyEvent extends Event {
  metaKey = false;
  ctrlKey = false;
  altKey = false;
  isComposing = false;
  constructor(public key: string) {
    super("keydown", { cancelable: true });
  }
}

describe("keyboard shortcuts", () => {
  const cleanups: (() => void)[] = [];
  let documentTarget: ElementTarget;
  let overlay = false;
  let dataset: { keyboardShortcuts?: string };
  const register = (map: ShortcutMap) =>
    cleanups.push(registerShortcuts({ current: map }));
  const press = (
    key: string,
    options: Partial<
      Pick<KeyEvent, "metaKey" | "ctrlKey" | "altKey" | "isComposing">
    > = {},
  ) => {
    const event = Object.assign(new KeyEvent(key), options);
    documentTarget.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    overlay = false;
    dataset = {};
    documentTarget = new ElementTarget();
    vi.stubGlobal("HTMLElement", ElementTarget);
    vi.stubGlobal(
      "document",
      Object.assign(documentTarget, {
        querySelector: () => (overlay ? {} : null),
        documentElement: { dataset },
      }),
    );
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
    );
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    true,
    false,
  ])("navigation wins over page actions regardless of registration order (%s)", (pageFirst) => {
    const highlight = vi.fn();
    const home = vi.fn();
    const page = { h: highlight };
    const global = { "g h": home };
    register(pageFirst ? page : global);
    register(pageFirst ? global : page);
    expect(press("g").defaultPrevented).toBe(true);
    press("h");
    expect(home).toHaveBeenCalledTimes(1);
    expect(highlight).not.toHaveBeenCalled();
  });

  it("lets ordinary keys and native activation through", () => {
    register({ j: vi.fn() });
    for (const key of ["Tab", "Enter", " ", "ArrowRight"])
      expect(press(key).defaultPrevented).toBe(false);
  });

  it("a handler that returns false declines the key: the browser keeps it and the next registration may take it", () => {
    const decline = vi.fn(() => false as const);
    const take = vi.fn();
    register({ ArrowDown: decline });
    expect(press("ArrowDown").defaultPrevented).toBe(false);
    register({ ArrowDown: take });
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(decline).toHaveBeenCalledTimes(2);
    expect(take).toHaveBeenCalledOnce();
  });

  it("a fallback registration only gets keys the page does not take, whatever the order", () => {
    const fallback = vi.fn();
    const page = vi.fn();
    cleanups.push(
      registerShortcuts({ current: { "/": fallback } }, { fallback: true }),
    );
    press("/");
    expect(fallback).toHaveBeenCalledOnce();
    register({ "/": page });
    press("/");
    expect(page).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("ignores typing, composition and browser modifier shortcuts", () => {
    const action = vi.fn();
    register({ j: action, f: action, "1": action, "/": action });
    documentTarget.typing = true;
    for (const key of ["j", "f", "1", "/"])
      expect(press(key).defaultPrevented).toBe(false);
    documentTarget.typing = false;
    for (const key of ["metaKey", "ctrlKey", "altKey", "isComposing"] as const)
      for (const shortcut of ["f", "1", "/"]) press(shortcut, { [key]: true });
    expect(action).not.toHaveBeenCalled();
  });

  it("pauses shortcuts inside panels and while a modal or popover is open", () => {
    const action = vi.fn();
    register({ j: action, f: action, "1": action, "/": action });
    overlay = true;
    for (const key of ["j", "f", "1", "/"]) press(key);
    overlay = false;
    documentTarget.inDialog = true;
    for (const key of ["j", "f", "1", "/"]) press(key);
    expect(action).not.toHaveBeenCalled();
  });

  it("expires incomplete sequences rather than navigating on a later key", () => {
    const home = vi.fn();
    const highlight = vi.fn();
    register({ "g h": home, h: highlight });
    press("g");
    vi.advanceTimersByTime(1201);
    press("h");
    expect(home).not.toHaveBeenCalled();
    expect(highlight).toHaveBeenCalledOnce();
  });

  it("does not let unidentified browser events consume a navigation sequence", () => {
    const home = vi.fn();
    register({ "g h": home });
    press("g");
    press("Unidentified");
    press("h");
    expect(home).toHaveBeenCalledOnce();
  });

  it("does not carry a sequence through typing or unregistration", () => {
    const home = vi.fn();
    const highlight = vi.fn();
    register({ "g h": home, h: highlight });
    press("g");
    documentTarget.typing = true;
    press("x");
    documentTarget.typing = false;
    press("h");
    expect(home).not.toHaveBeenCalled();
    expect(highlight).toHaveBeenCalledOnce();
    const cleanup = registerShortcuts({ current: { j: home } });
    cleanup();
    expect(press("j").defaultPrevented).toBe(false);
  });

  it("honors disabling single-key shortcuts but keeps help available", () => {
    const action = vi.fn();
    const help = vi.fn();
    register({ j: action, "?": help });
    dataset.keyboardShortcuts = "off";
    expect(press("j").defaultPrevented).toBe(false);
    press("?");
    expect(action).not.toHaveBeenCalled();
    expect(help).toHaveBeenCalledOnce();
  });
});
