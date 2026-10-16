// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadingPage from "./page";

const mocks = vi.hoisted(() => ({
  tab: null as string | null,
  todays: [] as (string | undefined)[],
  room: undefined as unknown,
  topics: undefined as unknown,
  merges: undefined as unknown,
  accept: vi.fn(),
  keepBoth: vi.fn(),
  lookups: {
    results: [] as unknown[],
    status: "Exhausted" as string,
    loadMore: vi.fn(),
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args?: { today?: string }) => {
    if (ref === "room") mocks.todays.push(args?.today);
    return (mocks as never)[ref];
  },
  usePaginatedQuery: () => mocks.lookups,
  useMutation: (ref: string) => (mocks as never)[ref],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    stats: { readingRoom: "room", readingTopics: "topics" },
    dictionary: { page: "page" },
    tagMerge: { pending: "merges", accept: "accept", keepBoth: "keepBoth" },
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => mocks.tab }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: PropsWithChildren<{ href: string; className?: string }>) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const grid = (cells: [number, number][] = []) => {
  const g = new Array<number>(168).fill(0);
  for (const [slot, n] of cells) g[slot] = n;
  return g;
};
const split = { short: 0, middle: 0, long: 0 };
const room = (over: object = {}) => ({
  period: {},
  partial: false,
  readsPartial: false,
  activeTimeMs: 3 * 3_600_000,
  readingDays: 5,
  heat: grid([[7, 30]]),
  weekday: { short: 3, middle: 0, long: 1 },
  weekend: split,
  shortSlots: grid(),
  longSlots: grid(),
  feeds: [],
  ...over,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.tab = null;
  mocks.todays = [];
  mocks.room = undefined;
  mocks.topics = undefined;
  mocks.merges = undefined;
  mocks.accept = vi.fn().mockResolvedValue(null);
  mocks.keepBoth = vi.fn().mockResolvedValue(null);
  mocks.lookups = { results: [], status: "Exhausted", loadMore: vi.fn() };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = () => act(async () => root.render(<ReadingPage />));

describe("Your reading", () => {
  it("opens on the stats with one sentence and tabs that carry the tab in the URL", async () => {
    mocks.room = room();
    mocks.topics = [];
    await render();
    expect(container.querySelector("h1")?.textContent).toBe("Your reading");
    expect(container.textContent).toContain(
      "This month you read for 3 hours over 5 days",
    );
    const hrefs = [...container.querySelectorAll("nav a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/reading", "/reading?tab=dictionary"]);
    expect(container.querySelector("nav a[aria-current]")?.textContent).toBe(
      "Your reading",
    );
  });

  it("says there is no reading yet for an empty month and still renders calmly", async () => {
    mocks.room = room({ activeTimeMs: 0, readingDays: 0, heat: grid() });
    mocks.topics = [];
    await render();
    expect(container.textContent).toContain("No reading yet this month.");
    expect(container.textContent).toContain("Nothing to show for this period");
    expect(container.textContent).toContain("No feed has offered you anything");
  });

  it("hides the topics block until some article has a topic", async () => {
    mocks.room = room();
    mocks.topics = [];
    await render();
    expect(container.textContent).not.toContain("The topics you return to");
    mocks.topics = [{ name: "attention", minutes: 120, articles: 4 }];
    await render();
    expect(container.textContent).toContain("The topics you return to");
    expect(container.textContent).toContain("attention");
    expect(container.textContent).toContain("2h · 4 articles");
  });

  it("points a skipped feed to Sources and offers no other action", async () => {
    mocks.room = room({
      feeds: [
        {
          feedId: "f1",
          title: "A daily digest",
          offered: 60,
          opened: 3,
          finished: 0,
          skipsMost: true,
        },
        {
          feedId: "f2",
          title: "An essays feed",
          offered: 40,
          opened: 26,
          finished: 20,
          skipsMost: false,
        },
      ],
    });
    mocks.topics = [];
    await render();
    const hints = [...container.querySelectorAll("a")].filter((a) =>
      a.textContent?.includes("you skip most of this"),
    );
    expect(hints).toHaveLength(1);
    expect(hints[0].getAttribute("href")).toBe("/feeds");
    expect(container.textContent).toContain("60 · 3 · 0");
  });
});

describe("two tags that look like one topic", () => {
  const suggestion = (over: object = {}) => ({
    suggestionId: "s1",
    into: "llm",
    from: "llms",
    strong: true,
    merging: false,
    ...over,
  });
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === name,
    );

  beforeEach(() => {
    mocks.room = room();
    mocks.topics = [
      { name: "llm", minutes: 120, articles: 4 },
      { name: "llms", minutes: 60, articles: 2 },
      { name: "attention", minutes: 90, articles: 3 },
    ];
  });

  it("says so under the topics, underlines both names, and acts on neither", async () => {
    mocks.merges = [suggestion()];
    await render();
    expect(container.textContent).toContain(
      "llm and llms look like the same topic.",
    );
    expect(button("Merge into llm")).toBeDefined();
    expect(button("Keep both")).toBeDefined();
    const underlined = [...container.querySelectorAll("li")]
      .filter((li) => li.className.includes("underline"))
      .map((li) => li.firstChild?.textContent);
    expect(underlined).toEqual(["llm", "llms"]);
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.keepBoth).not.toHaveBeenCalled();
  });

  it("Merge into asks for that merge, and Keep both for that one", async () => {
    mocks.merges = [suggestion()];
    await render();
    await act(async () => button("Merge into llm")?.click());
    expect(mocks.accept).toHaveBeenCalledWith({ suggestionId: "s1" });
    await act(async () => button("Keep both")?.click());
    expect(mocks.keepBoth).toHaveBeenCalledWith({ suggestionId: "s1" });
  });

  it("shows a merge in progress without the buttons", async () => {
    mocks.merges = [suggestion({ merging: true })];
    await render();
    expect(container.textContent).toContain("Merging…");
    expect(button("Merge into llm")).toBeUndefined();
  });

  it("says nothing when there is no suggestion", async () => {
    mocks.merges = [];
    await render();
    expect(container.textContent).not.toContain("look like the same topic");
    expect(
      [...container.querySelectorAll("li")].some((li) =>
        li.className.includes("underline"),
      ),
    ).toBe(false);
  });
});

const lookup = (over: object) => ({
  _id: `l-${Math.random()}`,
  articleId: "art1",
  articleTitle: "On boring infrastructure",
  articleGone: false,
  word: "elastic",
  wordKey: "elastic",
  sentence: "the queue stays elastic under load",
  paragraphIndex: 4,
  sense: "adj. able to stretch to meet demand",
  createdAt: new Date(2026, 0, 3).getTime(),
  ...over,
});

describe("Your reading at midnight", () => {
  afterEach(() => vi.useRealTimers());

  it("asks again with the new date when the day rolls over while the room is open", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 30));
    mocks.room = room();
    mocks.topics = [];
    await render();
    expect(mocks.todays.at(-1)).toBe("2026-10-31");
    await act(async () => vi.advanceTimersByTime(40_000));
    expect(mocks.todays.at(-1)).toBe("2026-11-01");
  });

  it("refreshes the date when the tab becomes visible again", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 30, 12));
    mocks.room = room();
    mocks.topics = [];
    await render();
    vi.setSystemTime(new Date(2026, 10, 2, 8));
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(mocks.todays.at(-1)).toBe("2026-11-02");
  });
});

