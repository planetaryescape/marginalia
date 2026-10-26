// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhenYouRead } from "./when-you-read";
import { YourSources } from "./your-sources";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("your sources", () => {
  it("never draws a bar past its row, even when opens outnumber offers", () => {
    act(() =>
      root.render(
        <YourSources
          feeds={[
            {
              feedId: "f",
              title: "www.example.com",
              offered: 1,
              opened: 8,
              finished: 1,
              skipsMost: false,
            },
          ]}
        />,
      ),
    );
    const widths = [
      ...host.querySelectorAll<HTMLElement>("[aria-hidden] > div"),
    ].map((bar) => Number.parseFloat(bar.style.width));
    expect(widths.every((w) => w <= 100)).toBe(true);
    expect(Math.max(...widths)).toBe(100);
  });
});

describe("when you read", () => {
  it("reads out any hour under the pointer, empty or not", () => {
    const heat = new Array(168).fill(0);
    heat[3 * 24 + 20] = 15;
    act(() =>
      root.render(<WhenYouRead heat={heat} timeZone="Europe/London" />),
    );
    const cells = host.querySelectorAll("i");
    act(() => {
      cells[3 * 24 + 20].dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    expect(host.textContent).toContain("Thu, 8 p.m. · 15 min");
    act(() => {
      cells[2 * 24 + 3].dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    expect(host.textContent).toContain("Wed, 3 a.m. · no reading");
  });
});
