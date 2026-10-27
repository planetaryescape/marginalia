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
  vi.unstubAllGlobals();
});

const render = (scope: ReadingScope) =>
  act(async () => root.render(<ReadingScopeControl scope={scope} />));
const radios = () => [
  ...container.querySelectorAll<HTMLButtonElement>("[role=radio]"),
];
const press = (element: Element, key: string) =>
  act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const click = (element: Element) =>
  act(async () =>
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );

describe("reading source control", () => {
  it("exposes all sources as a selected, labeled radio group", async () => {
    await render("mixed");
    expect(
      container
        .querySelector("[role=radiogroup]")
        ?.getAttribute("aria-labelledby"),
    ).toBe("reading-source-label");
    expect(container.querySelector("#reading-source-label")?.textContent).toBe(
      "Look in",
    );
    expect(radios().map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Articles only",
      "Articles + Bible",
      "Bible only",
    ]);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(
      ["false", "true", "false"],
    );
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("moves by arrows, saves the highlighted source, and preserves focus", async () => {
    await render("articles");
    radios()[0]?.focus();
    await press(radios()[0]!, "ArrowRight");
    expect(document.activeElement).toBe(radios()[1]);
    expect(mocks.save).toHaveBeenCalledWith({ scope: "mixed" });
  });

  it("uses the controlled scope after a successful save", async () => {
    await render("articles");
    await click(radios()[2]!);
    expect(mocks.save).toHaveBeenCalledWith({ scope: "bible" });
    await render("bible");
    expect(radios()[2]?.getAttribute("aria-checked")).toBe("true");
  });

  it("prevents another save while the first source update is pending", async () => {
    let resolveSave!: () => void;
    mocks.save.mockImplementation(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    await render("articles");
    await act(async () => {
      radios()[1]?.click();
      radios()[2]?.click();
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector("[role=radiogroup]")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(radios().every((radio) => !radio.disabled)).toBe(true);
    await act(async () => resolveSave());
    expect(radios().every((radio) => !radio.disabled)).toBe(true);
  });

  it("keeps the selected source after failure and offers retry", async () => {
    mocks.save.mockRejectedValueOnce(new Error("offline"));
    await render("articles");
    await click(radios()[2]!);
    const alert = container.querySelector<HTMLElement>("[role=alert]");
    expect(alert?.textContent).toContain("Couldn't change reading sources.");
    await click(alert!.querySelector("button")!);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenLastCalledWith({ scope: "bible" });
  });

  it("cycles Articles → Both → Bible with unmodified F", async () => {
    await render("articles");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(mocks.save).toHaveBeenCalledWith({ scope: "mixed" });
  });
});
