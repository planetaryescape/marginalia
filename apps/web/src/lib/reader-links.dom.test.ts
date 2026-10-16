// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachLeavingLinks } from "./reader-links";

const ARTICLE = "https://blog.example.org/posts/focus";
let root: HTMLElement;
let detach: (() => void) | undefined;

function mount(html: string): HTMLElement {
  root = document.createElement("article");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  detach?.();
  detach = undefined;
  root?.remove();
});

function click(el: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  el.dispatchEvent(event);
  return event;
}

describe("attachLeavingLinks", () => {
  it("stops a plain click on an outside link and reports it", () => {
    const body = mount(
      '<p><a href="https://other.example.com/page">the source</a></p>',
    );
    const onLink = vi.fn();
    detach = attachLeavingLinks(body, ARTICLE, onLink);
    const event = click(body.querySelector("a") as HTMLAnchorElement);
    expect(event.defaultPrevented).toBe(true);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink.mock.calls[0][0]).toMatchObject({
      href: "https://other.example.com/page",
      text: "the source",
    });
  });

  it("resolves relative links against the article, not the reader's page", () => {
    const body = mount('<a href="/notes/2024">older notes</a>');
    const onLink = vi.fn();
    detach = attachLeavingLinks(body, ARTICLE, onLink);
    click(body.querySelector("a") as HTMLAnchorElement);
    expect(onLink.mock.calls[0][0].href).toBe(
      "https://blog.example.org/notes/2024",
    );
  });

  it.each([
    ["command", { metaKey: true }],
    ["control", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("leaves a %s click to the browser", (_, init) => {
    const body = mount('<a href="https://other.example.com/">out</a>');
    const onLink = vi.fn();
    detach = attachLeavingLinks(body, ARTICLE, onLink);
    const event = click(body.querySelector("a") as HTMLAnchorElement, init);
    expect(event.defaultPrevented).toBe(false);
    expect(onLink).not.toHaveBeenCalled();
  });

  it.each([
    ["an in-article anchor", '<a href="#section-2">jump</a>'],
    [
      "a link to a place in this article",
      `<a href="${ARTICLE}#para-3">¶ 3</a>`,
    ],
    ["a mailto link", '<a href="mailto:someone@example.com">mail</a>'],
    ["a javascript link", '<a href="javascript:void(0)">js</a>'],
    ["a link without an href", "<a>no target</a>"],
  ])("keeps %s on its own behaviour", (_, html) => {
    const body = mount(html);
    const onLink = vi.fn();
    detach = attachLeavingLinks(body, ARTICLE, onLink);
    const event = click(body.querySelector("a") as HTMLAnchorElement);
    expect(event.defaultPrevented).toBe(false);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("ignores clicks that were already handled", () => {
    const body = mount('<a href="https://other.example.com/">out</a>');
    const onLink = vi.fn();
    body.addEventListener("click", (e) => e.preventDefault(), {
      capture: true,
    });
    detach = attachLeavingLinks(body, ARTICLE, onLink);
    click(body.querySelector("a") as HTMLAnchorElement);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("stops listening after cleanup", () => {
    const body = mount('<a href="https://other.example.com/">out</a>');
    const onLink = vi.fn();
    const stop = attachLeavingLinks(body, ARTICLE, onLink);
    stop();
    const event = click(body.querySelector("a") as HTMLAnchorElement);
    expect(event.defaultPrevented).toBe(false);
    expect(onLink).not.toHaveBeenCalled();
  });
});