describe("Dictionary", () => {
  beforeEach(() => {
    mocks.tab = "dictionary";
  });

  it("invites the first lookup when the library is empty", async () => {
    await render();
    expect(container.textContent).toContain("No words yet");
    expect(container.querySelector("input")).toBeNull();
  });

  it("lays words out alphabetically with senses, links, a deleted article and a dimmed thumb index", async () => {
    mocks.lookups.results = [
      lookup({
        _id: "z",
        word: "zeal",
        wordKey: "zeal",
        sense: "n. eagerness",
      }),
      lookup({
        _id: "e2",
        sense: "v. to stretch",
        sentence: "elastic bands",
        createdAt: new Date(2026, 1, 3).getTime(),
      }),
      lookup({ _id: "e1" }),
      lookup({
        _id: "g",
        word: "ergodic",
        wordKey: "ergodic",
        articleTitle: null,
        articleGone: true,
        sense: "adj. averaged over time",
      }),
    ];
    await render();
    const headwords = [...container.querySelectorAll("h3")].map(
      (h) => h.textContent,
    );
    expect(headwords).toEqual(["elastic", "ergodic", "zeal"]);

    const text = container.textContent ?? "";
    expect(text).toContain("3 words");
    // Two senses of one word are numbered, with the sentence in italic
    expect(text).toContain("able to stretch to meet demand");
    expect(text).toContain("to stretch");
    // The article links to the line; a deleted article keeps its entry without a link
    const link = [...container.querySelectorAll("article a")].find(
      (a) => a.textContent === "On boring infrastructure",
    );
    expect(link?.getAttribute("href")).toBe(
      "/read/art1?quote=the+queue+stays+elastic+under+load&p=4",
    );
    expect(text).toContain("Article no longer in your library");

    const thumb = container.querySelector("nav[aria-label='Jump to a letter']");
    const buttons = [...(thumb?.querySelectorAll("button") ?? [])].map(
      (b) => b.textContent,
    );
    expect(buttons).toEqual(["E", "Z"]);
    expect(thumb?.querySelectorAll("[aria-disabled='true']")).toHaveLength(24);
    // Guide words head each column
    expect(container.querySelector("h2")?.textContent).toContain(
      "elastic — ergodic",
    );
  });

  it("links an entry whose title the server left out, without calling it deleted", async () => {
    mocks.lookups.results = [lookup({ _id: "u", articleTitle: null })];
    await render();
    const link = container.querySelector("article a");
    expect(link?.textContent).toBe("Open article");
    expect(container.textContent).not.toContain("no longer in your library");
  });

  it("jumps to a letter", async () => {
    mocks.lookups.results = [
      lookup({ _id: "a" }),
      lookup({ _id: "z", word: "zeal", wordKey: "zeal" }),
    ];
    await render();
    const scroll = vi.fn();
    const target = document.getElementById("letter-Z");
    expect(target).not.toBeNull();
    (target as HTMLElement).scrollIntoView = scroll;
    const z = [...container.querySelectorAll("nav button")].find(
      (b) => b.textContent === "Z",
    );
    await act(async () => (z as HTMLElement).click());
    expect(scroll).toHaveBeenCalled();
  });

  it("filters by what is typed and says so when nothing matches", async () => {
    mocks.lookups.results = [
      lookup({ _id: "a" }),
      lookup({ _id: "b", word: "épistémique", wordKey: "épistémique" }),
      lookup({ _id: "c", word: "zeal", wordKey: "zeal" }),
    ];
    await render();
    const input = container.querySelector("input") as HTMLInputElement;
    const type = async (value: string) =>
      act(async () => {
        const set = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("epist");
    expect(
      [...container.querySelectorAll("h3")].map((h) => h.textContent),
    ).toEqual(["épistémique"]);
    await type("qq");
    expect(container.textContent).toContain("No word contains “qq”.");
  });

  it("keeps loading older lookups until the cap, then says it stopped", async () => {
    mocks.lookups.results = [lookup({ _id: "a" })];
    mocks.lookups.status = "CanLoadMore";
    await render();
    expect(mocks.lookups.loadMore).toHaveBeenCalledWith(40);
    expect(container.textContent).toContain("loading older words");

    mocks.lookups.loadMore.mockClear();
    mocks.lookups.results = Array.from({ length: 2000 }, (_, i) =>
      lookup({ _id: `w${i}`, word: `w${i}`, wordKey: `w${i}` }),
    );
    await render();
    expect(mocks.lookups.loadMore).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2,000 most recent lookups");
  });
});
