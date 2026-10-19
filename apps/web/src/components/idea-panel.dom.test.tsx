// @vitest-environment happy-dom
import type { api } from "@marginalia/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GraphEdge } from "@/lib/idea-kinds";
import { EdgePanel } from "./idea-panel";

type EdgeExplanation = FunctionReturnType<
  typeof api.actions.explainIdeaEdge.explain
>;

const mocks = vi.hoisted(() => ({ explain: vi.fn(), mutate: vi.fn() }));
vi.mock("convex/react", () => ({
  useAction: () => mocks.explain,
  useMutation: () => mocks.mutate,
  useQuery: vi.fn(),
}));
let root: Root;
let mount: HTMLDivElement;
const edge: GraphEdge = {
  id: "a|b",
  a: "note:a",
  b: "vault:b.md",
  reasons: [],
  needsAi: true,
};
const labels = new Map([
  [edge.a, "First idea"],
  [edge.b, "Second idea"],
]);
const viaOf = (key: string) =>
  key === edge.b ? "selected-passage" : undefined;
const render = (selected = edge) =>
  act(async () =>
    root.render(<EdgePanel edge={selected} labels={labels} viaOf={viaOf} />),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.explain.mockReset();
  mocks.mutate.mockReset();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
});

it.each([
  true,
  false,
])("renders the actual generated union (cached=%s) with the selected passage", async (cached) => {
  const result: EdgeExplanation = {
    source: "generated",
    reason: "Both explore the limits of memory.",
    cached,
  };
  mocks.explain.mockResolvedValue(result);
  await render();
  expect(mount.textContent).toContain(result.reason);
  expect(mocks.explain).toHaveBeenCalledExactlyOnceWith({
    a: edge.a,
    b: edge.b,
    aVia: undefined,
    bVia: "selected-passage",
  });
});

it("renders free structural reasons using the unchanged union", async () => {
  const result: EdgeExplanation = {
    source: "structural",
    reasons: [{ type: "linked", text: "You linked these" }],
  };
  mocks.explain.mockResolvedValue(result);
  await render();
  expect(mount.textContent).toContain("You linked these");
});

it("shows a truthful timeout, performs no automatic retry, and retries only on the reader's click", async () => {
  mocks.explain.mockRejectedValueOnce(
    new ConvexError("The explanation is still being generated."),
  );
  await render();
  expect(mount.textContent).toContain("still being generated");
  expect(mocks.explain).toHaveBeenCalledTimes(1);
  const retry = [...mount.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  );
  if (!retry) throw new Error("Missing explicit retry");
  mocks.explain.mockResolvedValueOnce({
    source: "generated",
    reason: "The shared current reason.",
    cached: true,
  });
  await act(async () => retry.click());
  expect(mount.textContent).toContain("The shared current reason.");
  expect(mocks.explain).toHaveBeenCalledTimes(2);
});

it("ignores a late reason for a different selected edge", async () => {
  let release = (_value: EdgeExplanation) => {};
  mocks.explain.mockImplementationOnce(
    () =>
      new Promise<EdgeExplanation>((resolve) => {
        release = resolve;
      }),
  );
  await render();
  expect(mount.querySelector('[role="status"]')).not.toBeNull();
  mocks.explain.mockResolvedValueOnce({
    source: "generated",
    reason: "Current selected edge.",
    cached: true,
  });
  await render({ ...edge, id: "a|c", b: "note:c" });
  await act(async () =>
    release({
      source: "generated",
      reason: "Stale other edge.",
      cached: false,
    }),
  );
  expect(mount.textContent).toContain("Current selected edge.");
  expect(mount.textContent).not.toContain("Stale other edge.");
});
