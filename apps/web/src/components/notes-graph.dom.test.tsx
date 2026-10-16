// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesGraph } from "./notes-graph";

const mocks = vi.hoisted(() => ({
  graph: undefined as unknown,
  node: undefined as unknown,
  search: [] as unknown[],
  similar: vi.fn(async () => [] as string[]),
  write: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) =>
    args === "skip" ? undefined : (mocks as never)[ref],
  useAction: (ref: string) => (mocks as never)[ref],
  useMutation: (ref: string) => (mocks as never)[ref],
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    ideaGraph: {
      graph: "graph",
      node: "node",
      search: "search",
      writeConnected: "write",
      link: "link",
      unlink: "unlink",
    },
    actions: {
      ideaNeighbours: { similar: "similar" },
      explainIdeaEdge: { explain: "explain" },
    },
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const note = {
  key: "note:c",
  kind: "note",
  label: "Block whole mornings",
  hop: 0,
  createdAt: 1,
};
const detail = {
  key: "note:c",
  kind: "note",
  text: "Block whole mornings, not just notifications.",
  createdAt: 1,
  canWrite: true,
  articleId: "art1",
  articleTitle: "The quiet cost",
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.graph = { centre: "note:c", nodes: [note], edges: [] };
  mocks.node = detail;
  mocks.write.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () =>
  act(async () => root.render(<NotesGraph toggle={<span>toggle</span>} />));

describe("Notes as a map", () => {
  it("says so when there are no notes yet", async () => {
    mocks.graph = { centre: null, nodes: [], edges: [] };
    await render();
    expect(host.textContent).toContain("No notes yet");
    expect(host.querySelector("svg")).toBeNull();
  });

  it("shows a lone note with a gentle line instead of an empty map", async () => {
    await render();
    expect(host.querySelectorAll("[data-node]")).toHaveLength(1);
    expect(host.textContent).toContain("Nothing else connects to this yet");
    expect(host.textContent).toContain("Block whole mornings, not just");
    expect(host.textContent).toContain("New connected note");
  });

  it("closes the panel on Escape", async () => {
    await render();
    expect(host.querySelector("aside")).not.toBeNull();
    await act(async () => {
      host
        .querySelector("[data-node]")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(host.querySelector("aside")).toBeNull();
  });

  it("saves a connected note from the panel and says it is on the map", async () => {
    mocks.write.mockResolvedValue("note:new");
    await render();
    const open = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("New connected note"),
    );
    await act(async () => open?.click());
    const field = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      set?.call(field, "If the schedule does the work");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Save",
    );
    await act(async () => save?.click());
    expect(mocks.write).toHaveBeenCalledWith({
      from: "note:c",
      content: "<p>If the schedule does the work</p>",
      contentPlain: "If the schedule does the work",
      prompt: undefined,
    });
    expect(host.textContent).toContain("Saved. Your note is on the map.");
  });

  it("offers no writing beside a vault note with no article", async () => {
    mocks.node = {
      ...detail,
      kind: "vault",
      canWrite: false,
      filePath: "v/x.md",
    };
    await render();
    expect(host.textContent).not.toContain("New connected note");
    expect(host.textContent).toContain("hasn’t tied this vault note");
  });
});
