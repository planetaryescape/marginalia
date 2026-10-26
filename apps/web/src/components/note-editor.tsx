"use client";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createNoteAutosave } from "@/lib/note-autosave";

const AUTOSAVE_DELAY_MS = 700;

interface NoteEditorProps {
  selectedText: string;
  /** Called after a pause in typing, and once more on close if anything is unsaved. */
  onAutosave: (content: string, plainText: string) => Promise<boolean>;
  onClose: () => void;
  status: "idle" | "saving" | "saved" | "error";
  onFlushReady?: (flush: (() => Promise<boolean>) | null) => void;
  initialContent?: string;
}

export function NoteEditor({
  selectedText,
  onAutosave,
  onClose,
  status,
  initialContent,
  onFlushReady,
}: NoteEditorProps) {
  const timer = useRef<number | null>(null);
  const onAutosaveRef = useRef(onAutosave);
  useLayoutEffect(() => {
    onAutosaveRef.current = onAutosave;
  }, [onAutosave]);
  const [autosave] = useState(() =>
    createNoteAutosave((draft) =>
      onAutosaveRef.current(draft.html, draft.plain),
    ),
  );

  const flush = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    return autosave.flush();
  }, [autosave]);

  // Save whatever is left when the editor goes away
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );
  useEffect(() => {
    onFlushReady?.(flush);
    return () => onFlushReady?.(null);
  }, [onFlushReady, flush]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!autosave.hasPending()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [autosave]);

  const editor = useEditor({
    // The page is server-rendered; rendering on the client only avoids hydration mismatches
    immediatelyRender: false,
    // The editor only mounts when you start a note, so put the cursor in it straight away
    autofocus: "end",
    extensions: [
      StarterKit.configure({
        heading: { levels: [3] },
      }),
      Placeholder.configure({
        placeholder: "Write your thoughts...",
      }),
    ],
    content: initialContent || "",
    onUpdate: ({ editor }) => {
      autosave.change({ html: editor.getHTML(), plain: editor.getText() });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(), AUTOSAVE_DELAY_MS);
    },
    onBlur: () => flush(),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Your note",
        "aria-multiline": "true",
        class:
          "min-h-[120px] max-h-[300px] overflow-y-auto px-4 py-3 font-sans text-sm text-[var(--reader-fg)] leading-relaxed focus:outline-none",
      },
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Selected text context */}
      {selectedText && (
        <div className="px-4 py-3 border-b border-[var(--reader-border)]">
          <p className="text-[11px] font-sans font-semibold text-[var(--reader-muted)] mb-1.5">
            On this passage
          </p>
          <blockquote className="text-xs font-serif text-[var(--reader-fg-soft)] leading-relaxed line-clamp-3 border-l border-[var(--reader-border-strong)] pl-3 italic">
            {selectedText}
          </blockquote>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 border-b border-[var(--reader-border)]">
        <EditorContent editor={editor} />
      </div>

      {/* Toolbar */}
      {editor && (
        <div className="px-3 py-2 flex items-center gap-1 border-b border-[var(--reader-border)]">
          <ToolbarButton
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            label="Bullet list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            &bull;
          </ToolbarButton>
          <ToolbarButton
            label="Block quote"
            active={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            &ldquo;
          </ToolbarButton>
        </div>
      )}

      {/* Autosave status */}
      <div className="px-4 py-2.5 flex items-center justify-between">
        <span
          className="text-[11px] font-sans text-[var(--reader-muted)]"
          aria-live="polite"
        >
          {status === "error"
            ? "Not saved. Your draft is still here."
            : status === "saving"
              ? "Saving…"
              : status === "saved"
                ? "Saved"
                : "Saves as you type"}
        </span>
        {status === "error" && (
          <button
            type="button"
            onClick={() => flush()}
            className="text-xs quiet-link"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            if (await flush()) onClose();
          }}
          className="text-xs font-sans text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded text-xs font-sans transition-colors
        ${active ? "bg-[var(--reader-chip)] text-[var(--reader-fg)]" : "text-[var(--reader-muted)] hover:text-[var(--reader-fg)] hover:bg-[var(--reader-chip)]"}`}
    >
      {children}
    </button>
  );
}
