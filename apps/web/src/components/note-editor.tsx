"use client";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

const AUTOSAVE_DELAY_MS = 700;

interface NoteEditorProps {
  selectedText: string;
  /** Called after a pause in typing, and once more on close if anything is unsaved. */
  onAutosave: (content: string, plainText: string) => void;
  onClose: () => void;
  status: "idle" | "saving" | "saved";
  initialContent?: string;
}

export function NoteEditor({
  selectedText,
  onAutosave,
  onClose,
  status,
  initialContent,
}: NoteEditorProps) {
  const timer = useRef<number | null>(null);
  const pending = useRef<{ html: string; plain: string } | null>(null);
  const onAutosaveRef = useRef(onAutosave);
  onAutosaveRef.current = onAutosave;

  const flush = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      onAutosaveRef.current(pending.current.html, pending.current.plain);
      pending.current = null;
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Save whatever is left when the editor goes away
  useEffect(() => () => flushRef.current(), []);

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
      pending.current = { html: editor.getHTML(), plain: editor.getText() };
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => flushRef.current(),
        AUTOSAVE_DELAY_MS,
      );
    },
    onBlur: () => flushRef.current(),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Your note",
        "aria-multiline": "true",
        class:
          "min-h-[120px] max-h-[300px] overflow-y-auto px-4 py-3 font-sans text-sm text-ink-800 dark:text-parchment-200 leading-relaxed focus:outline-none",
      },
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Selected text context */}
      <div className="px-4 py-3 border-b border-ink-100 dark:border-ink-800">
        <p className="text-[10px] font-sans font-semibold text-ink-400 dark:text-ink-500 uppercase tracking-wider mb-1.5">
          Highlighting
        </p>
        <blockquote className="text-xs font-serif text-ink-600 dark:text-ink-400 leading-relaxed line-clamp-3 border-l-2 border-annotation-crossref pl-3 italic">
          {selectedText}
        </blockquote>
      </div>

      {/* Editor */}
      <div className="flex-1 border-b border-ink-100 dark:border-ink-800">
        <EditorContent editor={editor} />
      </div>

      {/* Toolbar */}
      {editor && (
        <div className="px-3 py-2 flex items-center gap-1 border-b border-ink-100 dark:border-ink-800">
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
          className="text-[11px] font-sans text-ink-400 dark:text-ink-500"
          aria-live="polite"
        >
          {status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Saved"
              : "Saves as you type"}
        </span>
        <button
          type="button"
          onClick={() => {
            flush();
            onClose();
          }}
          className="text-xs font-sans text-ink-500 hover:text-ink-700 dark:hover:text-ink-300 transition-colors"
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
      className={`w-7 h-7 flex items-center justify-center rounded text-xs font-sans transition-colors
        ${active ? "bg-ink-200 dark:bg-ink-700 text-ink-900 dark:text-parchment-100" : "text-ink-400 hover:text-ink-600 dark:hover:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800"}`}
    >
      {children}
    </button>
  );
}
