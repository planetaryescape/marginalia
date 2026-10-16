// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedShelf } from "./library-shelves";

const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[],
  fail: false,
  toastError: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } =
    await vi.importActual<typeof import("convex/server")>("convex/server");
  return {
    useQuery: () => [
      {
        _id: "s1",
        article: { _id: "a1", title: "First saved", estimatedReadMinutes: 4 },
      },
      {
        _id: "s2",
        article: { _id: "a2", title: "Second saved", estimatedReadMinutes: 6 },
      },
    ],
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
