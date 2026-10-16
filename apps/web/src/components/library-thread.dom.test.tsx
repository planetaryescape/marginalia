// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangesOf, LibraryThread, type LibraryTurn } from "./library-thread";

vi.mock("next/link", () => ({ default: "a" }));

const turns: LibraryTurn[] = [
  { role: "user", content: "my notes on attention" },
  { role: "assistant", content: "First answer." },
  { role: "user", content: "anything else" },
  { role: "assistant", content: "Second answer." },
  { role: "user", content: "and the third" },
  { role: "assistant", content: "Third answer." },
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (list: LibraryTurn[], streaming = false) =>
  act(() => root.render(<LibraryThread turns={list} streaming={streaming} />));

const folds = () => [
  ...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
];

describe("the librarian thread", () => {
  it("pairs questions with their answers", () => {
    expect(exchangesOf(turns)).toHaveLength(3);
    expect(exchangesOf(turns.slice(0, 1))).toEqual([
      { question: "my notes on attention", answer: "" },
    ]);
  });

  it("opens only the newest answer and folds earlier ones to their question", () => {
    render(turns);
    expect(host.textContent).toContain("Third answer.");
    expect(host.textContent).not.toContain("First answer.");
    expect(host.textContent).not.toContain("Second answer.");
    expect(folds().map((b) => b.textContent)).toEqual([
      "▸my notes on attention",
      "▸anything else",
    ]);
    expect(
      folds().every((b) => b.getAttribute("aria-expanded") === "false"),
    ).toBe(true);
  });

  it("reopens a folded exchange on click and folds it again", () => {
    render(turns);
    act(() => folds()[0].click());
    expect(host.textContent).toContain("First answer.");
    expect(host.textContent).toContain("Third answer.");
    expect(folds()[0].getAttribute("aria-expanded")).toBe("true");
    act(() => folds()[0].click());
    expect(host.textContent).not.toContain("First answer.");
  });

  it("keeps a lone first exchange open with nothing folded", () => {
    render(turns.slice(0, 2));
    expect(folds()).toHaveLength(0);
    expect(host.textContent).toContain("First answer.");
  });

  it("shows the loading shimmer for an answer still to arrive", () => {
    render(
      [
        ...turns.slice(0, 2),
        { role: "user", content: "more" },
        { role: "assistant", content: "" },
      ],
      true,
    );
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.textContent).not.toContain("First answer.");
  });
});
