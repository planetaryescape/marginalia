// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleFinder } from "./article-finder";

const push = vi.hoisted(() => vi.fn());
const addByUrl = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const record = vi.hoisted(() => vi.fn());
const noteHits = vi.hoisted(() => ({ current: [] as unknown[] }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: Record<string, never>) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("convex/react", () => ({
  useAction: () => addByUrl,
  useQuery: (_fn: string, args: unknown) =>
    args === "skip" ? undefined : noteHits.current,
  useMutation: (fn: string) => (fn === "record" ? record : save),
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    actions: { addArticleByUrl: { add: "add" } },
    savedArticles: { save: "save" },
    sessions: { recordInteraction: "record" },
    notesSearch: { find: "notes" },
  },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/shortcuts", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/shortcuts")>()),
  useShortcuts: vi.fn(),
  useCommand: vi.fn(),
}));
vi.mock("@/lib/use-modal-dialog", () => ({ useModalDialog: vi.fn() }));

interface Pending {
  path: string;
  signal: AbortSignal;
  resolve: (body: unknown, status?: number) => void;
}
let root: Root;
let host: HTMLElement;
let requests: Pending[];

const find = (
  id: string,
  title: string,
  minutes: number | null,
  extra = {},
) => ({
  articleId: id,
  title,
  author: null,
  source: "example.com",
  minutes,
  status: "Up next",
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  push.mockReset();
  noteHits.current = [];
  addByUrl.mockReset();
  save.mockReset();
  record.mockReset();
  record.mockResolvedValue(undefined);
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal(
    "fetch",
    (url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
        requests.push({
          path: url.replace("/api/reader/library/", ""),
          signal,
          resolve: (body, status = 200) =>
            resolve(
              new Response(JSON.stringify(body), {
                status,
                headers: { "Content-Type": "application/json" },
              }),
            ),
        });
      }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function show(props: Parameters<typeof ArticleFinder>[0] = {}) {
  await act(async () => root.render(<ArticleFinder {...props} />));
  await act(async () => {
    host.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.click();
  });
}

async function type(text: string) {
  const input = host.querySelector("input") as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle(ms = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function answer(path: string, body: unknown, status = 200) {
  const request = requests.findLast(
    (r) => r.path === path && !r.signal.aborted,
  );
  if (!request) throw new Error(`No pending ${path} request`);
  await act(async () => {
    request.resolve(body, status);
    await vi.advanceTimersByTimeAsync(0);
  });
}

const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`No ${label} button`);
  await act(async () => button.click());
};
const title = () => host.querySelector("h3")?.textContent;
const key = async (name: string) => {
  const input = host.querySelector("input") as HTMLInputElement;
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
};

describe("topic picker", () => {
  it("shows the first card from the fast result, then fills the reason into the same card", async () => {
    await show();
    await type("attention");
    await settle();
    expect(requests.map((r) => r.path)).toEqual(["find"]);

    await answer("find", {
      more: false,
      matches: [find("a1", "The quiet cost of interruptions", 7)],
    });
    const heading = host.querySelector("h3");
    expect(title()).toBe("The quiet cost of interruptions");
    expect(host.textContent).toContain("example.com · 7 min");
    expect(host.textContent).toContain("1 of 1");
    // The reason is still being written; the explained path is now asked.
    expect(host.querySelector(".animate-pulse")).not.toBeNull();
    expect(requests.map((r) => r.path)).toEqual(["find", "search"]);

    await answer("search", {
      matches: [
        {
          articleId: "a1",
          title: "The quiet cost of interruptions",
          author: null,
          minutes: 7,
          status: "Up next",
          reason: "Connects to your notes on deep work.",
        },
      ],
    });
    expect(host.textContent).toContain("Connects to your notes on deep work.");
    expect(host.querySelector(".animate-pulse")).toBeNull();
    expect(host.querySelector("h3")).toBe(heading);
  });

  it("attaches a reason to its own card even when the explanation ranks differently", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", {
      more: false,
      matches: [find("a1", "First", 5), find("b2", "Second", 6)],
    });
    await answer("search", {
      matches: [
        {
          articleId: "b2",
          title: "Second",
          author: null,
          minutes: 6,
          status: "Up next",
          reason: "Reason for second.",
        },
        {
          articleId: "zz",
          title: "Unshown",
          author: null,
          minutes: 6,
          status: "Up next",
          reason: "Not on a card.",
        },
      ],
    });
    expect(title()).toBe("First");
    expect(host.textContent).not.toContain("Reason for second.");
    expect(host.textContent).not.toContain("Not on a card.");
    await click("Another");
    expect(title()).toBe("Second");
    expect(host.textContent).toContain("Reason for second.");
  });

  it("drops an explanation that arrives after the query changed", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", {
      more: false,
      matches: [find("a1", "Attention piece", 5)],
    });
    const staleSearch = requests.find((r) => r.path === "search");
    await type("sleep");
    expect(staleSearch?.signal.aborted).toBe(true);
    await settle();
    await answer("find", {
      more: false,
      matches: [find("s1", "Sleep piece", 8)],
    });
    expect(title()).toBe("Sleep piece");
    // A late answer from the first query can't land anywhere.
    await act(async () =>
      staleSearch?.resolve({
        matches: [
          {
            articleId: "a1",
            title: "x",
            author: null,
            minutes: 5,
            status: "Up next",
            reason: "Old reason.",
          },
        ],
      }),
    );
    expect(host.textContent).not.toContain("Old reason.");
  });

  it("cancels the pending request when the query changes and never shows its result", async () => {
    await show();
    await type("attention");
    await settle();
    const first = requests[0];
    await type("attention span");
    expect(first.signal.aborted).toBe(true);
    await settle();
    await answer("find", { more: false, matches: [find("n1", "Newer", 4)] });
    expect(title()).toBe("Newer");
  });

  it("waits only the short debounce before searching", async () => {
    await show();
    await type("cows");
    await settle(200);
    expect(requests).toHaveLength(0);
    await settle(60);
    expect(requests.map((r) => r.path)).toEqual(["find"]);
  });

  it("goes through matches one at a time, append-only, with duplicates skipped", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", {
      more: true,
      matches: [
        find("a", "Alpha", 3),
        find("b", "Beta", 4),
        find("b", "Beta", 4),
        find("c", "Gamma", 5),
      ],
    });
    expect(host.textContent).toContain("1 of 3+");
    expect(host.querySelectorAll("h3")).toHaveLength(1);
    await click("Another");
    await click("Another");
    expect(title()).toBe("Gamma");
    expect(host.textContent).toContain("3 of 3+");
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Another",
      ),
    ).toBe(false);
    await key("ArrowUp");
    expect(title()).toBe("Beta");
  });

  it("does not claim a total once every match has been returned", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", {
      more: false,
      matches: [find("a", "Alpha", 3), find("b", "Beta", 4)],
    });
    expect(host.textContent).toContain("1 of 2");
    expect(host.textContent).not.toContain("1 of 2+");
  });

  it("opens the article on Read now, Enter and the keyboard", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", {
      more: false,
      matches: [find("a", "Alpha", 3), find("b", "Beta", 4)],
    });
    await key("ArrowDown");
    expect(title()).toBe("Beta");
    await act(async () => {
      host
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(push).toHaveBeenCalledWith("/read/b");
  });

  describe("keyboard", () => {
    const matches = [
      find("a", "Alpha", 3),
      find("b", "Beta", 4),
      find("c", "Gamma", 5),
    ];
    const results = async () => {
      await show();
      await type("attention");
      await settle();
      await answer("find", { more: false, matches });
    };
    const press = async (name: string, target: Element) => {
      await act(async () => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: name,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    };
    const readButton = () =>
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Read now",
      ) as HTMLButtonElement;

    it("marks the highlighted result as the input's active descendant", async () => {
      await results();
      const input = host.querySelector("input") as HTMLInputElement;
      const option = host.querySelector('[role="option"]') as HTMLElement;
      expect(input.getAttribute("role")).toBe("combobox");
      expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
      expect(
        host
          .querySelector('[role="listbox"]')
          ?.contains(host.querySelector("h3")),
      ).toBe(true);
      await key("ArrowDown");
      expect(option.textContent).toContain("Beta");
      expect(input.getAttribute("aria-activedescendant")).toBe(
        host.querySelector('[role="option"]')?.id,
      );
    });

    it("moves with the arrows while typing, and j k s do not steal letters from the input", async () => {
      await results();
      const input = host.querySelector("input") as HTMLInputElement;
      await press("j", input);
      await press("s", input);
      expect(title()).toBe("Alpha");
      expect(save).not.toHaveBeenCalled();
      await press("ArrowDown", input);
      expect(title()).toBe("Beta");
    });

    describe("in your notes", () => {
      const hits = [
        {
          kind: "note",
          id: "n1",
          articleId: "z",
          articleTitle: "Zeta",
          text: "My thought on attention",
          quote: "the quoted line",
          unitIndex: undefined,
          paragraphIndex: undefined,
        },
        {
          kind: "highlight",
          id: "h1",
          articleId: "y",
          articleTitle: "Yotta",
          text: "attention is scarce",
          quote: "attention is scarce",
          paragraphIndex: 3,
          unitIndex: undefined,
        },
      ];
      const options = () => [
        ...host.querySelectorAll<HTMLElement>(
          '[role="listbox"] a[role="option"]',
        ),
      ];

      it("lists notes and highlights after the cards and links to the line", async () => {
        noteHits.current = hits;
        await results();
        await settle();
        const links = options().map((o) => o.getAttribute("href"));
        expect(links).toEqual([
          "/read/z?quote=the+quoted+line&note=n1",
          "/read/y?quote=attention+is+scarce&p=3",
        ]);
        expect(host.textContent).toContain("In your notes");
      });

      it("joins the arrow keys once the cards run out, and Enter opens the note", async () => {
        noteHits.current = hits;
        await results();
        await settle();
        const input = host.querySelector("input") as HTMLInputElement;
        await key("ArrowDown");
        await key("ArrowDown");
        expect(title()).toBe("Gamma");
        expect(
          options().every((o) => o.getAttribute("aria-selected") === "false"),
        ).toBe(true);
        await key("ArrowDown");
        expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
        expect(input.getAttribute("aria-activedescendant")).toBe(
          options()[0]?.id,
        );
        await key("ArrowDown");
        await key("ArrowDown");
        expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
        await key("ArrowUp");
        await act(async () => {
          host
            .querySelector("form")
            ?.dispatchEvent(
              new Event("submit", { bubbles: true, cancelable: true }),
            );
        });
        expect(push).toHaveBeenCalledWith(
          "/read/z?quote=the+quoted+line&note=n1",
        );
      });

      it("arrow up from the first note returns to the last card", async () => {
        noteHits.current = hits;
        await results();
        await settle();
        for (let i = 0; i < 3; i++) await key("ArrowDown");
        await key("ArrowUp");
        expect(
          options().every((o) => o.getAttribute("aria-selected") === "false"),
        ).toBe(true);
        expect(title()).toBe("Gamma");
      });
    });

    it("j, k, s and Enter work once focus leaves the input", async () => {
      await results();
      const button = readButton();
      await press("j", button);
      expect(title()).toBe("Beta");
      await press("k", button);
      expect(title()).toBe("Alpha");
      save.mockResolvedValue(undefined);
      await press("s", button);
      expect(save).toHaveBeenCalledWith({ articleId: "a" });
      // Enter on a button is the button's own; on the dialog it reads
      await press("Enter", button);
      expect(push).not.toHaveBeenCalled();
      await press("Enter", host.querySelector("dialog") as HTMLElement);
      expect(push).toHaveBeenCalledWith("/read/a");
    });
  });

  it("closes on Escape", async () => {
    await show();
    const dialog = host.querySelector("dialog") as HTMLDialogElement;
    expect(
      host
        .querySelector("button[aria-haspopup]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    await act(async () => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(
      host
        .querySelector("button[aria-haspopup]")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("records an offer when a card is shown, once per article however it re-renders or returns", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", {
      more: false,
      matches: [find("a", "Alpha", 3), find("b", "Beta", 4)],
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      articleId: "a",
      action: "presented",
    });
    await click("Another");
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith({
      articleId: "b",
      action: "presented",
    });
    await key("ArrowUp");
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("records the offer again each time the finder is opened", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", { more: false, matches: [find("a", "Alpha", 3)] });
    await answer("search", {
      matches: [find("a", "Alpha", 3, { reason: "Fits" })],
    });
    expect(record).toHaveBeenCalledTimes(1);
    await act(async () => {
      host
        .querySelector("dialog")
        ?.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.click();
    });
    await settle();
    expect(host.textContent).toContain("Alpha");
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("saves the shown article for later", async () => {
    save.mockResolvedValue("saved-id");
    await show();
    await type("attention");
    await settle();
    await answer("find", { more: false, matches: [find("a", "Alpha", 3)] });
    await click("Save for later");
    expect(save).toHaveBeenCalledWith({ articleId: "a" });
    // Saved shows in place of the action; no toast
    expect(toast.success).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Saved");
  });

  it("a failed save says so in place with Retry", async () => {
    save.mockRejectedValueOnce(new Error("socket hang up"));
    await show();
    await type("attention");
    await settle();
    await answer("find", { more: false, matches: [find("a", "Alpha", 3)] });
    await click("Save for later");
    // A transport error gets the shared sentence, not its raw message
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't save. Try again.",
    );
    expect(toast.error).not.toHaveBeenCalled();
    save.mockResolvedValue("saved-id");
    await click("Retry");
    expect(save).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("Saved");
  });

  it("offers only what fits a chosen time, and clearing the chip lifts the limit", async () => {
    const cleared = vi.fn();
    await show({ windowMinutes: 10, onClearWindow: cleared });
    await type("attention");
    await settle();
    await answer("find", {
      more: false,
      matches: [
        find("a", "Long", 25),
        find("b", "Short", 7),
        find("c", "Medium", 9),
      ],
    });
    expect(host.textContent).toContain("within 10 min ×");
    expect(title()).toBe("Short");
    expect(host.textContent).toContain("1 of 2");
    await click("within 10 min ×");
    expect(cleared).toHaveBeenCalled();
    expect(host.textContent).not.toContain("within 10 min");
    expect(host.textContent).toContain("of 3");
  });

  it("says nothing fits and offers the shortest as a choice", async () => {
    await show({ windowMinutes: 5 });
    await type("attention");
    await settle();
    await answer("find", {
      more: false,
      matches: [
        find("a", "Long", 25),
        find("b", "Shortest", 7),
        find("c", "Unknown", null),
      ],
    });
    expect(host.textContent).toContain(
      "Nothing on attention fits in 5 minutes.",
    );
    expect(host.textContent).toContain("The shortest is 7 min");
    expect(host.querySelector("h3")).toBeNull();
    await click("Read it anyway");
    expect(push).toHaveBeenCalledWith("/read/b");
  });

  it("shows a card, not the empty message, when a match fits", async () => {
    await show({ windowMinutes: 30 });
    await type("attention");
    await settle();
    await answer("find", { more: false, matches: [find("a", "Long", 25)] });
    expect(host.textContent).not.toContain("Nothing on attention fits");
    expect(title()).toBe("Long");
  });

  it("clears the time from the nothing-fits state", async () => {
    await show({ windowMinutes: 5 });
    await type("attention");
    await settle();
    await answer("find", { more: false, matches: [find("b", "Shortest", 7)] });
    await click("Clear the time");
    expect(title()).toBe("Shortest");
  });

  it("falls back to the explained search when the backend has no fast path", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", "Not Found", 404);
    expect(requests.map((r) => r.path)).toEqual(["find", "search"]);
    await answer("search", {
      matches: [
        {
          articleId: "a",
          title: "Alpha",
          author: "Ann",
          minutes: 6,
          status: "Up next",
          reason: "It fits.",
        },
      ],
    });
    expect(title()).toBe("Alpha");
    expect(host.textContent).toContain("Ann · 6 min");
    expect(host.textContent).toContain("It fits.");
  });

  it("keeps the card when the explanation fails", async () => {
    await show();
    await type("attention");
    await settle();
    await answer("find", { more: false, matches: [find("a", "Alpha", 3)] });
    await answer(
      "search",
      { error: "Couldn't search your library. Try again." },
      502,
    );
    expect(title()).toBe("Alpha");
    expect(host.querySelector(".animate-pulse")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows a retry when the fast search fails", async () => {
    await show();
    await type("attention");
    await settle();
    await answer(
      "find",
      { error: "Couldn't search your library. Try again." },
      502,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Try again",
    );
    await click("Try again");
    await settle();
    expect(requests.filter((r) => r.path === "find")).toHaveLength(2);
  });

  it("points at Library with the query for every match", async () => {
    await show();
    await type("deep work");
    await settle();
    await answer("find", { more: false, matches: [find("a", "Alpha", 3)] });
    expect(
      host.querySelector('a[href="/library?q=deep%20work"]'),
    ).not.toBeNull();
  });

  it("searches a one-word topic and treats spaces in a would-be link as a topic", async () => {
    await show();
    await type("https://example.com/a b");
    await settle();
    expect(requests.map((r) => r.path)).toEqual(["find"]);
  });

  describe("a pasted link", () => {
    it("saves and reads it as before", async () => {
      addByUrl.mockResolvedValue({ articleId: "n1", alreadyExists: false });
      await show();
      await type("www.example.com/essay");
      await settle();
      expect(requests).toHaveLength(0);
      await click("Save and read");
      expect(addByUrl).toHaveBeenCalledWith({
        url: "https://www.example.com/essay",
      });
      expect(push).toHaveBeenCalledWith("/read/n1");
    });

    it("saves it for later without opening it", async () => {
      addByUrl.mockResolvedValue({ articleId: "n1", alreadyExists: false });
      save.mockResolvedValue("s");
      await show();
      await type("https://example.com/essay");
      await click("Save for later");
      expect(save).toHaveBeenCalledWith({ articleId: "n1" });
      expect(push).not.toHaveBeenCalled();
    });
  });
});
