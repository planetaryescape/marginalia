// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALREADY_SIGNED_IN, AuthGate, takeFragmentTokens } from "./auth-gate";

const state = vi.hoisted(() => ({
  authenticated: false,
  reader: undefined as { isOwner: boolean } | null | undefined,
}));
const toast = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.authenticated,
    isLoading: false,
  }),
  useQuery: () => state.reader,
  useMutation: () => vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signUp: { email: signUp }, signIn: {} },
}));
vi.mock("@/lib/reader-settings", () => ({
  useReaderSettings: () => ({ settings: { theme: "ink" } }),
}));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: vi.fn() }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  state.authenticated = false;
  state.reader = undefined;
  history.replaceState(null, "", "/");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("one-time tokens in the URL", () => {
  it("takes both tokens and keeps the path and query", () => {
    history.replaceState(null, "", "/library?view=all#invite=abc&setup=def");
    expect(takeFragmentTokens(window)).toEqual({
      invite: "abc",
      setup: "def",
    });
    expect(location.pathname + location.search + location.hash).toBe(
      "/library?view=all",
    );
  });

  it("leaves other fragments alone", () => {
    history.replaceState(null, "", "/notes#section-2");
    expect(takeFragmentTokens(window)).toEqual({ invite: "", setup: "" });
    expect(location.hash).toBe("#section-2");
  });

  it("strips an invite while signed in, says so, and never uses it", async () => {
    state.authenticated = true;
    state.reader = { isOwner: false };
    history.replaceState(null, "", "/saved?x=1#invite=secret-invite");
    await act(async () => root.render(<AuthGate>desk</AuthGate>));
    expect(location.href).not.toContain("secret-invite");
    expect(location.pathname + location.search).toBe("/saved?x=1");
    expect(document.body.textContent).toBe("desk");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(ALREADY_SIGNED_IN);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("strips a setup link while signed in without a notice", async () => {
    state.authenticated = true;
    state.reader = { isOwner: true };
    history.replaceState(null, "", "/#setup=secret-setup");
    await act(async () => root.render(<AuthGate>desk</AuthGate>));
    expect(location.href).not.toContain("secret-setup");
    expect(toast).not.toHaveBeenCalled();
  });

  it("strips an invite when signed out and opens the sign-up form with it", async () => {
    history.replaceState(null, "", "/#invite=secret-invite");
    await act(async () => root.render(<AuthGate>desk</AuthGate>));
    expect(location.href).not.toContain("secret-invite");
    expect(document.body.textContent).toContain("Set up your reader");
    expect(document.querySelector('input[name="name"]')).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });
});
