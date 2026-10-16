// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { escapeGoesBack } from "./reader-escape";

const open = { readerPanelOpen: false, selectionActive: false };
const esc = (
  over: Partial<{
    key: string;
    defaultPrevented: boolean;
    target: EventTarget | null;
  }> = {},
) => ({
  key: "Escape",
  defaultPrevented: false,
  target: document.body,
  ...over,
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Escape in the reader", () => {
  it("goes back on a plain Escape", () => {
    expect(escapeGoesBack(esc(), open, document)).toBe(true);
  });

  it("ignores other keys", () => {
    expect(escapeGoesBack(esc({ key: "Enter" }), open, document)).toBe(false);
  });

  it("does nothing when something already handled the event", () => {
    expect(
      escapeGoesBack(esc({ defaultPrevented: true }), open, document),
    ).toBe(false);
  });

  it("does nothing while an open menu, popover or Aa panel is on the page", () => {
    for (const markup of [
      '<div role="menu"></div>',
      '<div data-radix-popper-content-wrapper><div role="dialog"></div></div>',
      '<div role="dialog"></div>',
      "<dialog open></dialog>",
      '<div aria-modal="true"></div>',
    ]) {
      document.body.innerHTML = markup;
      expect(escapeGoesBack(esc(), open, document), markup).toBe(false);
    }
  });

  it("leaves Escape to an open margin note, companion answer, notes pane or Ask", () => {
    expect(
      escapeGoesBack(esc(), { ...open, readerPanelOpen: true }, document),
    ).toBe(false);
  });

  it("does nothing while a text field, editor or contenteditable has focus", () => {
    for (const markup of [
      '<input id="t" />',
      '<textarea id="t"></textarea>',
      '<div id="t" contenteditable="true"></div>',
    ]) {
      document.body.innerHTML = markup;
      const target = document.getElementById("t");
      expect(escapeGoesBack(esc({ target }), open, document), markup).toBe(
        false,
      );
    }
  });

  it("treats contenteditable=false as plain text", () => {
    document.body.innerHTML = '<div id="t" contenteditable="false"></div>';
    const target = document.getElementById("t");
    expect(escapeGoesBack(esc({ target }), open, document)).toBe(true);
  });

  it("leaves Escape to a live text selection", () => {
    expect(
      escapeGoesBack(esc(), { ...open, selectionActive: true }, document),
    ).toBe(false);
  });

  it("leaves Escape to the open passage menu", () => {
    document.body.innerHTML =
      '<div role="toolbar" aria-label="Passage actions"></div>';
    expect(escapeGoesBack(esc(), open, document)).toBe(false);
  });

  it("does not mistake the reader's own toolbar for an open menu", () => {
    document.body.innerHTML =
      '<div data-testid="reader-toolbar"><button>Back</button></div>';
    expect(escapeGoesBack(esc(), open, document)).toBe(true);
  });
});
