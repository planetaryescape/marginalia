// @vitest-environment happy-dom

import type { ReadingScope } from "@marginalia/backend/bible";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadingScopeControl } from "./reading-scope";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.save }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.save.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((el) => {
      el.remove();
    });
  vi.unstubAllGlobals();
});

const render = (scope: ReadingScope) =>
  act(async () => root.render(<ReadingScopeControl scope={scope} />));
const trigger = () =>
  container.querySelector<HTMLButtonElement>("button[aria-label^='Look in']")!;
const choices = () => [
  ...document.querySelectorAll<HTMLElement>("[role='menuitemradio']"),
];
const click = (element: Element) =>
  act(async () =>
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
const open = () => press(trigger(), "Enter");
const press = (element: Element, key: string) =>
  act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("reading source control", () => {
  it("names the current choice and exposes all three radio choices", async () => {
    await render("mixed");
    expect(trigger().getAttribute("aria-label")).toBe(
      "Look in, Articles + Bible",
    );
    await open();
    expect(choices().map((item) => item.textContent?.trim())).toEqual([
      "Articles only",
      "Articles + Bible",
      "Bible only",
    ]);
    expect(choices().map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(container.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("selects by keyboard and restores focus after Escape", async () => {
    await render("articles");
    await press(trigger(), "Enter");
    expect(choices()).toHaveLength(3);
    await press(choices()[0], "ArrowDown");
    await press(choices()[1], "Enter");
    expect(mocks.save).toHaveBeenCalledWith({ scope: "mixed" });
    expect(trigger().getAttribute("aria-label")).toBe("Look in, Articles only");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.activeElement).toBe(trigger());

    await press(trigger(), "Enter");
    await press(choices()[0], "Escape");
    expect(choices()).toHaveLength(0);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.activeElement).toBe(trigger());
  });

  it("uses the updated controlled scope after a successful save", async () => {
    await render("articles");
    await open();
    await click(choices()[2]);
    expect(mocks.save).toHaveBeenCalledWith({ scope: "bible" });
    expect(trigger().getAttribute("aria-label")).toBe("Look in, Articles only");
    await render("bible");
    expect(trigger().getAttribute("aria-label")).toBe("Look in, Bible only");
  });

  it("prevents another save while pending", async () => {
    let resolveSave!: () => void;
    mocks.save.mockImplementation(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    await render("articles");
    await open();
    const choice = choices()[1];
    await act(async () => {
      choice?.click();
      choice?.click();
    });
    expect(trigger().getAttribute("aria-disabled")).toBe("true");
    expect(trigger().getAttribute("aria-busy")).toBe("true");
    await click(trigger());
    await open();
    expect(choices()).toHaveLength(0);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave());
    expect(trigger().getAttribute("aria-disabled")).toBe("false");
  });

  it("restores keyboard focus after a non-instant save finishes", async () => {
    let resolveSave!: () => void;
    mocks.save.mockImplementation(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    await render("articles");
    trigger().focus();
    await press(trigger(), "Enter");
    await press(choices()[1], "Enter");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(trigger().getAttribute("aria-disabled")).toBe("true");
    await act(async () => resolveSave());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(document.activeElement).toBe(trigger());
  });

  it("does not take focus back if it moved while the save was pending", async () => {
    let resolveSave!: () => void;
    mocks.save.mockImplementation(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    await render("articles");
    const elsewhere = document.createElement("button");
    elsewhere.textContent = "Elsewhere";
    container.appendChild(elsewhere);
    await open();
    await press(choices()[1], "Enter");
    elsewhere.focus();
    await act(async () => resolveSave());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(document.activeElement).toBe(elsewhere);
  });

  it("keeps the saved label on failure and offers a retry", async () => {
    mocks.save.mockRejectedValueOnce(new Error("offline"));
    await render("articles");
    await open();
    await click(choices()[2]);
    expect(trigger().getAttribute("aria-label")).toBe("Look in, Articles only");
    const alert = document.querySelector<HTMLElement>("[role='alert']");
    expect(alert?.textContent).toContain("Couldn't change reading sources.");
    await click(alert!.querySelector("button")!);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenLastCalledWith({ scope: "bible" });
  });
});
