import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate, RequestAccess } from "./auth-gate";

const state = vi.hoisted(() => ({
  authenticated: false,
  reader: undefined as
    | { isOwner: boolean; email: string; name: string }
    | null
    | undefined,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.authenticated,
    isLoading: false,
  }),
  useQuery: () => state.reader,
  useMutation: () => vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("@/lib/reader-settings", () => ({
  useReaderSettings: () => ({ settings: { theme: "ink" } }),
}));
vi.mock("@/lib/use-reader-theme", () => ({ useReaderTheme: vi.fn() }));

afterEach(() => {
  state.authenticated = false;
  state.reader = undefined;
});

describe("reader gate", () => {
  it("lets approved readers in", () => {
    state.authenticated = true;
    state.reader = { isOwner: false, email: "r@example.com", name: "R" };
    expect(renderToStaticMarkup(<AuthGate>desk</AuthGate>)).toBe("desk");
  });

  it("explains why a disabled or unknown account can't enter", () => {
    state.authenticated = true;
    state.reader = null;
    const html = renderToStaticMarkup(<AuthGate>desk</AuthGate>);
    expect(html).not.toContain("desk");
    expect(html).toContain("No access right now");
    expect(html).toContain("Sign out");
  });

  it("offers a way to request access from the sign-in screen", () => {
    expect(renderToStaticMarkup(<AuthGate>desk</AuthGate>)).toContain(
      "Request access",
    );
    const form = renderToStaticMarkup(<RequestAccess onBack={() => {}} />);
    expect(form).toContain('name="email"');
    expect(form).toContain('name="name"');
    expect(form).toContain('maxLength="500"');
  });
});
