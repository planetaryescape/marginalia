// @vitest-environment happy-dom
import { act, type PropsWithChildren, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesPanel } from "./notes-panel";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  editor: null as null | {
    selectedText: string;
    onAutosave: (html: string, plain: string) => Promise<boolean>;
  },
  draft: null as null | { html: string; plain: string },
  flushOk: true,
}));

vi.mock("@/lib/topic-search-cache", () => ({
  invalidateTopicSearchCache: mocks.invalidate,
}));

vi.mock("convex/react", () => ({
  useQuery: () => [],
  useMutation: (ref: string) => (mocks as never)[ref],
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    userNotes: {
      listByArticle: "x",
      create: "create",
      update: "update",
      remove: "remove",
    },
    companionThreads: { listByArticle: "x", remove: "removeThread" },
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
// The real editor is TipTap; the panel only depends on its props and flush contract.
vi.mock("./note-editor", () => ({
  NoteEditor: (props: {
    selectedText: string;
    onAutosave: (html: string, plain: string) => Promise<boolean>;
    onFlushReady: (f: (() => Promise<boolean>) | null) => void;
  }) => {
    mocks.editor = props;
    const { onFlushReady, onAutosave } = props;
    useEffect(() => {
      onFlushReady(async () => {
        if (!mocks.flushOk) return false;
        const draft = mocks.draft;
        mocks.draft = null;
        return draft ? onAutosave(draft.html, draft.plain) : true;
      });
      return () => onFlushReady(null);
    }, [onFlushReady, onAutosave]);
    return (
      <div data-testid="editor">
        {props.selectedText}
        <textarea aria-label="Draft fixture" defaultValue="" />
      </div>
    );
  },
}));

let root: Root;
const onClose = vi.fn();
const onClear = vi.fn();
type Sel = { text: string } | null;
async function render(isOpen: boolean, pendingSelection: Sel = null) {
  await act(async () =>
    root.render(
      <>
        <main id="article">
          <p>Article text</p>
        </main>
        <NotesPanel
          articleId="a1"
          isOpen={isOpen}
          onClose={onClose}
          pendingSelection={pendingSelection}
          onClearSelection={onClear}
        />
      </>,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML =
    '<button id="opener">Notes</button><div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  mocks.create
    .mockReset()
    .mockResolvedValueOnce("n1")
    .mockResolvedValueOnce("n2");
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.invalidate.mockReset();
  mocks.draft = null;
  mocks.flushOk = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.notesOpen;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("non-modal pane", () => {
  it("leaves the article interactive and flags the root while open", async () => {
    await render(true);
    expect(document.querySelector("dialog")).toBeNull();
    const pane = document.querySelector("aside[aria-label='Article notes']");
    expect(pane).not.toBeNull();
    expect(document.querySelector("#article")?.closest("[inert]")).toBeNull();
    expect(document.documentElement.dataset.notesOpen).toBe("");
    await render(false);
    expect(document.documentElement.dataset.notesOpen).toBeUndefined();
    expect(document.querySelector("aside")).toBeNull();
  });

  it("returns focus to the opener on close", async () => {
    const opener = document.getElementById("opener")!;
    opener.focus();
    await render(true);
    expect(document.activeElement).not.toBe(opener);
    await render(false);
    expect(document.activeElement).toBe(opener);
  });

  it("does not pull focus back if the reader moved on to the article", async () => {
    const opener = document.getElementById("opener")!;
    opener.focus();
    await render(true);
    const para = document.getElementById("article")!;
    para.tabIndex = -1;
    para.focus();
    await render(false);
    expect(document.activeElement).toBe(para);
  });

  it("closes on Escape inside the pane, after the editor flushes", async () => {
    await render(true, { text: "A" });
    mocks.draft = { html: "<p>x</p>", plain: "x" };
    await act(async () => {
      document
        .querySelector("[data-testid=editor]")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when the flush fails", async () => {
    await render(true, { text: "A" });
    mocks.flushOk = false;
    await act(async () => {
      document
        .querySelector("[data-testid=editor]")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores Escape pressed in the article", async () => {
    await render(true, { text: "A" });
    await act(async () => {
      document
        .querySelector("#article p")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a new selection while a draft is open", () => {
  it("keeps the lazy editor's unsaved DOM and focus through parent and autosave-status updates", async () => {
    await render(true, { text: "A" });
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Draft fixture"]',
    )!;
    textarea.value = "Unsent words";
    textarea.focus();
    await render(true, { text: "A" });
    await act(async () => {
      await mocks.editor!.onAutosave(
        "<p>Saved earlier words</p>",
        "Saved earlier words",
      );
    });
    expect(document.querySelector('textarea[aria-label="Draft fixture"]')).toBe(
      textarea,
    );
    expect(textarea.value).toBe("Unsent words");
    expect(document.activeElement).toBe(textarea);
  });
  it("invalidates only acknowledged creates, updates and deletes, never failed saves", async () => {
    let acknowledge: (id: string) => void = () => {};
    mocks.create.mockReset().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          acknowledge = resolve;
        }),
    );
    await render(true, { text: "A" });
    const editor = mocks.editor;
    if (!editor) throw new Error("Missing editor");
    let pending: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      pending = editor.onAutosave("<p>saved</p>", "saved");
    });
    expect(mocks.invalidate).not.toHaveBeenCalled();
    await act(async () => {
      acknowledge("n1");
      expect(await pending).toBe(true);
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    mocks.update.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      expect(await editor.onAutosave("<p>changed</p>", "changed")).toBe(false);
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await editor.onAutosave("<p>changed</p>", "changed")).toBe(true);
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
    await act(async () => {
      expect(await editor.onAutosave("", "")).toBe(true);
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
    expect(mocks.remove).toHaveBeenCalledWith({ noteId: "n1" });
  });
  it("saves A under A, then starts B as a separate note", async () => {
    await render(true, { text: "A" });
    mocks.draft = { html: "<p>note a</p>", plain: "note a" };
    await render(true, { text: "B" });

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      selectedText: "A",
      contentPlain: "note a",
    });
    expect(document.querySelector("[data-testid=editor]")?.textContent).toBe(
      "B",
    );

    await act(async () => {
      await mocks.editor!.onAutosave("<p>note b</p>", "note b");
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0]).toMatchObject({
      selectedText: "B",
      contentPlain: "note b",
    });
  });

  it("keeps A open and unsaved text intact when A's save fails", async () => {
    await render(true, { text: "A" });
    mocks.flushOk = false;
    await render(true, { text: "B" });
    expect(document.querySelector("[data-testid=editor]")?.textContent).toBe(
      "A",
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("switches straight over when no draft is open", async () => {
    await render(true);
    await render(true, { text: "B" });
    expect(document.querySelector("[data-testid=editor]")?.textContent).toBe(
      "B",
    );
  });
});
