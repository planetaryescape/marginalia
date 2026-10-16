import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "./page";

const state = vi.hoisted(() => ({ isOwner: true }));

vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: new Proxy(
    {},
    {
      get: (_, ns) =>
        new Proxy({}, { get: (_t, fn) => `${String(ns)}.${String(fn)}` }),
    },
  ),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    if (ref === "auth.currentReader")
      return { email: "bk@example.com", isOwner: state.isOwner };
    if (ref === "providerCredentials.capabilities")
      return { chatgptAvailable: false };
    if (ref === "providerCredentials.list") return [];
    return undefined;
  },
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { email: "bk@example.com" } } }),
    useListPasskeys: () => ({ data: [], refetch: vi.fn() }),
    signOut: vi.fn(),
  },
}));

const html = () => renderToStaticMarkup(<AccountPage />);

describe("Account page", () => {
  beforeEach(() => {
    state.isOwner = true;
  });

  it("orders Signing in, AI providers and Touch feedback, with the email in meta", () => {
    const page = html();
    const at = (text: string) => page.indexOf(text);
    expect(page).toContain("bk@example.com");
    expect(at(">Signing in</h2>")).toBeGreaterThan(-1);
    expect(at(">Signing in</h2>")).toBeLessThan(
      at(">AI providers and models</h2>"),
    );
    expect(at(">AI providers and models</h2>")).toBeLessThan(
      at(">Touch feedback</h2>"),
    );
  });

  it("drops the Readers button and API tokens", () => {
    const page = html();
    expect(page).not.toContain("Manage readers and requests");
    expect(page).not.toContain("Connected apps");
    expect(page).not.toContain("Sending from other apps");
  });

  it("hides Delete account from the owner", () => {
    expect(html()).not.toContain("Delete my account");
  });

  it("shows Delete account last to a non-owner", () => {
    state.isOwner = false;
    const page = html();
    expect(page).toContain("Delete my account");
    expect(page.indexOf("Delete my account")).toBeGreaterThan(
      page.indexOf(">Touch feedback</h2>"),
    );
  });
});
