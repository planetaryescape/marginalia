// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WASH_MS } from "@/lib/use-timed-flag";
import FeedsPage from "./page";

const state = vi.hoisted(() => ({
  readwise: null as unknown,
  pollStatus: null as null | {
    run: number;
    active: boolean;
    processed: number;
    total: number | null;
    deadline: number;
  },
  feeds: [] as unknown[],
  suggestions: [] as unknown[],
  removeFeed: vi.fn(),
  keepFeed: vi.fn(),
  toggleActive: vi.fn(),
  pollNow: vi.fn(),
  addBatch: vi.fn(),
}));

vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: new Proxy(
    {},
    {
      get: (_, ns) =>
        new Proxy({}, { get: (_t, fn) => `${String(ns)}.${String(fn)}` }),
    },
  ),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    if (ref === "readwise.status") return state.readwise;
    if (ref === "feeds.list") return state.feeds;
    if (ref === "feedPolling.status") return state.pollStatus;
    if (ref === "feedSuggestions.list") return state.suggestions;
    if (ref === "feeds.removalPreview")
      return {
        total: 3,
        unread: 2,
        unreadInReader: 0,
        all: 3,
        allInReader: 0,
        partial: false,
      };
    if (ref === "apiTokens.list") return [];
    return undefined;
  },
  useAction: () => state.pollNow,
  useMutation: (ref: unknown) => {
    if (ref === "feeds.remove") return state.removeFeed;
    if (ref === "feedSuggestions.keep") return state.keepFeed;
    if (ref === "feeds.toggleActive") return state.toggleActive;
    if (ref === "feeds.addBatch") return state.addBatch;
    return vi.fn().mockResolvedValue(null);
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const connectedReadwise = {
  connected: true,
  source: "saved",
  last4: "abcd",
  syncedAt: Date.now() - 12 * 60_000,
  checkedAt: null,
  error: null,
  progress: null,
  pendingAnnotations: null,
};

const feed = (id: string, title: string) => ({
  _id: id,
  title,
  url: `https://${title}.example/feed.xml`,
  isActive: true,
  lastFetchedAt: null,
  lastError: null,
});

describe("Sources page", () => {
  beforeEach(() => {
    state.readwise = connectedReadwise;
    state.feeds = [];
  });

  it("orders Readwise, then Feeds, then sending from other apps", () => {
    const html = renderToStaticMarkup(<FeedsPage />);
    const at = (text: string) => html.indexOf(text);
    expect(at("Readwise Reader")).toBeGreaterThan(-1);
    expect(at("Readwise Reader")).toBeLessThan(at(">Feeds</h2>"));
    expect(at(">Feeds</h2>")).toBeLessThan(at("Sending from other apps"));
    expect(html).toContain("Check now");
    expect(html).not.toContain("Poll now");
    expect(html).not.toContain("Connected apps");
  });

  it("shows a failing Readwise sync as its sentence with Try again", () => {
    state.readwise = {
      ...connectedReadwise,
      checkedAt: Date.now() - 12 * 60_000,
      error: "Readwise didn't respond.",
    };
    const html = renderToStaticMarkup(<FeedsPage />);
    expect(html).toContain("Last sync failed 12 min ago");
    expect(html).toContain("Readwise didn&#x27;t respond.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Sync now");
  });
});

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  state.feeds = [feed("f1", "alpha"), feed("f2", "beta")];
  state.removeFeed.mockReset().mockResolvedValue(null);
  state.toggleActive.mockReset().mockResolvedValue(null);
  state.pollStatus = null;
  state.pollNow.mockReset().mockResolvedValue(null);
  state.addBatch
    .mockReset()
    .mockImplementation(async ({ entries }: { entries: { url: string }[] }) =>
      entries.map((entry) => ({ url: entry.url, status: "created" })),
    );
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  state.keepFeed.mockReset().mockResolvedValue(null);
  state.suggestions = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name);

describe("removing a feed in place", () => {
  it("confirms under the row, Keep cancels and Remove calls the mutation", async () => {
    await act(async () => root.render(<FeedsPage />));
    const removeAlpha = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove alpha"]',
    );
    await act(async () => removeAlpha?.click());
    expect(document.body.textContent).toContain("Remove this feed?");

    await act(async () => button("Keep")?.click());
    expect(document.body.textContent).not.toContain("Remove this feed?");
    expect(state.removeFeed).not.toHaveBeenCalled();

    await act(async () => removeAlpha?.click());
    // The confirm's Remove sits beside its Keep, not the row's own Remove
    const confirmRemove = [
      ...(button("Keep")?.parentElement?.querySelectorAll("button") ?? []),
    ].find((b) => b.textContent === "Remove");
    await act(async () => confirmRemove?.click());
    expect(state.removeFeed).toHaveBeenCalledWith({
      feedId: "f1",
      articles: "keep",
    });
  });

  it("closes the open confirm when another row is touched", async () => {
    await act(async () => root.render(<FeedsPage />));
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Remove alpha"]')
        ?.click(),
    );
    expect(document.body.textContent).toContain("Remove this feed?");

    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Pause beta"]')
        ?.click(),
    );
    expect(document.body.textContent).not.toContain("Remove this feed?");
  });
});

