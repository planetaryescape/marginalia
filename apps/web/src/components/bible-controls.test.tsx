// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleFinder } from "./article-finder";
import { BibleSettings } from "./bible-settings";

const state = vi.hoisted(() => ({
  enabled: false,
  scope: "articles",
  translation: "web",
}));
const setPreferences = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const suggest = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    passages: [
      {
        reference: "Psalms 23",
        title: "Rest and trust",
        reason: "Comfort in uncertainty",
        minutes: 1,
      },
    ],
    notice: null,
  }),
);
const openPassage = vi.hoisted(() => vi.fn().mockResolvedValue("passageid"));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    switch (getFunctionName(ref)) {
      case "bible:preferences":
        return { ...state };
      case "bible:translations":
        return [
          {
            code: "web",
            name: "World English Bible",
            style: "Literal",
            available: true,
          },
          {
            code: "esv",
            name: "English Standard Version",
            style: "Literal",
            available: false,
          },
        ];
      case "home:overview":
        return { upNext: [] };
      default:
        throw new Error(`Unexpected query ${getFunctionName(ref)}`);
    }
  },
  useMutation: () => setPreferences,
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "actions/bible:suggest" ? suggest : openPassage,
}));

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  Object.assign(state, {
    enabled: false,
    scope: "articles",
    translation: "web",
  });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function openSearch() {
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')
      ?.click(),
  );
}
async function typeSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
  if (!input) throw new Error("Search input missing");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
}

describe("Bible opt-in controls", () => {
  it("shows completed article results while Bible search is stalled, times out, and ignores a late Bible response", async () => {
    Object.assign(state, { enabled: true, scope: "mixed" });
    let resolveBible:
      | ((value: Awaited<ReturnType<typeof suggest>>) => void)
      | undefined;
    suggest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBible = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        Response.json({
          matches: [
            {
              articleId: "articleid",
              title: "Ready article",
              author: null,
              minutes: 5,
              status: "Unread",
              reason: "Available now",
            },
          ],
        }),
      ),
    );
    await act(async () => root.render(<ArticleFinder />));
    await openSearch();
    await typeSearch("comfort");
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Ready article",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(document.body.textContent).toContain(
      "Bible search couldn't complete",
    );
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent === "Retry search",
      ),
    ).toBe(true);
    await act(async () =>
      resolveBible?.({
        passages: [
          {
            reference: "Psalms 23",
            title: "Late",
            reason: "Too late",
            minutes: 1,
          },
        ],
        notice: null,
      }),
    );
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Ready article",
    );
  });
  it("shows Bible results without waiting for article search to settle", async () => {
    Object.assign(state, { enabled: true, scope: "mixed" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );
    await act(async () => root.render(<ArticleFinder />));
    await openSearch();
    await typeSearch("comfort");
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Psalms 23",
    );
  });
  it("only shows the opt-in setting, not translation controls, before enabling", async () => {
    await act(async () => root.render(<BibleSettings />));
    const toggle = document.querySelector<HTMLInputElement>('[role="switch"]');
    expect(toggle?.checked).toBe(false);
    expect(document.querySelector("select")).toBeNull();
    await act(async () => toggle?.click());
    expect(setPreferences).toHaveBeenCalledWith({ enabled: true });
  });
  it("labels unavailable translations rather than offering a working-looking ESV option", async () => {
    state.enabled = true;
    await act(async () => root.render(<BibleSettings />));
    expect(
      document.querySelector<HTMLOptionElement>('option[value="esv"]')
        ?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLOptionElement>('option[value="web"]')
        ?.disabled,
    ).toBe(false);
    expect(document.body.textContent).toContain("not yet licensed");
  });
  it("doesn't show Bible discovery controls or make Bible searches while disabled", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ matches: [] })));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ArticleFinder />));
    await openSearch();
    expect(document.body.textContent).not.toContain("Bible only");
    expect(document.body.textContent).not.toContain("Browse the Bible");
    await typeSearch("hope");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(suggest).not.toHaveBeenCalled();
  });
  it("searches Bible-only without calling library search, and opens the selected passage", async () => {
    Object.assign(state, { enabled: true, scope: "bible" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ArticleFinder />));
    await openSearch();
    await typeSearch("comfort");
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Psalms 23",
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[role="option"]')?.click(),
    );
    expect(openPassage).toHaveBeenCalledWith({ reference: "Psalms 23" });
    expect(push).toHaveBeenCalledWith("/read/passageid");
  });
  it("drops Bible search results immediately when the setting is switched off", async () => {
    Object.assign(state, { enabled: true, scope: "bible" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ matches: [] }))),
    );
    await act(async () => root.render(<ArticleFinder />));
    await openSearch();
    await typeSearch("comfort");
    expect(document.querySelector('[role="option"]')).not.toBeNull();
    state.enabled = false;
    await act(async () => root.render(<ArticleFinder />));
    expect(document.querySelector('[role="option"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Browse the Bible");
  });
  it("shows both sources in mixed search, without letting a cached Bible result leak into articles-only", async () => {
    Object.assign(state, { enabled: true, scope: "mixed" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        Response.json({
          matches: [
            {
              articleId: "articleid",
              title: "An article about comfort",
              author: "Writer",
              minutes: 5,
              status: "Unread",
              reason: "A practical essay",
            },
          ],
        }),
      ),
    );
    await act(async () => root.render(<ArticleFinder />));
    await openSearch();
    await typeSearch("comfort");
    expect(
      Array.from(document.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Psalms 23"),
      expect.stringContaining("An article about comfort"),
    ]);
    state.scope = "articles";
    await act(async () => root.render(<ArticleFinder />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "An article about comfort",
    );
  });
  it("keeps Bible results available and offers a working retry when article search fails", async () => {
    Object.assign(state, { enabled: true, scope: "mixed" });
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response("Unavailable", { status: 503 }),
      );
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ArticleFinder />));
    await openSearch();
    await typeSearch("comfort");
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Psalms 23",
    );
    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry search",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
