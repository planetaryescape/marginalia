// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteUnfold, type UnfoldAnnotation } from "./note-unfold";

let root: Root;
const note: UnfoldAnnotation = {
  _id: "a1",
  type: "question",
  content:
    "Which **interruptions** do you invite? See [source](https://example.org). ¶14",
  notePath: "Reading/attention.md",
};

function Phone({
  annotation = note,
  version = 1,
  sheetOpen = false,
  onFold = () => {},
  onOpenCard = () => {},
}: {
  annotation?: UnfoldAnnotation | null;
  version?: number;
  sheetOpen?: boolean;
  onFold?: () => void;
  onOpenCard?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <>
      <article ref={ref} data-margin="phone">
        <div data-article-body>
          <p data-para="1">Before.</p>
          <p data-para="2">
            An{" "}
            <mark className="annotation-mark" data-annotation-id="a1">
              annotated phrase
            </mark>{" "}
            here.
          </p>
          <p data-para="3">After.</p>
        </div>
      </article>
      <NoteUnfold
        containerRef={ref}
        version={version}
        annotation={annotation}
        paragraph={2}
        sheetOpen={sheetOpen}
        onFold={onFold}
        onOpenCard={onOpenCard}
      />
    </>
  );
}

const body = () => document.querySelector("[data-article-body]") as HTMLElement;
const render = (ui: React.ReactElement) => act(async () => root.render(ui));
const host = () => document.querySelector<HTMLElement>(".note-unfold-host");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  if (!("escape" in CSS))
    (CSS as unknown as { escape: (s: string) => string }).escape = (s) => s;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("NoteUnfold", () => {
  it("inserts the note as a sibling directly after its paragraph", async () => {
    await render(<Phone />);
    const unfold = host();
    expect(unfold?.previousElementSibling?.getAttribute("data-para")).toBe("2");
    expect(unfold?.nextElementSibling?.getAttribute("data-para")).toBe("3");
    expect(unfold?.textContent).toContain("question · ¶2");
    expect(unfold?.textContent).toContain(
      "Which interruptions do you invite? See source. ¶14",
    );
  });

  it("adds no element the paragraph numbering would pick up", async () => {
    await render(<Phone />);
    expect(
      host()?.querySelector("p, li, blockquote, h1, h2, h3, pre, figcaption"),
    ).toBeNull();
  });

  it("folds away when the note is closed, and one note leaves no stale host", async () => {
    await render(<Phone />);
    await render(<Phone annotation={null} />);
    expect(host()).toBeNull();
    await render(<Phone />);
    expect(document.querySelectorAll(".note-unfold-host")).toHaveLength(1);
  });

  it("moves to the next note's paragraph", async () => {
    await render(<Phone />);
    body().insertAdjacentHTML(
      "beforeend",
      '<p data-para="4">Later <mark class="annotation-mark" data-annotation-id="a2">phrase</mark>.</p>',
    );
    await render(
      <Phone
        annotation={{ ...note, _id: "a2", content: "Second" }}
        version={2}
      />,
    );
    expect(document.querySelectorAll(".note-unfold-host")).toHaveLength(1);
    expect(host()?.previousElementSibling?.getAttribute("data-para")).toBe("4");
    expect(host()?.textContent).toContain("Second");
  });

  it("rebuilds the host when the article HTML is replaced", async () => {
    await render(<Phone />);
    const html = body().innerHTML.replace(
      /<div class="note-unfold-host"[\s\S]*?<\/div><\/div>/,
      "",
    );
    body().innerHTML = html;
    expect(host()).toBeNull();
    await render(<Phone version={2} />);
    expect(host()?.previousElementSibling?.getAttribute("data-para")).toBe("2");
    expect(host()?.textContent).toContain("Which interruptions");
  });

  it("removes its host on unmount", async () => {
    await render(<Phone />);
    await act(async () => root.unmount());
    expect(host()).toBeNull();
    root = createRoot(document.getElementById("root") as HTMLElement);
  });

  it("folds on Escape, but leaves that to the sheet while it is open", async () => {
    const onFold = vi.fn();
    await render(<Phone onFold={onFold} />);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onFold).toHaveBeenCalledTimes(1);
    await render(<Phone onFold={onFold} sheetOpen />);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onFold).toHaveBeenCalledTimes(1);
  });

  it("opens the sheet from the sources and follow-up row", async () => {
    const onOpenCard = vi.fn();
    await render(<Phone onOpenCard={onOpenCard} />);
    const buttons = [...(host()?.querySelectorAll("button") ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Sources",
      "Ask a follow-up",
    ]);
    await act(async () => buttons[0].click());
    await act(async () => buttons[1].click());
    expect(onOpenCard).toHaveBeenCalledTimes(2);
  });

  it("only offers Sources when the note has some", async () => {
    await render(<Phone annotation={{ ...note, notePath: undefined }} />);
    expect(
      [...(host()?.querySelectorAll("button") ?? [])].map((b) => b.textContent),
    ).toEqual(["Ask a follow-up"]);
  });
});
