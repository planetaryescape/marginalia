// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoveryInvalidation } from "@/lib/discovery-invalidation";
import { SessionCache } from "@/lib/session-cache";
import { discoveryTabs } from "@/lib/test/discovery-tabs";
import { NotesGraph } from "./notes-graph";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: mocks.session ? { session: { id: mocks.session } } : null,
    }),
  },
}));

const mocks = vi.hoisted(() => ({
  // SAFETY: mutable fixture slot includes logout; the initial value is a string.
  session: "graph-test" as string | null,
  graph: undefined as unknown,
  node: undefined as unknown,
  search: [] as unknown[],
  similar: vi.fn(async (): Promise<{ key: string; via?: string }[]> => []),
  write: vi.fn(),
  graphArgs: [] as unknown[],
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (ref === "graph") mocks.graphArgs.push(args);
    return args === "skip" ? undefined : (mocks as never)[ref];
  },
  useAction: (ref: string) => (mocks as never)[ref],
  useMutation: (ref: string) => (mocks as never)[ref],
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    ideaGraph: {
      graph: "graph",
      node: "node",
      search: "search",
    },
    ideaLinks: {
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
let tabs: ReturnType<typeof discoveryTabs>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  window.dispatchEvent(new Event("pagehide"));
  tabs = discoveryTabs();
  window.dispatchEvent(new Event("pageshow"));
  mocks.session = "graph-test";
  mocks.similar.mockReset().mockResolvedValue([]);
  mocks.graph = { centre: "note:c", nodes: [note], edges: [] };
  mocks.node = detail;
  mocks.write.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.dispatchEvent(new Event("pagehide"));
  host.remove();
  tabs.close();
  vi.unstubAllGlobals();
});

const render = () =>
  act(async () => root.render(<NotesGraph toggle={<span>toggle</span>} />));

async function saveConnectedNote() {
  const open = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("New connected note"),
  );
  await act(async () => open?.click());
  const field = host.querySelector("textarea");
  if (!field) throw new Error("Missing connected-note input");
  expect(document.activeElement).toBe(field);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(field, "If the schedule does the work");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Save",
  );
  if (!save) throw new Error("Missing save action");
  await act(async () => save.click());
}

