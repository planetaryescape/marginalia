// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadersPage from "./page";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  decline: vi.fn(),
  setStatus: vi.fn(),
}));

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
    if (ref === "auth.currentReader") return { isOwner: true };
    if (ref === "waitlist.listRequests")
      return {
        pending: [
          {
            _id: "r1",
            name: "Ann",
            email: "ann@example.com",
            note: null,
            createdAt: 0,
          },
          {
            _id: "r2",
            name: "Cy",
            email: "cy@example.com",
            note: null,
            createdAt: 0,
          },
        ],
        recent: [],
      };
    if (ref === "waitlist.listInvites") return [];
    if (ref === "readers.list")
      return [
        {
          _id: "u1",
          email: "bo@example.com",
          name: null,
          status: "active",
          deleting: false,
          createdAt: 0,
        },
      ];
    return undefined;
  },
  useAction: (ref: unknown) =>
    ref === "waitlist.approve" ? mocks.approve : vi.fn(),
  useMutation: (ref: unknown) => {
    if (ref === "waitlist.decline") return mocks.decline;
    if (ref === "readers.setStatus") return mocks.setStatus;
    return vi.fn();
  },
}));

let root: Root;
const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  mocks.approve.mockReset().mockResolvedValue({
    url: "https://example.com/invite/abc",
    email: "ann@example.com",
  });
  mocks.decline.mockReset().mockResolvedValue(null);
  mocks.setStatus.mockReset().mockResolvedValue(null);
  writeText.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name);

describe("Readers page", () => {
  it("counts waiting requests and offers Approve and Decline for each", async () => {
    await act(async () => root.render(<ReadersPage />));
    expect(document.body.textContent).toContain("2 waiting");
    expect(
      [...document.querySelectorAll("button")].filter(
        (b) => b.textContent === "Approve",
      ),
    ).toHaveLength(2);
    expect(
      [...document.querySelectorAll("button")].filter(
        (b) => b.textContent === "Decline",
      ),
    ).toHaveLength(2);
  });

  it("approves a request, then marks the invite link Copied in place", async () => {
    await act(async () => root.render(<ReadersPage />));
    await act(async () => button("Approve")?.click());
    expect(mocks.approve).toHaveBeenCalledWith({ requestId: "r1" });
    expect(document.body.textContent).toContain(
      "Invite link for ann@example.com",
    );

    await act(async () => button("Copy")?.click());
    expect(writeText).toHaveBeenCalledWith("https://example.com/invite/abc");
    expect(button("Copied")).toBeDefined();
  });

  it("declines a request", async () => {
    await act(async () => root.render(<ReadersPage />));
    await act(async () => button("Decline")?.click());
    expect(mocks.decline).toHaveBeenCalledWith({ requestId: "r1" });
  });

  it("disables a reader only after the in-place confirm, and Keep cancels", async () => {
    await act(async () => root.render(<ReadersPage />));
    await act(async () => button("Disable")?.click());
    expect(document.body.textContent).toContain(
      "Disable bo@example.com? They're signed out everywhere",
    );
    await act(async () => button("Keep")?.click());
    expect(mocks.setStatus).not.toHaveBeenCalled();

    await act(async () => button("Disable")?.click());
    // The confirm's Disable sits beside its Keep, not the row's own button
    const confirmDisable = [
      ...(button("Keep")?.parentElement?.querySelectorAll("button") ?? []),
    ].find((b) => b.textContent === "Disable");
    await act(async () => confirmDisable?.click());
    expect(mocks.setStatus).toHaveBeenCalledWith({
      readerId: "u1",
      status: "disabled",
    });
  });
});
