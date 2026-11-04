// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BookUnitNav } from "./book-unit-nav";

let root: Root;
beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const outline = [
  { title: "The zoo", minutes: 6 },
  { title: "Why systems surprise us", minutes: 9 },
  { title: "Leverage", minutes: 7 },
];
const render = (
  unitIndex: number,
  summaries?: (string | null)[],
  epub = false,
  units = outline,
) =>
  act(() =>
    root.render(
      <BookUnitNav
        articleId="b1"
        unitIndex={unitIndex}
        outline={units}
        summaries={summaries}
        epub={epub}
      />,
    ),
  );
const link = (label: string) =>
  [...document.querySelectorAll("a")].find((a) =>
    a.textContent?.includes(label),
  );

describe("the foot of a part", () => {
  it("leads to the next part by its title and length", () => {
    render(0);
    expect(document.body.textContent).toContain("Part 1 of 3");
    const next = link("Why systems surprise us");
    expect(next?.getAttribute("href")).toBe("/read/b1?unit=1");
    expect(next?.textContent).toContain("Next part · 9 min");
    expect(link("Previous part")).toBeUndefined();
  });

  it("offers the previous part and marks the current one in the list", () => {
    render(1);
    expect(link("Previous part")?.getAttribute("href")).toBe("/read/b1?unit=0");
    const current = document.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain("Why systems surprise us");
  });

  it("says when the book ends", () => {
    render(2);
    expect(document.body.textContent).toContain("That's the end of the book.");
    expect(link("Next part")).toBeUndefined();
  });
});

describe("the list of parts", () => {
  it("shows each part's one-line summary once it exists", () => {
    render(0, ["Why the zoo matters.", null]);
    const items = [...document.querySelectorAll("ol li")];
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("Why the zoo matters.");
    // A part whose summary isn't written yet, or is past the end of the list so far, shows its title alone
    expect(items[1].textContent).toBe("2. Why systems surprise us9 min");
    expect(items[2].textContent).toBe("3. Leverage7 min");
  });

  it("is only titles while no summary has landed", () => {
    render(0);
    expect(document.querySelector("ol li")?.textContent).toBe(
      "1. The zoo6 min",
    );
  });
});

describe("EPUB chapter navigation", () => {
  it("shows chapter titles and Contents without counting reading chunks as chapters", () => {
    render(1, undefined, true);
    expect(document.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Contents",
    );
    expect(document.body.textContent).not.toContain("Part 2 of 3");
    expect(document.querySelector("nav > p")?.textContent).toBe(
      "Why systems surprise us",
    );
    expect(link("Next chapter")?.getAttribute("href")).toBe("/read/b1?unit=2");
    expect(link("Previous chapter")?.getAttribute("href")).toBe(
      "/read/b1?unit=0",
    );
    expect(document.querySelector("summary")?.textContent).toBe("Contents");
    expect(document.querySelector("ol li")?.textContent).toBe("The zoo6 min");
  });

  it("keeps split chunks in the same chapter without calling them new chapters", () => {
    const split = [outline[0], outline[0], outline[1]];
    render(0, undefined, true, split);
    expect(link("Continue chapter")?.getAttribute("href")).toBe(
      "/read/b1?unit=1",
    );
    expect(document.querySelectorAll("ol li")[1].textContent).toContain(
      "The zoo (continued)",
    );
    render(1, undefined, true, split);
    expect(link("Earlier in chapter")?.getAttribute("href")).toBe(
      "/read/b1?unit=0",
    );
    expect(link("Next chapter")?.getAttribute("href")).toBe("/read/b1?unit=2");
  });
});
