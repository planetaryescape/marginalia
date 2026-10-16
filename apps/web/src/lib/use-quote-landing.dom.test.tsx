// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuoteLanding } from "./use-quote-landing";

let root: Root;
let host: HTMLElement;
let scrolled: HTMLElement[] = [];

function Reader({
  quote,
  version,
  last = "The last paragraph closes the piece.",
}: {
  quote: string | null;
  version: number;
  last?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useQuoteLanding(ref, quote, version);
  return (
    <article ref={ref}>
      <div data-article-body>
        <p>The first paragraph is about trains and their timetables.</p>
        <p>
          The second paragraph says the number was large enough to change how
          people talked about work.
        </p>
        <p>{last}</p>
      </div>
    </article>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
    scrolled.push(this);
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (quote: string | null, version = 1, last?: string) =>
  act(async () =>
    root.render(<Reader quote={quote} version={version} last={last} />),
  );

describe("useQuoteLanding", () => {
  it("scrolls to the paragraph that holds the quote", async () => {
    await render("number was large enough to change");
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].tagName).toBe("P");
    expect(scrolled[0].textContent).toContain("The second paragraph");
  });

  it("does nothing without a quote", async () => {
    await render(null);
    expect(scrolled).toHaveLength(0);
  });

  it("does nothing when the quote is not in the article", async () => {
    await render("a sentence that is nowhere in this piece");
    expect(scrolled).toHaveLength(0);
  });

  it("scrolls once per quote, not again on later re-tags", async () => {
    await render("The last paragraph closes the piece.", 1);
    await render("The last paragraph closes the piece.", 2);
    expect(scrolled).toHaveLength(1);
  });

  it("waits for a quote that is not rendered yet, and lands on it after a re-tag", async () => {
    await render("The closing line is new.", 1, "The old closing line.");
    expect(scrolled).toHaveLength(0);
    await render("The closing line is new.", 2, "The closing line is new.");
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].textContent).toBe("The closing line is new.");
  });
});
