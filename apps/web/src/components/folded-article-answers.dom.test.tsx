// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useParagraphs } from "@/lib/paragraphs";
import { AnswerUnfold, FoldedArticleAnswers } from "./note-unfold";

let root: Root;
const opened = vi.fn();

function Phone({
  items,
  openId,
}: {
  items: { id: string; label: string; text: string }[];
  openId: string | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const { version } = useParagraphs(ref, true);
  return (
    <>
      <article ref={ref}>
        <div data-article-body>
          <p>First paragraph of the piece.</p>
          <p>Second paragraph of the piece.</p>
        </div>
      </article>
      <FoldedArticleAnswers
        containerRef={ref}
        version={version}
        items={items.filter((i) => i.id !== openId)}
        onOpen={opened}
      />
      {openId && (
        <AnswerUnfold
          containerRef={ref}
          version={version}
          id={openId}
          paragraphIndex={null}
        >
          <div>The open answer</div>
        </AnswerUnfold>
      )}
    </>
  );
}

const items = [
  { id: "w1", label: "Ask the article", text: "It argues for patience." },
  { id: "w2", label: "Ask the article", text: "It names two causes." },
];
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  opened.mockReset();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("whole-article answers where there is no margin column", () => {
  it("wait folded at the top of the article, reachable and reopenable", async () => {
    await act(async () => root.render(<Phone items={items} openId={null} />));
    await settle();
    const host = document.querySelector("[data-marginalia-ui]");
    expect(host?.nextElementSibling?.getAttribute("data-para")).toBe("1");
    const buttons = [
      ...document.querySelectorAll<HTMLElement>("[data-marginalia-ui] button"),
    ];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Ask the articleIt argues for patience.",
      "Ask the articleIt names two causes.",
    ]);
    await act(async () => buttons[1].click());
    expect(opened).toHaveBeenCalledWith("w2");
  });

  it("leave the paragraph numbers alone and drop the one that is open", async () => {
    await act(async () => root.render(<Phone items={items} openId={null} />));
    await settle();
    const numbers = () =>
      [...document.querySelectorAll("[data-para]")].map((p) =>
        p.getAttribute("data-para"),
      );
    expect(numbers()).toEqual(["1", "2"]);
    await act(async () => root.render(<Phone items={items} openId="w1" />));
    await settle();
    expect(numbers()).toEqual(["1", "2"]);
    expect(document.body.textContent).toContain("The open answer");
    expect(document.body.textContent).not.toContain("It argues for patience.");
    expect(document.body.textContent).toContain("It names two causes.");
  });

  it("render nothing when there is nothing folded", async () => {
    await act(async () => root.render(<Phone items={[]} openId={null} />));
    await settle();
    expect(document.querySelector("[data-marginalia-ui]")).toBeNull();
  });
});
