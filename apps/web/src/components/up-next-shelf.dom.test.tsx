// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpNextShelf } from "./up-next-shelf";

const state = vi.hoisted(() => ({
  overview: undefined as unknown,
  calls: [] as { name: string; args: unknown }[],
  fail: false,
  toast: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } =
    await vi.importActual<typeof import("convex/server")>("convex/server");
  return {
    useQuery: () => state.overview,
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
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <li className={className}>{children}</li>,
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

  it("keeps the row and says so when archiving fails", async () => {
    state.fail = true;
    await render();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Archive First piece"]',
        )
        ?.click(),
    );
    expect(state.toastError).toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
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
});
