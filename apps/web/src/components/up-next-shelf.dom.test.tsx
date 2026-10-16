// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpNextShelf } from "./up-next-shelf";

const state = vi.hoisted(() => ({
  overview: undefined as unknown,
  status: "Exhausted" as string,
  loadMore: vi.fn(),
  saved: [] as unknown[],
  calls: [] as { name: string; args: unknown }[],
  fail: false,
  toast: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } =
    await vi.importActual<typeof import("convex/server")>("convex/server");
  return {
    useQuery: (fn: unknown) =>
      getFunctionName(fn as never) === "savedArticles:savedIds"
        ? state.saved
        : state.overview,
    usePaginatedQuery: () => ({
      results:
        (state.overview as { upNext: unknown[] } | undefined)?.upNext ?? [],
      status: state.status,
      loadMore: state.loadMore,
    }),
    useMutation: (fn: unknown) => async (args: unknown) => {
      state.calls.push({ name: getFunctionName(fn as never), args });
      if (state.fail) throw new Error("no");
    },
  };
});
vi.mock("sonner", () => ({
  toast: Object.assign((...a: unknown[]) => state.toast(...a), {
    error: (...a: unknown[]) => state.toastError(...a),
  }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("framer-motion", () => ({
  useReducedMotion: () => false,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    li: ({
      children,
      className,
      ...rest
    }: {
      children: React.ReactNode;
      className?: string;
      "data-nav-row"?: boolean;
    }) => (
      <li className={className} data-nav-row={rest["data-nav-row"]}>
        {children}
      </li>
    ),
  },
}));

let root: Root;
beforeEach(() => {
  state.overview = {
    upNext: [
      { _id: "a", title: "First piece", source: "example.org", minutes: 9 },
      {
        _id: "b",
        title: "Second piece",
        source: undefined,
        minutes: undefined,
      },
    ],
  };
  state.saved = [];
  state.status = "Exhausted";
  state.loadMore = vi.fn();
  state.calls = [];
  state.fail = false;
  state.toast = vi.fn();
  state.toastError = vi.fn();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
const render = () => act(async () => root.render(<UpNextShelf />));

describe("Up next shelf", () => {
  it("lists unread articles with a source and minutes line", async () => {
    await render();
    const rows = document.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("First piece");
    expect(rows[0].textContent).toContain("example.org · 9 min");
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe("/read/a");
  });

  it("archives with an Undo that restores", async () => {
    await render();
    const archive = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Archive First piece"]',
    );
    expect(archive).not.toBeNull();
    await act(async () => archive?.click());
    expect(state.calls).toEqual([
      { name: "articles:archive", args: { articleId: "a" } },
    ]);
    const [message, options] = state.toast.mock.calls[0];
    expect(message).toBe("Archived “First piece”");
    expect(options.action.label).toBe("Undo");
    await act(async () => options.action.onClick());
    expect(state.calls[1]).toEqual({
      name: "articles:restore",
      args: { articleId: "a" },
    });
  });

  it("keeps the row and shows the failure on the shelf with Retry", async () => {
    state.fail = true;
    await render();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Archive First piece"]',
        )
        ?.click(),
    );
    expect(state.toastError).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't archive “First piece”");
    expect(document.querySelectorAll("li")).toHaveLength(2);
    state.fail = false;
    await act(async () =>
      alert?.querySelector<HTMLButtonElement>("button")?.click(),
    );
    expect(state.calls.at(-1)).toEqual({
      name: "articles:archive",
      args: { articleId: "a" },
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("offers More while pages remain, and loads the next one", async () => {
    state.status = "CanLoadMore";
    await render();
    const more = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "More",
    );
    expect(more).toBeDefined();
    await act(async () => more?.click());
    expect(state.loadMore).toHaveBeenCalledWith(8);
  });

  it("has no More once every article is listed", async () => {
    await render();
    expect(document.body.textContent).not.toContain("More");
  });

  it("is reachable by keyboard and always shown on touch", async () => {
    await render();
    const archive = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Archive First piece"]',
    );
    expect(archive?.tabIndex).toBe(0);
    // Hidden only where a pointer can hover; revealed on row hover and focus
    expect(archive?.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(archive?.className).toContain(
      "[@media(hover:hover)]:focus-visible:opacity-100",
    );
    expect(archive?.className).toContain("group-focus-within/row");
  });

  it("renders nothing while loading or when nothing is waiting", async () => {
    state.overview = undefined;
    await render();
    expect(document.querySelector("section")).toBeNull();
    state.overview = { upNext: [] };
    await render();
    expect(document.querySelector("section")).toBeNull();
  });

  describe("keyboard", () => {
    const press = (key: string, target: Element = document.body) =>
      act(async () => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    const links = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-nav-item]"));

    it("j and k move focus between rows, and the arrows once a row has it", async () => {
      await render();
      await press("ArrowDown");
      expect(document.activeElement).not.toBe(links()[0]);
      await press("j");
      expect(document.activeElement).toBe(links()[0]);
      await press("j");
      expect(document.activeElement).toBe(links()[1]);
      await press("ArrowUp");
      expect(document.activeElement).toBe(links()[0]);
      await press("k");
      expect(document.activeElement).toBe(links()[0]);
    });

    it("x archives the focused row, moves focus on, and u undoes it", async () => {
      await render();
      await press("j");
      await press("x");
      expect(state.calls).toEqual([
        { name: "articles:archive", args: { articleId: "a" } },
      ]);
      expect(document.activeElement).toBe(links()[1]);
      await press("u");
      expect(state.calls[1]).toEqual({
        name: "articles:restore",
        args: { articleId: "a" },
      });
      // Nothing left to undo
      await press("u");
      expect(state.calls).toHaveLength(2);
    });

    it("s saves the focused row, and unsaves one already saved", async () => {
      state.saved = ["b"];
      await render();
      await press("j");
      await press("s");
      expect(state.calls.at(-1)).toEqual({
        name: "savedArticles:save",
        args: { articleId: "a" },
      });
      await press("j");
      await press("s");
      expect(state.calls.at(-1)).toEqual({
        name: "savedArticles:unsave",
        args: { articleId: "b" },
      });
    });

    it("does nothing with no row focused, or while typing", async () => {
      await render();
      await press("x");
      const input = document.body.appendChild(document.createElement("input"));
      input.focus();
      await press("j", input);
      await press("x", input);
      expect(state.calls).toEqual([]);
      expect(document.activeElement).toBe(input);
    });
  });
});
