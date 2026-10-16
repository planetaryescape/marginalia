// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNav } from "./site-header";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));
vi.mock("./account-menu", () => ({ AccountMenu: () => null }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  nav.push.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
});

const search = () =>
  [...container.querySelectorAll("button")].find(
    (el) => el.textContent === "Search",
  ) as HTMLButtonElement;

describe("MobileNav", () => {
  it("shows Desk, Library, Notes and Search, with the current room marked", async () => {
    nav.pathname = "/library";
    await act(async () => root.render(<MobileNav />));
    const links = [...container.querySelectorAll("a")].map(
      (a) => a.textContent,
    );
    expect(links).toEqual(["Desk", "Library", "Notes"]);
    expect(search()).toBeTruthy();
    const current = container.querySelector("[aria-current=page]");
    expect(current?.textContent).toBe("Library");
  });

  it("opens the picker on the desk without leaving it", async () => {
    nav.pathname = "/";
    const listener = vi.fn();
    document.addEventListener("marginalia:open-finder", listener);
    await act(async () => root.render(<MobileNav />));
    await act(async () => search().click());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    document.removeEventListener("marginalia:open-finder", listener);
  });

  it("goes to the desk with the picker asked for from another room", async () => {
    nav.pathname = "/library";
    await act(async () => root.render(<MobileNav />));
    await act(async () => search().click());
    expect(nav.push).toHaveBeenCalledWith("/?find=1");
  });
});
