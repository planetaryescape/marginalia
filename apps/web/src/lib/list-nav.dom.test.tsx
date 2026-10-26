// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListKeys, useTabKeys } from "./list-nav";

const tabs = [
  { id: "a", href: "/x" },
  { id: "b", href: "/x?tab=b" },
  { id: "c", href: "/x?tab=c" },
];
const visited = vi.fn();
const remove = vi.fn();
const toggle = vi.fn();

function Harness({ current = "a" }: { current?: string }) {
  useTabKeys(tabs, current);
  useListKeys({ x: { action: "remove", leaves: true } }, [["x", "Remove"]]);
  return (
    <>
      <nav data-nav-tabs>
        {tabs.map((tab) => (
          <a
            key={tab.id}
            href={tab.href}
            onClick={(e) => {
              e.preventDefault();
              visited(tab.href);
            }}
          >
            {tab.id}
          </a>
        ))}
      </nav>
      <ul>
        {["one", "two", "three"].map((name) => (
          <li key={name} data-nav-row>
            <a href={`/${name}`} data-nav-item>
              {name}
            </a>
            <button type="button" data-nav-action="remove" onClick={remove}>
              remove {name}
            </button>
          </li>
        ))}
        <li data-nav-row>
          <div data-nav-item tabIndex={-1}>
            row
          </div>
          <button type="button" onClick={toggle}>
            inner
          </button>
        </li>
      </ul>
      <input aria-label="field" />
      <button type="button" id="other">
        other
      </button>
    </>
  );
}

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visited.mockClear();
  remove.mockClear();
  toggle.mockClear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

const render = (current?: string) =>
  act(async () => root.render(<Harness current={current} />));
const press = async (key: string, target: Element = document.body) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
};
const items = () => Array.from(document.querySelectorAll("[data-nav-item]"));

describe("tab keys", () => {
  it("[ and ] move to the previous and next tab, wrapping round", async () => {
    await render("a");
    await press("]");
    expect(visited).toHaveBeenLastCalledWith("/x?tab=b");
    await press("[");
    expect(visited).toHaveBeenLastCalledWith("/x?tab=c");
  });

  it("the arrows switch tabs from the page or the strip, not from other controls", async () => {
    await render("b");
    await press("ArrowRight");
    expect(visited).toHaveBeenLastCalledWith("/x?tab=c");
    const link = document.querySelector("nav a") as HTMLElement;
    link.focus();
    await press("ArrowLeft", link);
    expect(visited).toHaveBeenLastCalledWith("/x");
    visited.mockClear();
    const other = document.getElementById("other") as HTMLElement;
    other.focus();
    const event = await press("ArrowRight", other);
    expect(visited).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing while typing in a field", async () => {
    await render("a");
    const input = document.querySelector("input") as HTMLElement;
    input.focus();
    await press("]", input);
    await press("ArrowRight", input);
    expect(visited).not.toHaveBeenCalled();
  });
});

describe("list keys", () => {
  it("j and k move through items; the arrows only once an item has focus", async () => {
    await render();
    const scroll = await press("ArrowDown");
    expect(scroll.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(document.body);
    await press("j");
    expect(document.activeElement).toBe(items()[0]);
    await press("ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    await press("k");
    expect(document.activeElement).toBe(items()[0]);
    // The ends hold
    await press("ArrowUp");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("a row action clicks that row's button and moves focus to the neighbour first", async () => {
    await render();
    await press("j");
    await press("j");
    await press("x");
    expect(remove).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(items()[2]);
    // Removing the last link-row hands focus back, not to <body>
    await press("x");
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("leaves action keys alone when no row is focused", async () => {
    await render();
    const event = await press("x");
    expect(remove).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("Enter on a row that is not a link moves into its controls, and a link keeps Enter", async () => {
    await render();
    const row = items()[3] as HTMLElement;
    row.focus();
    await press("Enter", row);
    expect(document.activeElement?.textContent).toBe("inner");
    const link = items()[0] as HTMLElement;
    link.focus();
    const event = await press("Enter", link);
    expect(event.defaultPrevented).toBe(false);
  });

  it("never fires while typing in a field", async () => {
    await render();
    const input = document.querySelector("input") as HTMLElement;
    input.focus();
    for (const key of ["j", "k", "x", "ArrowDown", "Enter"])
      await press(key, input);
    expect(document.activeElement).toBe(input);
    expect(remove).not.toHaveBeenCalled();
  });
});
