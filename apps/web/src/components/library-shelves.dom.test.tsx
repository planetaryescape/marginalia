// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LovedShelf, SavedShelf } from "./library-shelves";

const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[],
  fail: false,
  toastError: vi.fn(),
  status: "Exhausted" as string,
  loadMore: vi.fn(),
  paged: [] as { name: string; args: unknown }[],
  loved: [] as unknown[],
}));

const saved = [
  {
    _id: "s1",
    article: { _id: "a1", title: "First saved", estimatedReadMinutes: 4 },
  },
  {
    _id: "s2",
    article: { _id: "a2", title: "Second saved", estimatedReadMinutes: 6 },
  },
];

vi.mock("convex/react", async () => {
  const { getFunctionName } =
    await vi.importActual<typeof import("convex/server")>("convex/server");
  return {
    usePaginatedQuery: (fn: unknown, args: unknown) => {
      const name = getFunctionName(fn as never);
      state.paged.push({ name, args });
      return {
        results: name === "lovedArticles:page" ? state.loved : saved,
        status: state.status,
        loadMore: state.loadMore,
      };
    },
    useMutation: (fn: unknown) => async (args: unknown) => {
      state.calls.push({ name: getFunctionName(fn as never), args });
      if (state.fail) throw new Error("no");
    },
  };
});
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => state.toastError(...a) },
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

let root: Root;
beforeEach(() => {
  state.calls = [];
  state.fail = false;
  state.toastError = vi.fn();
  state.status = "Exhausted";
  state.loadMore = vi.fn();
  state.paged = [];
  state.loved = [];
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
const render = () => act(async () => root.render(<SavedShelf />));
const button = (name: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === name,
  );
const press = (key: string) =>
  act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

describe("Saved shelf", () => {
  it("has a text Remove, not a bare cross, and removes nothing until confirmed", async () => {
    await render();
    expect(document.body.textContent).not.toContain("×");
    const remove = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove First saved from saved articles"]',
    );
    expect(remove?.textContent).toBe("Remove");
    await act(async () => remove?.click());
    expect(document.body.textContent).toContain("Remove from saved?");
    expect(state.calls).toEqual([]);
    await act(async () => button("Keep")?.click());
    expect(document.body.textContent).not.toContain("Remove from saved?");
    expect(state.calls).toEqual([]);
  });

  it("removes the article once confirmed", async () => {
    await render();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove First saved from saved articles"]',
        )
        ?.click(),
    );
    await act(async () => button("Remove")?.click());
    expect(state.calls).toEqual([
      { name: "savedArticles:unsave", args: { articleId: "a1" } },
    ]);
  });

  it("asks from the s key and answers with the focused Remove", async () => {
    await render();
    document.querySelector<HTMLElement>("[data-nav-item]")?.focus();
    await press("s");
    expect(document.body.textContent).toContain("Remove from saved?");
    expect(document.activeElement?.textContent).toBe("Remove");
    await press("Escape");
    expect(document.body.textContent).not.toContain("Remove from saved?");
  });

  it("shows a failed removal on the shelf with Retry, not a toast", async () => {
    state.fail = true;
    await render();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove First saved from saved articles"]',
        )
        ?.click(),
    );
    await act(async () => button("Remove")?.click());
    expect(state.toastError).not.toHaveBeenCalled();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't remove “First saved”");
    state.fail = false;
    await act(async () => alert?.querySelector("button")?.click());
    expect(state.calls).toHaveLength(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("Shelves from pages", () => {
  it("asks for the Saved shelf a page at a time, and shows no More once exhausted", async () => {
    await render();
    expect(state.paged[0].name).toBe("savedArticles:page");
    expect(document.body.textContent).toContain("Second saved");
    expect(button("More")).toBeUndefined();
  });

  it("offers More while the shelf can load more, and asks for the next page", async () => {
    state.status = "CanLoadMore";
    await render();
    await act(async () => button("More")?.click());
    expect(state.loadMore).toHaveBeenCalledWith(12);
  });

  it("shows Loading more and disables More while a page is on its way", async () => {
    state.status = "LoadingMore";
    await render();
    const more = button("Loading more") as HTMLButtonElement | undefined;
    expect(more?.disabled).toBe(true);
  });

  it("says Reading in a row's meta once the article is opened and unfinished", async () => {
    state.status = "Exhausted";
    state.loved = [
      {
        _id: "l1",
        article: {
          _id: "a9",
          title: "An opened piece",
          author: "Ada",
          estimatedReadMinutes: 7,
          reading: true,
        },
      },
    ];
    await act(async () => root.render(<LovedShelf />));
    expect(document.body.textContent).toContain("Ada · 7 min read · Reading");
  });

  it("draws the Loved shelf from its pages", async () => {
    state.status = "CanLoadMore";
    state.loved = [
      {
        _id: "l1",
        article: {
          _id: "a9",
          title: "A loved piece",
          author: "Ada",
          estimatedReadMinutes: 7,
        },
      },
    ];
    await act(async () => root.render(<LovedShelf />));
    expect(state.paged[0].name).toBe("lovedArticles:page");
    expect(document.body.textContent).toContain("A loved piece");
    expect(document.body.textContent).toContain("Ada");
    expect(button("More")).toBeDefined();
  });

  it("says so when nothing is loved", async () => {
    await act(async () => root.render(<LovedShelf />));
    expect(document.body.textContent).toContain("No loved articles yet.");
  });
});
