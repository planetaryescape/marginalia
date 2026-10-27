"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { InlineError } from "@/components/in-place";
import { type KeptPreview, splitPreviewNotes } from "@/lib/kept-answers";
import { MODE_LABELS } from "@/lib/margin-answers";
import { sanitizeHtml } from "@/lib/sanitize";
import { invalidateTopicSearchCache } from "@/lib/topic-search-cache";
import { LazyKeptTranscript } from "./kept-transcript";

const loadNoteEditor = () => import("./note-editor");
const NoteEditor = lazy(() =>
  loadNoteEditor().then((module) => ({ default: module.NoteEditor })),
);

const NoteHtml = memo(function NoteHtml({
  content,
  legacy = false,
}: {
  content: string;
  legacy?: boolean;
}) {
  const html = useMemo(() => ({ __html: sanitizeHtml(content) }), [content]);
  return (
    <div
      data-hand={legacy ? undefined : "pen"}
      className={
        legacy
          ? "text-sm font-sans text-[var(--reader-fg-soft)] leading-relaxed break-words [&_h3]:font-medium"
          : "border-l-2 border-[var(--pen)] pl-3 text-[15px] font-sans text-[var(--ink)] leading-relaxed break-words max-w-none [&_strong]:font-semibold [&_em]:italic [&_ul]:list-disc [&_ul]:pl-4 [&_blockquote]:border-l [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-[var(--reader-muted)]"
      }
      dangerouslySetInnerHTML={html}
    />
  );
});

const LazyNoteHtml = memo(function LazyNoteHtml({
  id,
  legacy = false,
}: {
  id: Id<"userNotes">;
  legacy?: boolean;
}) {
  const body = useQuery(api.userNotes.getBody, { noteId: id });
  if (body === undefined) return <p role="status">Loading note…</p>;
  if (body === null)
    return <p role="status">This note is no longer available.</p>;
  return (
    <>
      {body.legacyOversized && (
        <p role="status">
          This older note is larger than the current save limit. The complete
          saved note is shown.
        </p>
      )}
      <NoteHtml content={body.content} legacy={legacy} />
    </>
  );
});

