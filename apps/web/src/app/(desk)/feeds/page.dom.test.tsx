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
  feeds: [] as unknown[],
  removeFeed: vi.fn(),
  toggleActive: vi.fn(),
  pollNow: vi.fn(),
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
    if (ref === "feeds.toggleActive") return state.toggleActive;
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
  state.pollNow.mockReset().mockResolvedValue(null);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
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
