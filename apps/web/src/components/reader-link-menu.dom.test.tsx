// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeavingLink } from "@/lib/reader-links";
import { ReaderLinkMenu } from "./reader-link-menu";

const mocks = vi.hoisted(() => ({
  found: undefined as unknown,
  add: vi.fn(),
  save: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.found,
  useMutation: () => mocks.save,
  useAction: () => mocks.add,
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    articles: { findByUrl: "findByUrl" },
    savedArticles: { save: "save" },
    actions: { addArticleByUrl: { add: "add" } },
  },
}));

const HREF = "https://www.example.com/quiet-hours";
let root: Root;
let anchor: HTMLAnchorElement;
let link: LeavingLink;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.found = undefined;
  mocks.add.mockReset();
  mocks.save.mockReset();
  document.body.innerHTML = '<div id="root"></div><a id="link" href="">x</a>';
  anchor = document.getElementById("link") as HTMLAnchorElement;
  anchor.setAttribute("href", HREF);
  anchor.textContent = "the quiet hours essay";
  link = { href: HREF, text: "the quiet hours essay", anchor };
  root = createRoot(document.getElementById("root") as HTMLElement);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const button = (name: RegExp) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    name.test(b.textContent ?? ""),
  ) as HTMLButtonElement;

async function open(onClose = vi.fn()) {
  await act(async () =>
    root.render(<ReaderLinkMenu link={link} onClose={onClose} />),
  );
  return onClose;
}

describe("ReaderLinkMenu", () => {
  it("shows the page title once it is in the library, the domain and the reading time", async () => {
    mocks.found = {
      _id: "a1",
      title: "Quiet hours, properly",
      estimatedReadMinutes: 7,
      saved: false,
    };
    await open();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Quiet hours, properly");
    expect(text).toContain("example.com");
    expect(text).toContain("7 min read");
  });

  it("falls back to the link text when the URL is not in the library", async () => {
    mocks.found = null;
    await open();
    expect(document.body.textContent).toContain("the quiet hours essay");
    expect(document.body.textContent).not.toContain("min read");
  });

  it("saves an article already in the library without importing it", async () => {
    mocks.found = {
      _id: "a1",
      title: "t",
      estimatedReadMinutes: 3,
      saved: false,
    };
    mocks.save.mockResolvedValue("s1");
    await open();
    await act(async () => button(/Save for later/).click());
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith({ articleId: "a1" });
    expect(button(/Saved/).disabled).toBe(true);
  });

  it("imports a new link, then saves it", async () => {
    mocks.found = null;
    mocks.add.mockResolvedValue({ articleId: "a2", alreadyExists: false });
    mocks.save.mockResolvedValue("s2");
    await open();
    await act(async () => button(/Save for later/).click());
    expect(mocks.add).toHaveBeenCalledWith({ url: HREF });
    expect(mocks.save).toHaveBeenCalledWith({ articleId: "a2" });
    expect(mocks.add.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.save.mock.invocationCallOrder[0],
    );
    expect(button(/Saved/)).toBeTruthy();
  });

  it("saves only once when Save is pressed again before the first save settles", async () => {
    mocks.found = null;
    let finish: (id: string) => void = () => {};
    mocks.add.mockResolvedValue({ articleId: "a2", alreadyExists: false });
    mocks.save.mockImplementation(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    await open();
    await act(async () => button(/Save for later/).click());
    await act(async () => button(/Saving/).click());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => finish("s2"));
  });

  it("does not save until the library lookup has answered", async () => {
    await open();
    expect(button(/Save for later/).disabled).toBe(true);
  });

  it("shows the failure in the menu and lets the reader try again", async () => {
    mocks.found = null;
    mocks.add
      .mockRejectedValueOnce(new Error("Could not extract article content."))
      .mockResolvedValueOnce({ articleId: "a3", alreadyExists: false });
    mocks.save.mockResolvedValue("s3");
    await open();
    await act(async () => button(/Save for later/).click());
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      "Could not extract article content.",
    );
    await act(async () => button(/Save for later/).click());
    expect(mocks.save).toHaveBeenCalledWith({ articleId: "a3" });
  });

  it("opens the link in a background tab without navigating this page", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mocks.found = null;
    const onClose = await open();
    await act(async () => button(/Open in background/).click());
    expect(openSpy).toHaveBeenCalledWith(HREF, "_blank", "noopener,noreferrer");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus to the link", async () => {
    mocks.found = null;
    const onClose = await open();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it("closes on an outside press without moving focus", async () => {
    mocks.found = null;
    const onClose = await open();
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(anchor);
  });
});
