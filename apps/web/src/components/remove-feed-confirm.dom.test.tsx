// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoveFeedConfirm } from "./remove-feed-confirm";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  preview: {
    total: 12,
    unread: 9,
    unreadInReader: 0,
    all: 10,
    allInReader: 2,
    partial: false,
  } as unknown,
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.preview,
  useMutation: () => mocks.remove,
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { feeds: { removalPreview: "preview", remove: "remove" } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const feed = { _id: "f1" as never, title: "Example" };
const onClose = vi.fn();
let root: Root;

async function render() {
  await act(async () =>
    root.render(<RemoveFeedConfirm feed={feed} onClose={onClose} />),
  );
}
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  mocks.remove.mockReset().mockResolvedValue(null);
  mocks.preview = {
    total: 12,
    unread: 9,
    unreadInReader: 0,
    all: 10,
    allInReader: 2,
    partial: false,
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("removing a feed", () => {
  it("shows what each choice removes and keeps articles unless told otherwise", async () => {
    await render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("12 articles stay in your library.");
    expect(text).toContain("Removes 9 articles. Anything");
    expect(text).toContain(
      "Removes 10 articles, 2 of them also from Readwise Reader.",
    );

    await act(async () => button("Remove")?.click());
    expect(mocks.remove).toHaveBeenCalledWith({
      feedId: "f1",
      articles: "keep",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("sends the chosen option", async () => {
    await render();
    const all = document.querySelector<HTMLInputElement>("input[value='all']");
    await act(async () => all?.click());
    await act(async () => button("Remove")?.click());
    expect(mocks.remove).toHaveBeenCalledWith({
      feedId: "f1",
      articles: "all",
    });
  });

  it("stays open when the removal fails", async () => {
    mocks.remove.mockRejectedValue(new Error("offline"));
    await render();
    await act(async () => button("Remove")?.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Remove")).toBeDefined();
  });
});
