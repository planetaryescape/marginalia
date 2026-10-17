// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryMatches } from "./library-matches";

const state = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  retry: [] as number[],
}));

vi.mock("@/lib/use-topic-search", () => ({
  useTopicSearch: (_text: string, _enabled: boolean, retry: number) => {
    state.retry.push(retry);
    return state.result;
  },
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    scroll?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let root: Root;
beforeEach(() => {
  state.retry = [];
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
const render = () =>
  act(async () => root.render(<LibraryMatches query="deep work" />));

describe("Library matches", () => {
  it("lists every matching article as a row, not an answer", async () => {
    state.result = {
      query: "deep work",
      status: "ready",
      more: false,
      matches: [
        {
          articleId: "a1",
          title: "On focus",
          author: null,
          source: "example.org",
          minutes: 8,
          status: "Up next",
        },
        {
          articleId: "a2",
          title: "Shallow days",
          author: "Cal",
          source: null,
          minutes: null,
          status: "Finished",
        },
      ],
    };
    await render();
    const rows = document.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("On focus");
    expect(rows[0].textContent).toContain("example.org · 8 min read · Up next");
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe("/read/a1");
    expect(rows[1].textContent).toContain("Cal · Finished");
    expect(document.body.textContent).toContain("Matches for “deep work”");
  });

  it("shows a skeleton while searching, never a centred loader", async () => {
    state.result = { query: "deep work", status: "loading", matches: [] };
    await render();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Loading");
  });

  it("shows a failure in place with Retry, which searches again", async () => {
    state.result = { query: "deep work", status: "error", matches: [] };
    await render();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't search your library.");
    await act(async () => alert?.querySelector("button")?.click());
    expect(state.retry.at(-1)).toBe(1);
  });

  it("says so when nothing fits", async () => {
    state.result = {
      query: "deep work",
      status: "ready",
      more: false,
      matches: [],
    };
    await render();
    expect(document.body.textContent).toContain("Nothing in your library fits");
  });
});