describe("checking feeds in place", () => {
  it("immediately hides an old error and keeps progress visible until the acknowledged run arrives", async () => {
    state.feeds = [{ ...feed("f1", "alpha"), lastError: "Feed returned 503" }];
    let finishRequest = (_run: number) => {};
    state.pollNow.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finishRequest = resolve;
        }),
    );
    await act(async () => root.render(<FeedsPage />));
    expect(document.body.textContent).toContain("Feed returned 503");
    await act(async () => button("Check now")?.click());
    expect(document.body.textContent).not.toContain("Feed returned 503");
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull();

    await act(async () => finishRequest(1));
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Feed returned 503");
    state.pollStatus = {
      run: 1,
      active: true,
      processed: 0,
      total: null,
      deadline: Date.now() + 900_000,
    };
    await act(async () => root.render(<FeedsPage />));
    expect(document.body.textContent).toContain("Waiting to check");
    expect(document.body.textContent).not.toContain("Feed returned 503");

    state.feeds = [
      { ...feed("f1", "alpha"), checkRun: 1, checkingSince: Date.now() },
    ];
    await act(async () => root.render(<FeedsPage />));
    expect(
      document.querySelector('[aria-label="Checking alpha"]'),
    ).not.toBeNull();
    // An identical message from this attempt is still a NEW error.
    state.feeds = [
      { ...feed("f1", "alpha"), checkRun: 1, lastError: "Feed returned 503" },
    ];
    state.pollStatus = {
      ...state.pollStatus,
      active: false,
      processed: 1,
      total: 1,
    };
    await act(async () => root.render(<FeedsPage />));
    expect(document.body.textContent).toContain("Feed returned 503");
    expect(document.body.textContent).toContain("Check complete");
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("uses determinate progress only for a real total and restores it after reload", async () => {
    state.pollStatus = {
      run: 4,
      active: true,
      processed: 2,
      total: null,
      deadline: Date.now() + 900_000,
    };
    await act(async () => root.render(<FeedsPage />));
    let bar = document.querySelector('[aria-label="Checking feeds"]');
    expect(bar).not.toBeNull();
    expect(bar?.hasAttribute("aria-valuenow")).toBe(false);
    state.pollStatus = { ...state.pollStatus, processed: 3, total: 6 };
    await act(async () => root.render(<FeedsPage />));
    bar = document.querySelector('[aria-label="Checking feeds"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("50");
    expect(document.body.textContent).toContain("3 of 6 sources processed");
  });

  it("a changed feed takes the 600 ms wash, with no toast", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => root.render(<FeedsPage />));
      await act(async () => button("Check now")?.click());
      expect(toast.success).not.toHaveBeenCalled();
      const rows = () =>
        [...document.querySelectorAll(".change-wash")] as HTMLElement[];
      expect(rows().some((r) => r.dataset.washing)).toBe(false);

      // The check updated alpha only
      state.feeds = [
        { ...feed("f1", "alpha"), lastFetchedAt: Date.now() },
        feed("f2", "beta"),
      ];
      await act(async () => root.render(<FeedsPage />));
      expect(rows().map((r) => Boolean(r.dataset.washing))).toEqual([
        true,
        false,
      ]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WASH_MS + 1);
      });
      expect(rows().some((r) => r.dataset.washing)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed check says so beside the controls with Retry, not in a toast", async () => {
    state.pollNow.mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(<FeedsPage />));
    await act(async () => button("Check now")?.click());
    expect(document.querySelector(".inline-error")?.textContent).toContain(
      "Couldn't check your feeds.",
    );
    expect(toast.error).not.toHaveBeenCalled();
    await act(async () => button("Retry")?.click());
    expect(state.pollNow).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".inline-error")).toBeNull();
  });
});

describe("a feed the reader almost never opens", () => {
  beforeEach(() => {
    state.suggestions = [{ feedId: "f2", offered: 40, opened: 1 }];
  });

  it("asks once, in a sentence under that feed only, and does nothing yet", async () => {
    await act(async () => root.render(<FeedsPage />));
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "You've opened 1 of the 40 from this feed. Unsubscribe?",
    );
    expect(text.match(/from this feed/g)).toHaveLength(1);
    const betaRow = [...document.querySelectorAll("p")]
      .find((p) => p.textContent === "beta")
      ?.closest("div[class*='group']")?.parentElement;
    expect(betaRow?.textContent).toContain("from this feed");
    expect(state.removeFeed).not.toHaveBeenCalled();
    expect(state.keepFeed).not.toHaveBeenCalled();
  });

  it("Unsubscribe removes the feed through the usual path, keeping its articles", async () => {
    await act(async () => root.render(<FeedsPage />));
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Unsubscribe from beta"]',
        )
        ?.click(),
    );
    expect(state.removeFeed).toHaveBeenCalledWith({
      feedId: "f2",
      articles: "keep",
    });
    expect(state.keepFeed).not.toHaveBeenCalled();
  });

  it("Keep silences the suggestion without removing anything", async () => {
    await act(async () => root.render(<FeedsPage />));
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Keep beta"]')
        ?.click(),
    );
    expect(state.keepFeed).toHaveBeenCalledWith({ feedId: "f2" });
    expect(state.removeFeed).not.toHaveBeenCalled();
  });

  it("shows nothing for a feed without a suggestion", async () => {
    state.suggestions = [];
    await act(async () => root.render(<FeedsPage />));
    expect(document.body.textContent).not.toContain("from this feed");
  });
});

