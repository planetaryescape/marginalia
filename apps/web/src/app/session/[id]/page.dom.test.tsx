// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionPage from "./page";

const state = vi.hoisted(() => ({
  head: undefined as unknown[] | undefined,
  paged: {
    results: [] as unknown[],
    status: "CanLoadMore" as string,
    loadMore: vi.fn(),
  },
  // Each mutation waits until the test resolves it, so races can be reproduced
  pending: [] as { action?: string; articleId?: string; resolve: () => void }[],
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } =
    await vi.importActual<typeof import("convex/server")>("convex/server");
  return {
    useQuery: (fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(fn as never);
      if (name === "sessions:getById") return { requestedMinutes: 5 };
      if (name === "suggestions:forWindow") return state.head;
      if (name === "suggestions:shortestUnread") return null;
      throw new Error(`unexpected query ${name}`);
    },
    usePaginatedQuery: () => state.paged,
    useMutation: () => (args: { action?: string; articleId?: string }) =>
      new Promise<void>((resolve) => {
        state.pending.push({ ...args, resolve });
      }),
  };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
  useSearchParams: () => ({ get: () => "5" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
  },
}));

const card = (id: string) => ({
  _id: id,
  title: `Title ${id}`,
  author: "Author",
  url: `https://example.com/${id}`,
  estimatedReadMinutes: 2,
  reason: "Fits your 5-minute window",
});

let root: Root;
beforeEach(() => {
  state.head = [card("a"), card("b"), card("c")];
  state.paged = { results: [], status: "CanLoadMore", loadMore: vi.fn() };
  state.pending = [];
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const render = () => act(async () => root.render(<SessionPage />));
const button = (text: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement;
/** Resolves every mutation issued so far and lets React settle. */
const settle = () =>
  act(async () => {
    const waiting = state.pending.splice(0);
    for (const m of waiting) m.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
const skipped = () => state.pending.filter((m) => m.action === "skipped");

describe("session deck card actions", () => {
  it("a double Skip records once and shows the next card, not the one after", async () => {
    await render();
    await act(async () => {
      button("Skip").click();
      button("Skip").click();
    });
    expect(skipped()).toHaveLength(1);
    await settle();
    expect(document.body.textContent).toContain("Title b");
    expect(document.body.textContent).not.toContain("Title c");
  });

  it("Skip on the last loaded card, with the next page still pending, shows the card that arrives", async () => {
    state.paged.status = "LoadingMore";
    await render();
    await act(async () => button("Skip").click());
    await settle();
    await act(async () => button("Skip").click());
    await settle();
    expect(document.body.textContent).toContain("Title c");

    // A double click on the last loaded card must advance once, not twice
    await act(async () => {
      button("Skip").click();
      button("Skip").click();
    });
    expect(skipped()).toHaveLength(1);
    await settle();
    // The page has not arrived yet: a quiet loading state, not the end
    expect(document.body.textContent).toContain("Finding something");
    expect(document.body.textContent).not.toContain("That's everything");

    state.paged = {
      results: [card("d")],
      status: "Exhausted",
      loadMore: vi.fn(),
    };
    await render();
    expect(document.body.textContent).toContain("Title d");
    expect(document.body.textContent).not.toContain("That's everything");
  });
});
