"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sanitizeHtml } from "@/lib/sanitize";
import { useModalDialog } from "@/lib/use-modal-dialog";
import { NoteEditor } from "./note-editor";

interface NotesPanelProps {
  articleId: string;
  isOpen: boolean;
  onClose: () => void;
  pendingSelection: {
    text: string;
    startOffset?: number;
    endOffset?: number;
  } | null;
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef, isOpen);

  const showEditor = editingNew || pendingSelection;
  const selectionText = pendingSelection?.text || "";
  const pendingRef = useRef(pendingSelection);
  useLayoutEffect(() => {
    pendingRef.current = pendingSelection;
  }, [pendingSelection]);

  const handleAutosave = (
    content: string,
    plainText: string,
  ): Promise<boolean> => {
    // Capture the passage before closing or a new selection can change it.
    const selection = pendingRef.current;
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
    <dialog
      ref={dialogRef}
      aria-label="Article notes"
      onKeyDownCapture={(e) => {
        // ProseMirror handles Escape itself; close before its keymap consumes it.
        if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        void closePanel();
      }}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void closePanel();
      }}
      className="fixed top-[var(--app-viewport-top)] bottom-auto left-auto right-0 m-0 h-[var(--app-viewport-height)] max-h-none w-full max-w-none sm:w-[380px] sm:max-w-[90vw] overflow-hidden bg-transparent p-0 text-[var(--reader-fg)] backdrop:bg-black/20"
    >
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 250 }}
            className="h-full w-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] border-l border-[var(--reader-border)] bg-[var(--reader-bg)] shadow-2xl shadow-black/20 flex flex-col overflow-y-auto"
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
                    className="min-h-11 px-2 text-xs font-sans text-[var(--pen)] hover:underline"
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
                  key={selectionText}
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
    </dialog>
  );
}
