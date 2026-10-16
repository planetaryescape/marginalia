// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionPage from "./page";

const state = vi.hoisted(() => ({
  session: undefined as unknown,
  search: "",
  replace: vi.fn(),
}));

vi.mock("convex/react", () => ({ useQuery: () => state.session }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

let root: Root;
beforeEach(() => {
  state.session = undefined;
  state.search = "";
  state.replace = vi.fn();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
const render = () => act(async () => root.render(<SessionPage />));

describe("old session links", () => {
  it("redirect to the desk in the chosen state, keeping the window in the link", async () => {
    state.session = { requestedMinutes: 5 };
    state.search = "m=10";
    await render();
    expect(state.replace).toHaveBeenCalledWith("/?m=10&session=s1");
  });

  it("fall back to the window the session was created with", async () => {
    state.session = { requestedMinutes: 20 };
    await render();
    expect(state.replace).toHaveBeenCalledWith("/?m=20&session=s1");
  });

  it("wait for the session, and say so when it isn't there", async () => {
    await render();
    expect(state.replace).not.toHaveBeenCalled();
    state.session = null;
    state.search = "m=10";
    await render();
    expect(state.replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("This session isn't here.");
  });
});
