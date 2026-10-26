// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionAnswer } from "./companion-answer";

vi.mock("next/link", () => ({
  default: ({ href, children }: PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
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

const render = (text: string, lead = true) =>
  act(() =>
    root.render(
      <CompanionAnswer
        text={text}
        lead={lead}
        streaming={false}
        onJump={() => {}}
      />,
    ),
  );

describe("a companion answer", () => {
  it("keeps the lead in ink, never in the reader's highlighter", () => {
    render("The short answer.\n\nMore detail.");
    expect(host.querySelector(".companion-lead")).toBeNull();
    expect(host.querySelector("p")?.textContent).toBe("The short answer.");
  });

  it("renders italics and a dashed list as a list", () => {
    render(
      'Lead.\n\nFrom Latin *transducere*.\n\nSubstitutes that fit:\n- "one"\n- "two"',
    );
    expect(host.querySelector("em")?.textContent).toBe("transducere");
    const items = [...host.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(['"one"', '"two"']);
    expect(host.textContent).toContain("Substitutes that fit:");
  });

  it("leaves a lone asterisk and bold text alone", () => {
    render("Lead.\n\n5 * 3 is **fifteen**.");
    expect(host.querySelector("em")).toBeNull();
    expect(host.querySelector("strong")?.textContent).toBe("fifteen");
  });

  it("shows the text alone when a link was cut off before its closing paren", () => {
    render(
      "Lead.\n\n- [A fine one](/read/abc123)\n- [Authorization in Next.js](/read/jd7ceet10d",
    );
    const items = [...host.querySelectorAll("li")];
    expect(items[0].querySelector("a")?.getAttribute("href")).toBe(
      "/read/abc123",
    );
    expect(items[1].textContent).toBe("Authorization in Next.js");
    expect(items[1].querySelector("a")).toBeNull();
    expect(host.textContent).not.toContain("](");
  });

  it("shows the text alone for a link whose address can't be opened", () => {
    render("Lead.\n\nSee [this](not a url) and [that](/read/ABC).");
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toBe("Lead.See this and that.");
  });
});
