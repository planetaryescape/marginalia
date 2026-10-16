// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesPanel } from "./notes-panel";

const mocks = vi.hoisted(() => ({
  notes: [] as unknown[],
  threads: [] as unknown[],
  removeThread: vi.fn(),
  removeNote: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: string) => (mocks as never)[ref],
  useMutation: (ref: string) => (mocks as never)[ref],
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    userNotes: {
      listByArticle: "notes",
      create: "createNote",
      update: "updateNote",
      remove: "removeNote",
    },
    companionThreads: { listByArticle: "threads", remove: "removeThread" },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: PropsWithChildren) => children,
  motion: {
    aside: ({
      children,
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      ...props
    }: PropsWithChildren<Record<string, unknown>>) => (
      <aside {...props}>{children}</aside>
    ),
  },
}));
vi.mock("./note-editor", () => ({ NoteEditor: () => null }));

const note = (over: Record<string, unknown>) => ({
  _id: "n1",
  selectedText: "",
  content: "<p>My own thought</p>",
  contentPlain: "My own thought",
  createdAt: 1000,
  ...over,
});
const thread = (over: Record<string, unknown>) => ({
  _id: "t1",
  mode: "define",
  selection: "tarn",
  turns: [{ role: "assistant", content: "A small mountain lake." }],
  createdAt: 2000,
  updatedAt: 2000,
  ...over,
});

let root: Root;
let host: HTMLElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  mocks.notes = [];
  mocks.threads = [];
  mocks.removeThread.mockReset();
  mocks.removeNote.mockReset();
});

async function render() {
  await act(async () =>
    root.render(
      <NotesPanel
        articleId="a1"
        isOpen
        onClose={() => {}}
        pendingSelection={null}
        onClearSelection={() => {}}
      />,
    ),
  );
}
const answerLines = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-hand="pencil"] button'));

describe("notes pane: your notes and Marginalia's kept answers", () => {
  it("sets your note in ink with a pen rule, ahead of kept answers", async () => {
    mocks.notes = [note({})];
    mocks.threads = [thread({ keptAt: 5000 })];
    await render();
    const mine = host.querySelector('[data-hand="pen"]') as HTMLElement;
    expect(mine.textContent).toBe("My own thought");
    expect(mine.className).toContain("text-[15px]");
    expect(mine.className).toContain("border-l-2");
    expect(mine.className).toContain("var(--pen)");
    const order = Array.from(
      host.querySelectorAll("[data-hand]"),
      (el) => (el as HTMLElement).dataset.hand,
    );
    expect(order).toEqual(["pen", "pencil"]);
  });

  it("folds a kept answer to one pencil line and opens it on click", async () => {
    mocks.threads = [thread({ keptAt: 5000 })];
    await render();
    const [line] = answerLines();
    expect(line.textContent).toContain("Marginalia’s answer · Define");
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("A small mountain lake.");
    await act(async () => line.click());
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("A small mountain lake.");
    expect(host.textContent).toContain("tarn");
  });

  it("leaves threads saved before Keep existed out of the pane", async () => {
    mocks.threads = [thread({})];
    await render();
    expect(answerLines()).toHaveLength(0);
  });

  it("folds the old Add-to-notes copy by its shape", async () => {
    mocks.notes = [
      note({
        _id: "n2",
        selectedText: "a tarn",
        content: "<h3>Define</h3><p>A small mountain lake.</p>",
        contentPlain: "Define\n\nA small mountain lake.",
      }),
    ];
    await render();
    expect(host.querySelector('[data-hand="pen"]')).toBeNull();
    expect(answerLines()[0].textContent).toContain("Define");
  });

  it("recognises a question heading only when a saved thread asked it", async () => {
    const copy = note({
      _id: "n3",
      selectedText: "a tarn",
      content: "<h3>What is a tarn?</h3><p>A lake.</p>",
      contentPlain: "What is a tarn?\n\nA lake.",
    });
    mocks.notes = [copy];
    await render();
    expect(answerLines()).toHaveLength(0);
    mocks.threads = [
      thread({ mode: "ask", question: "What is a tarn?", selection: "a tarn" }),
    ];
    await render();
    expect(answerLines()[0].textContent).toContain("Ask");
  });

  it("keeps your own note that opens with a heading as yours", async () => {
    mocks.notes = [
      note({
        content: "<h3>Plan</h3><p>Read chapter two.</p>",
        contentPlain: "Plan\n\nRead chapter two.",
      }),
    ];
    await render();
    expect(answerLines()).toHaveLength(0);
    expect(host.querySelector('[data-hand="pen"]')).not.toBeNull();
  });

  it("deletes a kept answer by removing its thread", async () => {
    mocks.threads = [thread({ keptAt: 5000 })];
    await render();
    await act(async () => answerLines()[0].click());
    const del = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete",
    ) as HTMLElement;
    await act(async () => del.click());
    expect(mocks.removeThread).toHaveBeenCalledWith({ threadId: "t1" });
  });
});
