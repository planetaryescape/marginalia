// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptureKeepsShelf } from "./scripture-keeps-shelf";

const state = vi.hoisted(() => ({
  open: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
  rows: [] as unknown[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} />
  ),
}));
vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({
    results: state.rows,
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
  useAction: () => state.open,
  useMutation: (fn: Parameters<typeof getFunctionName>[0]) => {
    if (getFunctionName(fn) !== "scriptureKeeps:remove")
      throw new Error("Unexpected mutation");
    return state.remove;
  },
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.open.mockReset().mockResolvedValue("target-article");
  state.remove.mockReset().mockResolvedValue(null);
  state.push.mockReset();
  state.rows = [
    {
      _id: "keep-1",
      reference: "John 10:11",
      referenceKey: "JHN.10.11",
      estimatedReadMinutes: 1,
      origins: [
        {
          sourceReference: "Psalms 23",
          sourceArticleId: null,
          reason: "The shepherd image appears here too.",
        },
      ],
    },
  ];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function button(label: string) {
  const match = [...host.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  if (!match) throw new Error(`Missing ${label}`);
  return match;
}

describe("Kept references in the existing Saved shelf", () => {
  it("shows the surviving why-kept context without automatically opening or fetching", async () => {
    act(() => root.render(<ScriptureKeepsShelf />));
    expect(state.open).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Kept while reading Psalms 23");
    expect(host.querySelector("a")).toBeNull();
    await act(async () => button("John 10:11").click());
    expect(state.open).toHaveBeenCalledWith({ reference: "John 10:11" });
    expect(state.push).toHaveBeenCalledWith("/read/target-article");
  });
  it("retains an unavailable passage and retries without silently replacing its edition", async () => {
    state.open.mockRejectedValueOnce(new Error("edition unavailable"));
    act(() => root.render(<ScriptureKeepsShelf />));
    await act(async () => button("John 10:11").click());
    expect(state.push).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "chosen edition has not been replaced",
    );
    await act(async () => button("Retry").click());
    expect(state.open).toHaveBeenNthCalledWith(2, { reference: "John 10:11" });
    expect(state.push).toHaveBeenCalledOnce();
  });
  it("removes a reference only after explicit confirmation", async () => {
    act(() => root.render(<ScriptureKeepsShelf />));
    await act(async () => button("Remove").click());
    expect(state.remove).not.toHaveBeenCalled();
    const confirm = host.querySelector<HTMLButtonElement>(
      '[role="group"] button',
    );
    if (!confirm) throw new Error("Missing removal confirmation");
    await act(async () => confirm.click());
    expect(state.remove).toHaveBeenCalledWith({ keepId: "keep-1" });
    expect(state.open).not.toHaveBeenCalled();
  });
});