describe("dropping an OPML file on the page", () => {
  const OPML = `<opml><body><outline text="One" xmlUrl="https://one.example/feed.xml"/></body></opml>`;
  const drag = (type: string, files: File[]) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["Files"], files },
    });
    act(() => {
      window.dispatchEvent(event);
    });
  };

  it("shows a calm target while a file is dragged over", async () => {
    await act(async () => root.render(<FeedsPage />));
    expect(document.body.textContent).not.toContain(
      "Drop to import your feeds",
    );
    drag("dragenter", [new File([OPML], "feeds.opml")]);
    expect(document.body.textContent).toContain("Drop to import your feeds");
  });

  it("imports the dropped file through the same path as the link", async () => {
    await act(async () => root.render(<FeedsPage />));
    const file = new File([OPML], "feeds.opml");
    drag("dragenter", [file]);
    await act(async () => {
      drag("drop", [file]);
    });
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Imported 1 feeds"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(
      "Drop to import your feeds",
    );
  });

  it("imports 25 outlines with three acknowledgements and shows duplicate/invalid entry feedback", async () => {
    state.addBatch.mockImplementation(
      async ({ entries }: { entries: { url: string }[] }) =>
        entries.map((entry) => ({
          url: entry.url,
          status: entry.url.includes("feed12")
            ? "duplicate"
            : entry.url.includes("feed22")
              ? "invalid"
              : "created",
          message: "Invalid feed URL",
        })),
    );
    const opml = `<opml><body>${Array.from({ length: 25 }, (_, n) => `<outline xmlUrl="https://feed${n}.example/rss" text="Feed ${n}"/>`).join("")}</body></opml>`;
    await act(async () => root.render(<FeedsPage />));
    await act(async () => {
      drag("drop", [new File([opml], "feeds.opml")]);
    });
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "Imported 23 feeds; 1 already added; 1 invalid",
      ),
    );
    expect(
      state.addBatch.mock.calls.map(([args]) => args.entries.length),
    ).toEqual([10, 10, 5]);
    expect(document.querySelector("details")?.textContent).toContain(
      "https://feed12.example/rss: Already added",
    );
    expect(document.querySelector("details")?.textContent).toContain(
      "https://feed22.example/rss: Invalid feed URL",
    );
  });

  it("keeps acknowledged progress on failure and retries only the remaining batch", async () => {
    const opml = `<opml><body>${Array.from({ length: 11 }, (_, n) => `<outline xmlUrl="https://feed${n}.example/rss"/>`).join("")}</body></opml>`;
    state.addBatch
      .mockImplementationOnce(
        async ({ entries }: { entries: { url: string }[] }) =>
          entries.map((entry) => ({ url: entry.url, status: "created" })),
      )
      .mockRejectedValueOnce(new Error("Connection interrupted"));
    await act(async () => root.render(<FeedsPage />));
    await act(async () => {
      drag("drop", [new File([opml], "feeds.opml")]);
    });
    await vi.waitFor(() =>
      expect(document.querySelector(".inline-error")?.textContent).toContain(
        "Connection interrupted",
      ),
    );
    await act(async () => button("Retry")?.click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Imported 11 feeds"),
    );
    expect(
      state.addBatch.mock.calls.map(([args]) => args.entries[0].url),
    ).toEqual([
      "https://feed0.example/rss",
      "https://feed10.example/rss",
      "https://feed10.example/rss",
    ]);
  });

  it("a feed added says so beside Add, not in a toast", async () => {
    await act(async () => root.render(<FeedsPage />));
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Feed URL"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setValue?.call(input, "https://one.example/feed.xml");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Add")?.click());
    await vi.waitFor(() => expect(input?.form?.textContent).toContain("Added"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("refuses a file that is not OPML in one sentence", async () => {
    await act(async () => root.render(<FeedsPage />));
    const png = new File(["x"], "a.png", { type: "image/png" });
    await act(async () => {
      drag("drop", [png]);
    });
    expect(document.querySelector(".inline-error")?.textContent).toBe(
      "Marginalia imports OPML files, which end in .opml or .xml.",
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a failed Pause says so under that feed with Retry, not in a toast", async () => {
    state.toggleActive.mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(<FeedsPage />));
    await act(async () => button("Pause")?.click());
    expect(document.querySelector(".inline-error")?.textContent).toContain(
      "Couldn't update the feed.",
    );
    expect(toast.error).not.toHaveBeenCalled();
    await act(async () => button("Retry")?.click());
    expect(state.toggleActive).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".inline-error")).toBeNull();
  });
});
