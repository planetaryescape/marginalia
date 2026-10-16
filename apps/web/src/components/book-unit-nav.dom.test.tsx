// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookUnitNav } from "./book-unit-nav";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

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
const render = (unitIndex: number) =>
  act(() =>
    root.render(
      <BookUnitNav articleId="b1" unitIndex={unitIndex} outline={outline} />,
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
