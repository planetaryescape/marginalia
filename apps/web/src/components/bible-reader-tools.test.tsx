// @vitest-environment happy-dom
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BibleAttribution,
  BibleChapterNavigation,
  BibleReaderTools,
} from "./bible-reader-tools";

const action = vi.hoisted(() => vi.fn().mockResolvedValue("next-article"));
const push = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({
  useAction: () => action,
  useMutation: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./bible-browser", () => ({
  BibleBrowser: () => (
    <details>
      <summary>Browse the Bible</summary>
    </details>
  ),
}));
vi.mock("./bible-word-study", () => ({
  BibleWordStudy: ({ selectedText }: { selectedText?: string }) => (
    <details>
      <summary>Word study</summary>
      <p>{selectedText}</p>
    </details>
  ),
}));
const bible = {
  reference: "Psalms 23",
  translation: "web",
  displayVersionId: 111,
  copyright: "Publisher copyright notice",
};
// Synthetic IDs stay within the mocked Convex boundary.
const articleId = "bible-tools-fixture" as ComponentProps<
  typeof BibleReaderTools
>["articleId"];
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  action.mockClear();
  push.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps Bible tools in a closed toolbar popover, with comparison explicitly opt-in", async () => {
  const compare = vi.fn();
  const display: NonNullable<
    ComponentProps<typeof BibleReaderTools>["display"]
  > = {
    article: undefined,
    source: undefined,
    comparing: false,
    setComparing: compare,
    otherVersion: 2692,
    setOtherVersion: vi.fn(),
    primaryId: 111,
    primary: undefined,
    comparison: undefined,
    anchors: [],
    fontCss: undefined,
    error: "",
    retry: vi.fn(),
  };
  await act(async () =>
    root.render(
      <BibleReaderTools
        bible={bible}
        articleId={articleId}
        annotationStatus="annotated"
        display={display}
        onWordStudy={() => {}}
      />,
    ),
  );
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Bible tools"]',
  )!;
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(
    document
      .querySelector('button[aria-label="Compare versions"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
  expect(document.body.textContent).not.toContain("Publisher copyright notice");
  expect(action).not.toHaveBeenCalled();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Compare versions"]')
      ?.click(),
  );
  expect(compare).toHaveBeenCalledWith(true);
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("uses named icon-only chapter chevrons and preserves the chosen edition", async () => {
  await act(async () =>
    root.render(
      <BibleChapterNavigation bible={bible}>
        <h1>Psalms 23</h1>
      </BibleChapterNavigation>,
    ),
  );
  const next = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Next chapter"]',
  )!;
  expect(next.textContent).toBe("");
  expect(next.querySelector("svg")).not.toBeNull();
  await act(async () => next.click());
  expect(action).toHaveBeenCalledWith({
    reference: "Psalms 24",
    translation: "web",
    versionId: 111,
  });
  expect(push).toHaveBeenCalledWith("/read/next-article");
});

it("hands word study to the reader surface and closes its covering tools popover", async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      <BibleReaderTools
        bible={bible}
        articleId={articleId}
        annotationStatus="annotated"
        onWordStudy={open}
      />,
    ),
  );
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Bible tools"]')
      ?.click(),
  );
  const words = Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Original-language word study"),
  );
  await act(async () => words?.click());
  expect(open).toHaveBeenCalledWith("Psalms 23");
  expect(
    document
      .querySelector('button[aria-label="Bible tools"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("false");
});

it("renders the source disclosure as fine print after the passage rather than ahead of it", async () => {
  await act(async () =>
    root.render(
      <article>
        <header>
          <h1>Psalms 23</h1>
        </header>
        <div data-article-body>The Lord is my shepherd.</div>
        <BibleAttribution bible={bible} />
      </article>,
    ),
  );
  const source = document.querySelector('section[aria-label="Bible sources"]')!;
  const body = document.querySelector("[data-article-body]")!;
  expect(
    body.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(source.className).toContain("text-xs");
  expect(source.textContent).toContain("World English Bible");
  expect(document.querySelector("header")?.textContent).not.toContain(
    "copyright",
  );
});
