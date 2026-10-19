// @vitest-environment happy-dom
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { sourceHash } from "@marginalia/backend/prepared-representation";
import { act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generate = vi.fn(async () => undefined);
vi.mock("convex/react", () => ({ useAction: () => generate }));
// Motion's exit and entrance animations don't finish under happy-dom, so the
// test renders the final state straight away.
vi.mock("framer-motion", async () => {
  const { createElement, Fragment } = await import("react");
  const tags = new Map<string, unknown>();
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        if (!tags.has(tag)) {
          tags.set(
            tag,
            ({
              children,
              initial: _initial,
              animate: _animate,
              exit: _exit,
              transition: _transition,
              variants: _variants,
              ...props
            }: Record<string, unknown>) =>
              createElement(tag, props, children as never),
          );
        }
        return tags.get(tag);
      },
    },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: unknown }) =>
      createElement(Fragment, null, children as never),
  };
});
vi.mock("@/lib/shortcuts", () => ({ useCommand: () => undefined }));

const { SummaryPanel } = await import("./summary-panel");
const { IdeaMap } = await import("./idea-map");

const articleId = "article-1" as Id<"articles">;
const summaryWithMap = {
  _id: "summary-1",
  articleId,
  gist: "The gist in plain words.",
  thesis: "Rest helps people think.",
  ideas: [
    {
      id: "a",
      label: "Rest comes first",
      detail: "Premise detail.",
      role: "premise",
      paragraphs: [1],
    },
    {
      id: "b",
      label: "Clear thinking follows",
      detail: "Conclusion detail.",
      role: "conclusion",
      paragraphs: [2],
    },
  ],
  links: [{ from: "a", to: "b", relation: "leads_to" }],
  flow: "Rest leads to thinking.",
  model: "test/model",
} as unknown as Doc<"summaries">;
const summaryWithoutThesis = {
  ...summaryWithMap,
  thesis: undefined,
} as unknown as Doc<"summaries">;

let root: Root;
let container: HTMLElement;
let mount: HTMLElement;

beforeEach(() => {
  generate.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = `<div id="reader"><div data-article-body><p data-para>One.</p><p data-para>Two.</p></div></div>`;
  container = document.getElementById("reader") as HTMLElement;
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const render = (
  summary: Doc<"summaries"> | null,
  id: Id<"articles"> = articleId,
) =>
  act(async () =>
    root.render(
      <SummaryPanel
        articleId={id}
        title="A saved article"
        wordCount={120}
        summary={summary}
        containerRef={{ current: container } as RefObject<HTMLElement>}
        onJump={vi.fn()}
      />,
    ),
  );

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith(name),
  ) as HTMLButtonElement;
const click = (el: HTMLElement) => act(async () => el.click());
const text = () => document.body.textContent ?? "";

describe("SummaryPanel layers", () => {
  it("shows the one point first, then the gist and the map on request", async () => {
    await render(summaryWithMap);
    await click(button("Summary"));
    expect(text()).toContain("The one point");
    expect(text()).toContain("Rest helps people think.");
    expect(text()).not.toContain("The gist in plain words.");
    expect(text()).not.toContain("How the ideas connect");

    await click(button("More"));
    expect(text()).toContain("In short");
    const point = document.querySelector("p.font-serif") as HTMLElement;
    const gist = [...document.querySelectorAll("p")].find(
      (p) => p.textContent === "The gist in plain words.",
    ) as HTMLElement;
    expect(
      point.compareDocumentPosition(gist) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await click(button("The map"));
    expect(text()).toContain("How the ideas connect");
    expect(text()).toContain("How it fits together");
    expect(text()).toContain("Rest comes first");
  });

  it("falls back to the gist and offers a refresh when there is no thesis", async () => {
    await render(summaryWithoutThesis);
    await click(button("Summary"));
    expect(text()).not.toContain("The one point");
    expect(text()).toContain("The gist in plain words.");
    expect(button("More")).toBeUndefined();

    await click(button("Refresh summary"));
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ articleId, title: "A saved article" }),
    );
  });

  it("remembers which layers were opened for the article during the visit", async () => {
    // A fresh article id: layers opened in other tests would otherwise carry over
    const rememberId = "article-remember" as Id<"articles">;
    await render(summaryWithMap, rememberId);
    await click(button("Summary"));
    await click(button("More"));
    await act(async () => root.unmount());
    root = createRoot(mount);
    await render(summaryWithMap, rememberId);
    await click(button("Summary"));
    expect(button("More").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("SummaryPanel open state", () => {
  it("keeps old output usable while a shared generation waits and reports a truthful failure", async () => {
    let reject = (_error: Error) => {};
    generate.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await render(summaryWithMap);
    await click(button("Summary"));
    await click(button("Redo"));
    await act(async () => {
      await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    });
    expect(text()).toContain("Rest helps people think.");
    expect(button("Generating").disabled).toBe(true);
    expect(generate).toHaveBeenCalledWith({
      articleId,
      title: "A saved article",
      paragraphs: ["One.", "Two."],
      sourceHash: await sourceHash(),
      expectedSummaryId: summaryWithMap._id,
    });
    await act(async () =>
      reject(new Error("Summary is still running. Try again to check it.")),
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "still running",
    );
    expect(text()).toContain("Rest helps people think.");
    expect(button("Redo").disabled).toBe(false);
  });

  it("does not expand another article when an old request settles", async () => {
    let resolve = () => {};
    generate.mockImplementationOnce(
      () =>
        new Promise<undefined>((done) => {
          resolve = () => done(undefined);
        }),
    );
    await render(null);
    await click(button("Summary, key"));
    await act(async () => {
      await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    });
    // SAFETY: fabricated opaque ID is used only by this mocked UI fixture.
    await render(summaryWithMap, "other-article" as Id<"articles">);
    await act(async () => resolve());
    expect(button("Summary").getAttribute("aria-expanded")).toBe("false");
    expect(text()).not.toContain("Rest helps people think.");
  });

  it("reports when the body unfolds and folds, so the reader can hide the Ask pill", async () => {
    const onExpandedChange = vi.fn();
    const openId = "article-expanded-report" as Id<"articles">;
    await act(async () =>
      root.render(
        <SummaryPanel
          articleId={openId}
          title="A saved article"
          wordCount={120}
          summary={summaryWithMap}
          containerRef={{ current: container } as RefObject<HTMLElement>}
          onJump={vi.fn()}
          onExpandedChange={onExpandedChange}
        />,
      ),
    );
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);

    await click(button("Summary"));
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    await click(button("Summary"));
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });
});

describe("IdeaMap", () => {
  it("jumps to a paragraph from an idea's detail", async () => {
    const onJump = vi.fn();
    act(() => {
      root.render(
        <IdeaMap
          ideas={summaryWithMap.ideas as never}
          links={summaryWithMap.links as never}
          onJump={onJump}
        />,
      );
    });
    await click(
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Clear thinking follows"),
      ) as HTMLButtonElement,
    );
    await click(button("¶2"));
    expect(onJump).toHaveBeenCalledWith(1);
  });
});
