"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { sanitizeHtml } from "@/lib/sanitize";
import { NoteEditor } from "./note-editor";

type Selection = {
  text: string;
  startOffset?: number;
  endOffset?: number;
};

const sameSelection = (a: Selection | null, b: Selection | null) =>
  a?.text === b?.text &&
  a?.startOffset === b?.startOffset &&
  a?.endOffset === b?.endOffset;

// Phones get a bottom sheet, wider screens a docked side pane (matches the sm: classes).
// Only called while the pane is open, which never happens during server render.
const isPhone = () => window.matchMedia("(max-width: 639px)").matches;

interface NotesPanelProps {
  articleId: string;
  isOpen: boolean;
  onClose: () => void;
  pendingSelection: Selection | null;
  onClearSelection: () => void;
}

export function NotesPanel({
  articleId,
  isOpen,
  onClose,
  pendingSelection,
  onClearSelection,
}: NotesPanelProps) {
  const notes = useQuery(api.userNotes.listByArticle, {
    // SAFETY: the caller passes an article route ID; Convex's v.id validator enforces the table at the boundary.
    articleId: articleId as Id<"articles">,
  });
  const createNote = useMutation(api.userNotes.create);
  const updateNote = useMutation(api.userNotes.update);
  const removeNote = useMutation(api.userNotes.remove);
  const [editingNew, setEditingNew] = useState(false);
  const [draftId, setDraftId] = useState<Id<"userNotes"> | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const editorFlush = useRef<(() => Promise<boolean>) | null>(null);
  const registerFlush = useCallback(
    (flush: (() => Promise<boolean>) | null) => {
      editorFlush.current = flush;
    },
    [],
  );
  const closePanel = async () => {
    if (editorFlush.current && !(await editorFlush.current())) return;
    handleClose();
    onClose();
  };
  // Serialises saves so a slow create can't be followed by a second create
  const saving = useRef<Promise<Id<"userNotes"> | null>>(Promise.resolve(null));
  const paneRef = useRef<HTMLElement>(null);

  // The pane is non-modal so the article stays usable. A native <dialog> would
  // also trip the `dialog[open]` guards that mute shortcuts and card Escape.
  // The root attribute lets the reader make room for the docked pane.
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const opener = document.activeElement;
    root.dataset.notesOpen = "";
    paneRef.current?.focus({ preventScroll: true });
    return () => {
      delete root.dataset.notesOpen;
      // Only hand focus back if it was left in the pane (or nowhere); don't
      // pull it away from something the reader has since chosen.
      const current = document.activeElement;
      const stranded =
        !current ||
        current === document.body ||
        paneRef.current?.contains(current);
      if (stranded && opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, [isOpen]);

  // What the editor shows and saves into. It trails `pendingSelection` until the
  // draft for the previous passage has been saved, so those keystrokes can't be
  // filed under the new passage.
  const [activeSelection, setActiveSelection] = useState(pendingSelection);
  const activeRef = useRef(activeSelection);
  useLayoutEffect(() => {
    activeRef.current = activeSelection;
  }, [activeSelection]);
  const showEditor = editingNew || activeSelection;
  const selectionText = activeSelection?.text || "";
  const editorKey = `${selectionText}:${activeSelection?.startOffset}:${activeSelection?.endOffset}`;

  useEffect(() => {
    if (!pendingSelection || sameSelection(pendingSelection, activeRef.current))
      return;
    let stale = false;
    void (async () => {
      const flush = editorFlush.current;
      // A failed save keeps the current note open and unsaved text intact.
      if (flush && !(await flush())) return;
      if (stale) return;
      saving.current = saving.current.then(() => null);
      setDraftId(null);
      setStatus("idle");
      setEditingNew(false);
      setActiveSelection(pendingSelection);
    })();
    return () => {
      stale = true;
    };
  }, [pendingSelection]);

  const handleAutosave = (
    content: string,
    plainText: string,
  ): Promise<boolean> => {
    // Capture the passage before closing or a new selection can change it.
    const selection = activeRef.current;
    setStatus("saving");
    const queued = saving.current.then(async (id) => {
      try {
        if (!plainText.trim()) {
          // Emptied the editor: drop the draft rather than keep a blank note
          if (id) await removeNote({ noteId: id });
          setDraftId(null);
          setStatus("idle");
          return { id: null, ok: true };
        }
        if (id) {
          await updateNote({ noteId: id, content, contentPlain: plainText });
          setStatus("saved");
          return { id, ok: true };
        }
        const created = await createNote({
          // SAFETY: same article route ID, validated by the Convex mutation's v.id argument.
          articleId: articleId as Id<"articles">,
          selectedText: selection?.text ?? "",
          selectedStartOffset: selection?.startOffset,
          selectedEndOffset: selection?.endOffset,
          content,
          contentPlain: plainText,
        });
        setDraftId(created);
        setStatus("saved");
        return { id: created, ok: true };
      } catch {
        setStatus("error");
        toast.error("Couldn't save your note");
        return { id, ok: false };
      }
    });
    saving.current = queued.then((result) => result.id);
    return queued.then((result) => result.ok);
  };

  const handleClose = () => {
    // Let the final save land before the next note starts fresh
    saving.current = saving.current.then(() => null);
    setEditingNew(false);
    setDraftId(null);
    setStatus("idle");
    setActiveSelection(null);
    onClearSelection();
  };

  const handleDelete = async (noteId: Id<"userNotes">) => {
    try {
      await removeNote({ noteId });
    } catch {
      toast.error("Couldn't delete the note. Try again.");
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          ref={paneRef}
          tabIndex={-1}
          aria-label="Article notes"
          onKeyDownCapture={(e) => {
            // ProseMirror handles Escape itself; close before its keymap consumes it.
            if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            e.stopPropagation();
            void closePanel();
          }}
          initial={isPhone() ? { y: "100%" } : { x: "100%" }}
          animate={{ x: 0, y: 0 }}
          exit={isPhone() ? { y: "100%" } : { x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 250 }}
          className="fixed z-50 flex flex-col overflow-y-auto bg-[var(--reader-bg)] text-[var(--reader-fg)] shadow-2xl shadow-black/20 outline-none border-[var(--reader-border)] pb-[env(safe-area-inset-bottom)] inset-x-0 bottom-0 h-[calc(var(--app-viewport-height)*0.55)] rounded-t-2xl border-t sm:inset-x-auto sm:right-0 sm:bottom-auto sm:top-[var(--app-viewport-top)] sm:h-[var(--app-viewport-height)] sm:w-[380px] sm:rounded-none sm:border-t-0 sm:border-l sm:pt-[env(safe-area-inset-top)]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--reader-border)]">
            <h2 className="text-sm font-sans font-semibold text-[var(--reader-fg)]">
              Notes
            </h2>
            <div className="flex items-center gap-2">
              {!showEditor && (
                <button
                  type="button"
                  onClick={() => setEditingNew(true)}
                  className="min-h-11 sm:min-h-8 px-3 rounded-md border border-[var(--reader-border-strong)] text-xs font-sans text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--reader-chip)] transition-colors"
                >
                  + New
                </button>
              )}
              <button
                type="button"
                onClick={() => closePanel()}
                aria-label="Close notes"
                className="w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-full hover:bg-[var(--reader-chip)] text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-colors"
              >
                &times;
              </button>
            </div>
          </div>

          {/* Note editor */}
          {showEditor && (
            <div className="border-b border-[var(--reader-border)]">
              <NoteEditor
                key={editorKey}
                selectedText={selectionText}
                onAutosave={handleAutosave}
                onClose={handleClose}
                status={status}
                onFlushReady={registerFlush}
              />
            </div>
          )}

          {/* Existing notes */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {notes && notes.length === 0 && !showEditor && (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-sans text-[var(--reader-muted)]">
                  No notes yet.
                </p>
                <p className="text-xs font-sans text-[var(--reader-muted)] mt-1">
                  Highlight text in the article to start a note.
                </p>
              </div>
            )}

            {notes
              ?.filter((note) => !(showEditor && note._id === draftId))
              .map((note) => (
                <div
                  key={note._id}
                  className="px-4 py-3 border-b border-[var(--reader-border)] group"
                >
                  {note.selectedText && (
                    <blockquote className="text-[12px] font-serif text-[var(--reader-muted)] border-l border-[var(--reader-border-strong)] pl-2 mb-2 italic line-clamp-2">
                      {note.selectedText}
                    </blockquote>
                  )}

                  <div
                    className="text-sm font-sans text-[var(--reader-fg-soft)] leading-relaxed break-words max-w-none
                    [&_strong]:font-semibold [&_em]:italic [&_ul]:list-disc [&_ul]:pl-4 [&_blockquote]:border-l [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-[var(--reader-muted)]"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(note.content),
                    }}
                  />

                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] font-sans text-[var(--reader-muted)]">
                      {new Date(note.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <button
                      onClick={() => handleDelete(note._id)}
                      className="md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-[12px] font-sans text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-opacity"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