const NoteRow = memo(function NoteRow({
  id,
  selectedText,
  contentPlain,
  createdAt,
  onDelete,
  initiallyOpen,
}: {
  id: Id<"userNotes">;
  selectedText: string;
  contentPlain: string;
  createdAt: number;
  onDelete: (id: Id<"userNotes">) => void;
  initiallyOpen: boolean;
}) {
  const [chosenOpen, setOpen] = useState<boolean | null>(null);
  const open = chosenOpen ?? initiallyOpen;
  return (
    <div className="px-4 py-3 border-b border-[var(--reader-border)] group">
      {selectedText && (
        <blockquote className="text-[12px] font-serif text-[var(--ink-muted)] border-l border-[var(--reader-border-strong)] pl-2 mb-2 italic line-clamp-2">
          {selectedText}
        </blockquote>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-left w-full"
      >
        {open ? "Fold note" : contentPlain || "Open note"}
      </button>
      {open && <LazyNoteHtml id={id} />}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] font-sans text-[var(--reader-muted)]">
          {new Date(createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <button
          onClick={() => onDelete(id)}
          className="md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-[12px] font-sans text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-opacity"
        >
          Delete
        </button>
      </div>
    </div>
  );
});

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
  /** The part of a book on screen: its notes are the ones listed and written here. */
  unitIndex?: number;
  isOpen: boolean;
  onClose: () => void;
  pendingSelection: Selection | null;
  onClearSelection: () => void;
  /** Jumps to a ¶ cited in a kept answer. */
  onJump?: (index: number) => void;
  /** A kept answer's record was deleted here; the margin must drop it too. */
  onAnswerDeleted?: (recordId: string) => void;
  /** A Notes-page deep link explicitly opens just this note's body. */
  initialNoteId?: string | null;
  /** Lets another reader surface close Notes through its save-and-reset path. */
  onRegisterRequestClose?: (
    close: (isCurrent?: () => boolean) => Promise<boolean>,
  ) => void;
}

export function NotesPanel({
  articleId,
  unitIndex,
  isOpen,
  onClose,
  pendingSelection,
  onClearSelection,
  onJump = () => {},
  onAnswerDeleted,
  initialNoteId,
  onRegisterRequestClose,
}: NotesPanelProps) {
  const notes = usePaginatedQuery(
    api.userNotes.listPreviewsByArticle,
    isOpen
      ? {
          // SAFETY: the caller passes an article route ID; Convex's v.id validator enforces the table at the boundary.
          articleId: articleId as Id<"articles">,
          unitIndex,
        }
      : "skip",
    { initialNumItems: 25 },
  );
  const threads = usePaginatedQuery(
    api.companionThreads.listPreviewsByArticle,
    isOpen
      ? {
          // SAFETY: same article route ID, validated by the Convex query's v.id argument.
          articleId: articleId as Id<"articles">,
          unitIndex,
        }
      : "skip",
    { initialNumItems: 25 },
  );
  const linkedNote = useQuery(
    api.userNotes.getPreviewById,
    isOpen && initialNoteId
      ? {
          // SAFETY: a Notes-page route identifier; Convex validates the table and ownership.
          noteId: initialNoteId as Id<"userNotes">,
        }
      : "skip",
  );
  const removeThread = useMutation(api.companionThreads.remove);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const createNote = useMutation(api.userNotes.create);
  const updateNote = useMutation(api.userNotes.update);
  const removeNote = useMutation(api.userNotes.remove);
  const [editingNew, setEditingNew] = useState(false);
  // The draft owns its original scope even if navigation or a book-part switch
  // changes this panel's props before its first autosave/flush completes.
  const draftScope = useRef({ articleId, unitIndex });
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
  const closePanel = async (isCurrent?: () => boolean) => {
    if (editorFlush.current && !(await editorFlush.current())) return false;
    if (isCurrent && !isCurrent()) return false;
    handleClose();
    onClose();
    return true;
  };
  const closePanelRef = useRef(closePanel);
  useLayoutEffect(() => {
    closePanelRef.current = closePanel;
  });
  useEffect(() => {
    onRegisterRequestClose?.((isCurrent) => closePanelRef.current(isCurrent));
    return () => onRegisterRequestClose?.(() => Promise.resolve(true));
  }, [onRegisterRequestClose]);
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
  const [editorEpoch, setEditorEpoch] = useState(0);
  const activeRef = useRef(activeSelection);
  useLayoutEffect(() => {
    activeRef.current = activeSelection;
  }, [activeSelection]);
  const showEditor = editingNew || activeSelection;
  const selectionText = activeSelection?.text || "";
  const editorKey = `${editorEpoch}:${selectionText}:${activeSelection?.startOffset}:${activeSelection?.endOffset}`;

  useEffect(() => {
    if (
      !pendingSelection ||
      (sameSelection(pendingSelection, activeRef.current) &&
        draftScope.current.articleId === articleId &&
        draftScope.current.unitIndex === unitIndex)
    )
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
      draftScope.current = { articleId, unitIndex };
      setEditorEpoch((epoch) => epoch + 1);
      setActiveSelection(pendingSelection);
    })();
    return () => {
      stale = true;
    };
  }, [pendingSelection, articleId, unitIndex]);

  const handleAutosave = (
    content: string,
    plainText: string,
  ): Promise<boolean> => {
    // Capture the passage before closing or a new selection can change it.
    const selection = activeRef.current;
    const scope = draftScope.current;
    setStatus("saving");
    const queued = saving.current.then(async (id) => {
      try {
        if (!plainText.trim()) {
          // Emptied the editor: drop the draft rather than keep a blank note
          if (id) {
            await removeNote({ noteId: id });
            invalidateTopicSearchCache();
          }
          setDraftId(null);
          setStatus("idle");
          return { id: null, ok: true };
        }
        if (id) {
          await updateNote({ noteId: id, content, contentPlain: plainText });
          invalidateTopicSearchCache();
          setStatus("saved");
          return { id, ok: true };
        }
        const created = await createNote({
          // SAFETY: same article route ID, validated by the Convex mutation's v.id argument.
          articleId: scope.articleId as Id<"articles">,
          selectedText: selection?.text ?? "",
          selectedStartOffset: selection?.startOffset,
          selectedEndOffset: selection?.endOffset,
          unitIndex: scope.unitIndex,
          content,
          contentPlain: plainText,
        });
        invalidateTopicSearchCache();
        setDraftId(created);
        setStatus("saved");
        return { id: created, ok: true };
      } catch {
        // The editor shows the failure and its Retry
        setStatus("error");
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

  const { mine, answers } = useMemo(() => {
    const rows =
      linkedNote &&
      linkedNote.articleId === articleId &&
      linkedNote.unitIndex === unitIndex &&
      !notes.results.some((note) => note._id === linkedNote._id)
        ? [linkedNote, ...notes.results]
        : notes.results;
    return splitPreviewNotes(rows, threads.results);
  }, [notes.results, threads.results, linkedNote, articleId, unitIndex]);

  // A failed delete stays in the list with Retry, and the row stays where it was
  const [deleteFailure, setDeleteFailure] = useState<{
    message: string;
    retry: () => Promise<void>;
  } | null>(null);
  const [retryingDelete, setRetryingDelete] = useState(false);
  const attemptDelete = useCallback(
    async (message: string, run: () => Promise<void>) => {
      try {
        await run();
        invalidateTopicSearchCache();
        setDeleteFailure(null);
      } catch {
        setDeleteFailure({ message, retry: () => attemptDelete(message, run) });
      }
    },
    [],
  );

  const handleDeleteAnswer = (answer: KeptPreview) =>
    attemptDelete("Couldn't delete the answer.", async () => {
      if (answer.kind === "thread") {
        await removeThread({ threadId: answer.thread._id });
        onAnswerDeleted?.(answer.thread._id);
      } else await removeNote({ noteId: answer.note._id });
    });

  const handleDelete = useCallback(
    (noteId: Id<"userNotes">) => {
      void attemptDelete("Couldn't delete the note.", async () => {
        await removeNote({ noteId });
      });
    },
    [attemptDelete, removeNote],
  );

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
          className="fixed z-50 flex flex-col overflow-y-auto bg-[var(--reader-bg)] text-[var(--reader-fg)] shadow-2xl shadow-black/20 outline-none border-[var(--reader-border)] pb-[env(safe-area-inset-bottom)] inset-x-0 bottom-0 h-[calc(var(--app-viewport-height)*0.55)] rounded-t-lg border-t sm:inset-x-auto sm:right-0 sm:bottom-auto sm:top-[var(--app-viewport-top)] sm:h-[var(--app-viewport-height)] sm:w-[380px] sm:rounded-none sm:border-t-0 sm:border-l sm:pt-[env(safe-area-inset-top)]"
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
                  onClick={() => {
                    draftScope.current = { articleId, unitIndex };
                    setEditingNew(true);
                  }}
                  onPointerEnter={() => {
                    void loadNoteEditor();
                  }}
                  onFocus={() => {
                    void loadNoteEditor();
                  }}
                  className="min-h-11 sm:min-h-8 px-3 rounded-md bg-[var(--reader-chip)] text-xs font-sans text-[var(--reader-fg-soft)] hover:text-[var(--reader-fg)] transition-colors"
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
              {(draftScope.current.articleId !== articleId ||
                draftScope.current.unitIndex !== unitIndex) && (
                <p role="status" className="px-4 py-2 text-xs">
                  This draft still belongs to the previous article or part.
                </p>
              )}
              <Suspense fallback={<p role="status">Loading editor…</p>}>
                <NoteEditor
                  key={editorKey}
                  selectedText={selectionText}
                  onAutosave={handleAutosave}
                  onClose={handleClose}
                  status={status}
                  onFlushReady={registerFlush}
                />
              </Suspense>
            </div>
          )}

          {/* Existing notes */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {deleteFailure && (
              <div className="border-b border-[var(--reader-border)] px-4 py-3 text-sm">
                <InlineError
                  message={deleteFailure.message}
                  busy={retryingDelete}
                  onRetry={async () => {
                    setRetryingDelete(true);
                    await deleteFailure.retry();
                    setRetryingDelete(false);
                  }}
                />
              </div>
            )}
            {notes.status !== "LoadingFirstPage" &&
              threads.status !== "LoadingFirstPage" &&
              mine.length === 0 &&
              answers.length === 0 &&
              !showEditor && (
                <div className="px-4 py-12 text-center">
                  <p className="text-sm font-sans text-[var(--reader-muted)]">
                    No notes yet.
                  </p>
                  <p className="text-xs font-sans text-[var(--reader-muted)] mt-1">
                    Highlight text in the article to start a note.
                  </p>
                </div>
              )}

            {mine
              .filter((note) => !(showEditor && note._id === draftId))
              .map((note) => (
                <NoteRow
                  key={note._id}
                  id={note._id}
                  selectedText={note.selectedText}
                  contentPlain={note.contentPlain}
                  createdAt={note.createdAt}
                  onDelete={handleDelete}
                  initiallyOpen={note._id === initialNoteId}
                />
              ))}

            {answers.map((answer) => {
              const open = expanded.has(answer.id);
              const quote =
                answer.kind === "thread"
                  ? answer.thread.selection
                  : answer.note.selectedText;
              return (
                <div
                  key={answer.id}
                  data-hand="pencil"
                  className="px-4 py-2.5 border-b border-[var(--reader-border)] group"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (!next.delete(answer.id)) next.add(answer.id);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-1.5 text-left text-[13px] font-sans text-[var(--pencil)]"
                  >
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                    <span className="shrink-0">
                      Marginalia&rsquo;s answer &middot;{" "}
                      {MODE_LABELS[answer.mode]}
                    </span>
                    {/* What it answered, so a closed row says what it is about */}
                    {quote && (
                      <span className="min-w-0 truncate text-[var(--reader-muted)]">
                        {quote}
                      </span>
                    )}
                  </button>
                  {open && (
                    <div className="mt-2">
                      {quote && (
                        <blockquote className="text-[12px] font-serif text-[var(--ink-muted)] border-l border-[var(--reader-border-strong)] pl-2 mb-2 italic line-clamp-2">
                          {quote}
                        </blockquote>
                      )}
                      {answer.kind === "thread" ? (
                        <LazyKeptTranscript
                          threadId={answer.thread._id}
                          onJump={onJump}
                        />
                      ) : (
                        <LazyNoteHtml id={answer.note._id} legacy />
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[11px] font-sans text-[var(--reader-muted)]">
                          {new Date(answer.createdAt).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteAnswer(answer)}
                          className="md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-[12px] font-sans text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-opacity"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {[notes, threads].some(
              (collection) => collection.status === "CanLoadMore",
            ) && (
              <button
                type="button"
                className="p-4 underline"
                onClick={() => {
                  for (const collection of [notes, threads])
                    if (collection.status === "CanLoadMore")
                      collection.loadMore(25);
                }}
              >
                Show more notes
              </button>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
