// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sanitizer from "@/lib/sanitize";
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
  vi.restoreAllMocks();
});

async function render(onAnswerDeleted?: (id: string) => void) {
  await act(async () =>
    root.render(
      <NotesPanel
        articleId="a1"
        isOpen
        onClose={() => {}}
        pendingSelection={null}
        onClearSelection={() => {}}
        onAnswerDeleted={onAnswerDeleted}
      />,
    ),
  );
}
const answerLines = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-hand="pencil"] button'));

describe("notes pane: your notes and Marginalia's kept answers", () => {
  it("sanitizes only changed content and preserves unchanged prose DOM and selection across unrelated updates", async () => {
    mocks.notes = [
      note({
        content:
          "<p>My <strong>unchanged</strong> thought</p><img src=x onerror=alert(1)>",
      }),
    ];
    // Happy-dom does not implement DOMPurify's browser support checks. Verify
    // the panel renders the sanitizer's output, never the untrusted input.
    const sanitize = vi
      .spyOn(sanitizer, "sanitizeHtml")
      .mockReturnValueOnce(
        "<p>My <strong>unchanged</strong> thought</p><img src=x>",
      );
    await render();
    const strong = host.querySelector("strong")!;
    expect(strong).not.toBeNull();
    expect(host.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    const range = document.createRange();
    range.selectNodeContents(strong);
    window.getSelection()?.addRange(range);
    const before = sanitize.mock.calls.length;
    expect(sanitize.mock.calls[0][0]).toContain("onerror=");
    // New query row identity, but no presentation change.
    mocks.notes = [
      note({
        content:
          "<p>My <strong>unchanged</strong> thought</p><img src=x onerror=alert(1)>",
        updatedAt: 42,
      }),
    ];
    await render();
    expect(sanitize).toHaveBeenCalledTimes(before);
    expect(host.querySelector("strong")).toBe(strong);
    expect(window.getSelection()?.toString()).toBe("unchanged");
    mocks.notes = [note({ content: "<p>Changed text</p>" })];
    await render();
    expect(sanitize).toHaveBeenCalledTimes(before + 1);
    expect(host.textContent).toContain("Changed text");
    window.getSelection()?.removeAllRanges();
  });
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

  it("folds the old Add-to-notes copy when a saved thread on that passage confirms it", async () => {
    mocks.notes = [
      note({
        _id: "n2",
        selectedText: "tarn",
        content: "<h3>Define</h3><p>A small mountain lake.</p>",
        contentPlain: "Define\n\nA small mountain lake.",
      }),
    ];
    mocks.threads = [thread({})];
    await render();
    expect(host.querySelector('[data-hand="pen"]')).toBeNull();
    expect(answerLines()[0].textContent).toContain("Define");
  });

  it("keeps a reader's note under a mode-name heading as the reader's own when nothing confirms it", async () => {
    mocks.notes = [
      note({
        _id: "n2",
        selectedText: "tarn",
        content: "<h3>Explain</h3><p>My own reading of it.</p>",
        contentPlain: "Explain\n\nMy own reading of it.",
      }),
    ];
    // A Define thread on the same words does not vouch for an Explain heading
    mocks.threads = [thread({})];
    await render();
    expect(answerLines()).toHaveLength(0);
    expect(host.querySelector('[data-hand="pen"]')).not.toBeNull();
  });

  it("recognises a question heading only when a saved thread asked it", async () => {
    mocks.notes = [
      note({
        _id: "n3",
        selectedText: "a tarn",
        content: "<h3>What is a tarn?</h3><p>A small mountain lake.</p>",
        contentPlain: "What is a tarn?\n\nA small mountain lake.",
      }),
    ];
    await render();
    expect(answerLines()).toHaveLength(0);
    mocks.threads = [
      thread({ mode: "ask", question: "What is a tarn?", selection: "a tarn" }),
    ];
    await render();
    expect(answerLines()[0].textContent).toContain("Ask");
  });

  it("keeps a note under the right heading and passage as the reader's when its text is not the thread's answer", async () => {
    mocks.notes = [
      note({
        _id: "n4",
        selectedText: "tarn",
        content: "<h3>Define</h3><p>My own gloss, not the model&rsquo;s.</p>",
        contentPlain: "Define\n\nMy own gloss, not the model’s.",
      }),
    ];
    mocks.threads = [thread({})];
    await render();
    expect(answerLines()).toHaveLength(0);
    expect(host.querySelector('[data-hand="pen"]')).not.toBeNull();
  });

  it("folds a copy made before later follow-ups, and ignores spacing and markup", async () => {
    mocks.notes = [
      note({
        _id: "n5",
        selectedText: "tarn",
        content: "<h3>Define</h3><p>A small  mountain\nlake.</p>",
        contentPlain: "Define\n\nA small mountain lake.",
      }),
    ];
    mocks.threads = [
      thread({
        turns: [
          { role: "assistant", content: "A small mountain lake." },
          { role: "user", content: "More?" },
          { role: "assistant", content: "Often glacial." },
        ],
      }),
    ];
    await render();
    expect(answerLines()).toHaveLength(1);
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

  it("deletes a kept answer by removing its thread and tells the margin", async () => {
    mocks.threads = [thread({ keptAt: 5000 })];
    const deleted = vi.fn();
    await render(deleted);
    await act(async () => answerLines()[0].click());
    const del = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete",
    ) as HTMLElement;
    await act(async () => del.click());
    expect(mocks.removeThread).toHaveBeenCalledWith({ threadId: "t1" });
    expect(deleted).toHaveBeenCalledWith("t1");
  });
});
