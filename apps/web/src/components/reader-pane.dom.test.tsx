// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderPane } from "./reader-pane";

let root: Root;
let host: HTMLDivElement;
const onClose = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML =
    '<button id="opener">Open</button><div id="root"></div>';
  const rootHost = document.getElementById("root");
  if (!(rootHost instanceof HTMLDivElement))
    throw new Error("Missing test root");
  host = rootHost;
  root = createRoot(host);
  onClose.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  delete document.documentElement.dataset.readerPane;
  vi.unstubAllGlobals();
});

describe("ReaderPane", () => {
  it("owns the reader inset, closes on Escape, and restores connected focus", () => {
    const opener = document.getElementById("opener");
    if (!(opener instanceof HTMLButtonElement))
      throw new Error("Missing opener");
    opener.focus();
    act(() =>
      root.render(
        <ReaderPane title="Ask the article" onClose={onClose}>
          Answer
        </ReaderPane>,
      ),
    );
    expect(document.documentElement.dataset.readerPane).toBe("");
    const pane = document.body.querySelector("dialog");
    if (!(pane instanceof HTMLElement)) throw new Error("Missing pane");
    act(() =>
      pane.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.render(null));
    expect(document.documentElement.dataset.readerPane).toBeUndefined();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps the whole pane available on phone with an explicit return action", () => {
    act(() =>
      root.render(
        <ReaderPane title="Ask the article" onClose={onClose}>
          Answer
        </ReaderPane>,
      ),
    );
    expect(document.body.textContent).toContain("Back to passage");
  });
});
