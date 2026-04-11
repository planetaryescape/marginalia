"use client";
import DOMPurify from "isomorphic-dompurify";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { NoteEditor } from "./note-editor";
import { motion, AnimatePresence } from "framer-motion";

interface NotesPanelProps {
  articleId: string;
  isOpen: boolean;
  onClose: () => void;
  pendingSelection: { text: string; startOffset?: number; endOffset?: number } | null;
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
    articleId: articleId as any,
  });
  const createNote = useMutation(api.userNotes.create);
  const removeNote = useMutation(api.userNotes.remove);
  const [editingNew, setEditingNew] = useState(false);

  const showEditor = editingNew || pendingSelection;
  const selectionText = pendingSelection?.text || "";

  const handleSave = async (content: string, plainText: string) => {
    await createNote({
      articleId: articleId as any,
      selectedText: selectionText,
      selectedStartOffset: pendingSelection?.startOffset,
      selectedEndOffset: pendingSelection?.endOffset,
      content,
      contentPlain: plainText,
    });
    setEditingNew(false);
    onClearSelection();
  };

  const handleCancel = () => {
    setEditingNew(false);
    onClearSelection();
  };

  const handleDelete = async (noteId: string) => {
    await removeNote({ noteId: noteId as any });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 250 }}
          className="fixed top-0 right-0 h-full w-[380px] max-w-[85vw] z-50 border-l border-ink-200 dark:border-ink-800 bg-parchment-50 dark:bg-ink-950 shadow-2xl shadow-black/20 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200 dark:border-ink-800">
            <h2 className="text-sm font-sans font-semibold text-ink-800 dark:text-parchment-200">
              Notes
            </h2>
            <div className="flex items-center gap-2">
              {!showEditor && (
                <button
                  onClick={() => setEditingNew(true)}
                  className="text-xs font-sans text-annotation-crossref hover:underline"
                >
                  + New
                </button>
              )}
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-400 hover:text-ink-600 dark:hover:text-ink-300 transition-colors"
              >
                &times;
              </button>
            </div>
          </div>

          {/* Note editor */}
          {showEditor && (
            <div className="border-b border-ink-200 dark:border-ink-800">
              <NoteEditor
                selectedText={selectionText}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            </div>
          )}

          {/* Existing notes */}
          <div className="flex-1 overflow-y-auto">
            {notes && notes.length === 0 && !showEditor && (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-sans text-ink-400 dark:text-ink-500">
                  No notes yet.
                </p>
                <p className="text-xs font-sans text-ink-300 dark:text-ink-600 mt-1">
                  Highlight text in the article to start a note.
                </p>
              </div>
            )}

            {notes?.map((note) => (
              <div
                key={note._id}
                className="px-4 py-3 border-b border-ink-100 dark:border-ink-800 group"
              >
                {note.selectedText && (
                  <blockquote className="text-[11px] font-serif text-ink-500 dark:text-ink-400 border-l-2 border-ink-200 dark:border-ink-700 pl-2 mb-2 italic line-clamp-2">
                    {note.selectedText}
                  </blockquote>
                )}

                <div
                  className="text-sm font-sans text-ink-700 dark:text-parchment-300 leading-relaxed max-w-none
                    [&_strong]:font-semibold [&_em]:italic [&_ul]:list-disc [&_ul]:pl-4 [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-ink-500"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(note.content),
                  }}
                />

                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] font-sans text-ink-300 dark:text-ink-600">
                    {new Date(note.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    onClick={() => handleDelete(note._id)}
                    className="opacity-0 group-hover:opacity-100 text-[10px] font-sans text-ink-300 hover:text-annotation-tension transition-all"
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
