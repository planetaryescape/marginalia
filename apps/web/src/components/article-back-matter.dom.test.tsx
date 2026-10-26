// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleBackMatter } from "./article-back-matter";

const saveResponse = vi.fn();
vi.mock("convex/react", () => ({ useMutation: () => saveResponse }));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { reflections: { saveResponse: "saveResponse" } },
}));
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({
          children,
          className,
        }: {
          children: React.ReactNode;
          className?: string;
        }) => <div className={className}>{children}</div>,
    },
  ),
}));
vi.mock("./impression-panel", () => ({
  ImpressionPanel: () => (
    <div>
      <p>How did it land?</p>
      <textarea aria-label="What stayed with you?" />
    </div>
  ),
}));

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  saveResponse.mockReset().mockResolvedValue(undefined);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const reflection = {
  _id: "r1",
  strongestPoint: "a",
  weakestAssumption: "b",
  credibleCounterview: "c",
  questionForYou: "d",
};
const render = (onDone = vi.fn(), finished = false, onMarkUnread = vi.fn()) =>
  act(() =>
    root.render(
      <ArticleBackMatter
        articleId="a1"
        reflection={reflection}
        impressionRef={createRef()}
        reflectionFlush={{ current: null }}
        onDone={onDone}
        finished={finished}
        onMarkUnread={onMarkUnread}
      />,
    ),
  );

describe("ArticleBackMatter", () => {
  it("runs Before you go, then the impression, then Done", () => {
    render();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Before you go")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Before you go")).toBeLessThan(
      text.indexOf("How did it land?"),
    );
    expect(text.indexOf("How did it land?")).toBeLessThan(
      text.lastIndexOf("Done"),
    );
    expect(document.querySelectorAll("button")).toHaveLength(1);
  });

  it("offers Mark unread beside Done only once the article is finished", () => {
    render(vi.fn(), false);
    const labels = () =>
      [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels()).not.toContain("Mark unread");
    const onMarkUnread = vi.fn();
    render(vi.fn(), true, onMarkUnread);
    expect(labels()).toContain("Done");
    const unread = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Mark unread",
    );
    act(() => unread?.click());
    expect(onMarkUnread).toHaveBeenCalledTimes(1);
  });

  it("does not box the impression in a ringed card", () => {
    render();
    const section = document.querySelector("section");
    expect(section?.className).not.toMatch(/ring|rounded|bg-/);
  });

  it("uses theme tokens, not the legacy ink and parchment classes", () => {
    render();
    expect(document.body.innerHTML).not.toMatch(
      /(?:^|[\s"])(?:dark:)?(?:text|bg|border)-(?:ink|parchment)-\d/,
    );
  });

  it("autosaves the reflection after typing stops and says Saved", async () => {
    render();
    const box = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Your reflection"]',
    ) as HTMLTextAreaElement;
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      set?.call(box, "It holds up");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(saveResponse).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(saveResponse).toHaveBeenCalledWith({
      reflectionId: "r1",
      userResponse: "It holds up",
    });
    expect(document.body.textContent).toContain("Saved");
  });
});