describe("Notes as a map", () => {
  it("waits for the selected vault passage instead of searching the previous passage again", async () => {
    vi.useFakeTimers();
    try {
      const vault = {
        ...note,
        key: "vault:v/x.md",
        kind: "vault",
        via: "old-passage",
      };
      mocks.graph = { centre: vault.key, nodes: [vault], edges: [] };
      await render();
      mocks.search = [
        {
          key: vault.key,
          kind: "vault",
          label: "New passage",
          via: "selected-passage",
        },
      ];
      const input = host.querySelector("input");
      if (!input) throw new Error("Missing search input");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, "passage");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(210);
      });
      // The new live query is pending; useLatest still holds the old passage.
      mocks.graph = undefined;
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
      expect(mocks.similar.mock.calls).toEqual([
        [{ key: vault.key, via: "old-passage" }],
      ]);
      mocks.graph = {
        centre: vault.key,
        nodes: [{ ...vault, via: "selected-passage" }],
        edges: [],
      };
      await render();
      expect(mocks.similar.mock.calls).toEqual([
        [{ key: vault.key, via: "old-passage" }],
        [{ key: vault.key, via: "selected-passage" }],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("reselecting the same centre is explicit revalidation, but reuses fresh hints", async () => {
    await render();
    await act(async () => tabs.remote.publish());
    expect(mocks.similar).toHaveBeenCalledTimes(1);
    const node = host.querySelector("[data-node]");
    if (!node) throw new Error("Missing graph centre");
    await act(async () =>
      node.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(mocks.similar).toHaveBeenCalledTimes(2);
    await act(async () =>
      node.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(mocks.similar).toHaveBeenCalledTimes(2);
  });

  it("does not reuse already-visible hints under a different session", async () => {
    mocks.similar.mockResolvedValueOnce([{ key: "reader-a-only" }]);
    await render();
    expect(mocks.graphArgs.at(-1)).toMatchObject({
      similar: [{ key: "reader-a-only" }],
    });
    mocks.similar.mockImplementationOnce(() => new Promise(() => {}));
    mocks.session = "reader-b";
    await render();
    expect(mocks.graphArgs.at(-1)).toMatchObject({ similar: undefined });
  });
  it("evicts remote hints without an action or resetting active input/panel, then misses on revisit", async () => {
    await render();
    const input = host.querySelector("input");
    if (!input) throw new Error("Missing search input");
    input.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "unsent text");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = mocks.graphArgs.at(-1);
    await act(async () => tabs.remote.publish());
    await render();
    expect(mocks.similar).toHaveBeenCalledTimes(1);
    expect(mocks.graphArgs.at(-1)).toEqual(before);
    expect(input.value).toBe("unsent text");
    expect(document.activeElement).toBe(input);
    expect(host.querySelector("aside")).not.toBeNull();
    mocks.graph = {
      centre: "note:b",
      nodes: [{ ...note, key: "note:b" }],
      edges: [],
    };
    await render();
    mocks.graph = { centre: "note:c", nodes: [note], edges: [] };
    await render();
    expect(mocks.similar).toHaveBeenCalledTimes(3);
  });

  it("does not publish late hints after remote invalidation while the graph is active", async () => {
    let finish: (hints: { key: string }[]) => void = () => {};
    mocks.similar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await act(async () => tabs.remote.publish());
    await act(async () => finish([{ key: "stale-hint" }]));
    expect(mocks.graphArgs.at(-1)).not.toMatchObject({
      similar: [{ key: "stale-hint" }],
    });
    expect(mocks.similar).toHaveBeenCalledTimes(1);
    mocks.graph = {
      centre: "note:b",
      nodes: [{ ...note, key: "note:b" }],
      edges: [],
    };
    await render();
    mocks.graph = { centre: "note:c", nodes: [note], edges: [] };
    await render();
    expect(mocks.similar).toHaveBeenCalledTimes(3);
  });

  it.each([
    null,
    "other-reader",
  ])("rejects delayed hints after logout/session change to %s", async (session) => {
    let finish: (hints: { key: string }[]) => void = () => {};
    mocks.similar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    mocks.session = session;
    await render();
    await act(async () => finish([{ key: "old-reader-hint" }]));
    expect(mocks.graphArgs.at(-1)).not.toMatchObject({
      similar: [{ key: "old-reader-hint" }],
    });
  });
  it("never activates results for the previous debounced term", async () => {
    vi.useFakeTimers();
    try {
      mocks.search = [{ key: "note:old", kind: "note", label: "Old result" }];
      await render();
      const input = host.querySelector("input");
      if (!input) throw new Error("Missing idea search input");
      const type = async (value: string) =>
        act(async () => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set?.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      await type("old");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(210);
      });
      expect(host.textContent).toContain("Old result");
      await type("new");
      const before = mocks.graphArgs.at(-1);
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
      expect(mocks.graphArgs.at(-1)).toEqual(before);
      expect(input.value).toBe("new");
      expect(host.textContent).not.toContain("Old result");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses neighbours on A to B to A and invalidates an edited centre", async () => {
    mocks.similar.mockClear();
    await render();
    mocks.graph = {
      centre: "note:b",
      nodes: [{ ...note, key: "note:b" }],
      edges: [],
    };
    await render();
    mocks.graph = { centre: "note:c", nodes: [note], edges: [] };
    await render();
    expect(mocks.similar).toHaveBeenCalledTimes(2);
    mocks.graph = {
      centre: "note:c",
      nodes: [{ ...note, label: "Edited" }],
      edges: [],
    };
    await render();
    expect(mocks.similar).toHaveBeenCalledTimes(3);
  });
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
    const remoteCache = new SessionCache<number>(20, 60_000);
    remoteCache.forScope("remote-reader");
    remoteCache.set("centre", 1);
    const off = tabs.remote.subscribe(() => remoteCache.invalidate());
    mocks.write.mockResolvedValue("note:new");
    await render();
    await saveConnectedNote();
    expect(mocks.write).toHaveBeenCalledWith({
      from: "note:c",
      content: "<p>If the schedule does the work</p>",
      contentPlain: "If the schedule does the work",
      prompt: undefined,
    });
    expect(host.textContent).toContain("Saved. Your note is on the map.");
    expect(tabs.sent).toHaveLength(1);
    expect(remoteCache.get("centre")).toBeUndefined();
    off();
    // The map is asked to keep the new note on it
    expect(mocks.graphArgs.at(-1)).toMatchObject({ pin: "note:new" });
  });

  it("does not send invalidation after a failed connected-note save", async () => {
    mocks.write.mockRejectedValue(new Error("fixture save failed"));
    await render();
    await saveConnectedNote();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(tabs.sent).toHaveLength(0);
    expect(host.querySelector("textarea")?.value).toBe(
      "If the schedule does the work",
    );
  });

  it("removes the graph invalidation listener on unmount", async () => {
    const subscribe = discoveryInvalidation.subscribe;
    const cleanup = vi.fn();
    const spy = vi
      .spyOn(discoveryInvalidation, "subscribe")
      .mockImplementationOnce((listener) => {
        const off = subscribe(listener);
        return () => {
          off();
          cleanup();
        };
      });
    await render();
    await act(async () => root.render(null));
    expect(cleanup).toHaveBeenCalledTimes(1);
    await act(async () => tabs.remote.publish());
    expect(cleanup).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("opens an article as its title and one point, with a link to read it", async () => {
    mocks.node = {
      key: "article:a",
      kind: "article",
      text: "Interruptions cost more than the minutes lost.",
      createdAt: 1,
      canWrite: true,
      articleId: "art1",
      articleTitle: "The quiet cost",
    };
    await render();
    expect(host.textContent).toContain("The quiet cost");
    expect(host.textContent).toContain("Interruptions cost more");
    expect(host.querySelector('a[href="/read/art1"]')?.textContent).toBe(
      "Open article",
    );
    expect(host.textContent).not.toContain("Reply");
    expect(host.textContent).toContain("New connected note");
  });

  it("sizes the map to its container once it appears, so a phone gets a phone-sized map", async () => {
    const watchers: ((entries: unknown[]) => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: unknown[]) => void) {
          watchers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    // The map isn't there on the first render: the notes are still loading
    mocks.graph = undefined;
    await render();
    expect(host.querySelector("svg")).toBeNull();
    mocks.graph = { centre: "note:c", nodes: [note], edges: [] };
    await render();
    expect(host.querySelector("svg")?.getAttribute("width")).toBe("770");
    await act(async () => {
      for (const watch of watchers) watch([{ contentRect: { width: 350 } }]);
    });
    expect(host.querySelector("svg")?.getAttribute("width")).toBe("350");
  });

  it("recentres a vault idea from the passage that matched, not the file's opening", async () => {
    mocks.similar.mockClear();
    mocks.graph = {
      centre: "vault:v/x.md",
      nodes: [
        {
          key: "vault:v/x.md",
          kind: "vault",
          label: "x",
          hop: 0,
          createdAt: 1,
          via: "chunk2",
        },
      ],
      edges: [],
    };
    await render();
    expect(mocks.similar).toHaveBeenCalledWith({
      key: "vault:v/x.md",
      via: "chunk2",
    });
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
