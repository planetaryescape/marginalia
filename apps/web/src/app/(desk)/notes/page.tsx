"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DeskPage } from "@/components/desk-page";
import { KeptTranscript } from "@/components/kept-transcript";
import { MODE_LABELS } from "@/lib/margin-answers";
import { groupByArticle, type KeptThread } from "@/lib/notes-groups";

export default function NotesPage() {
  const notes = useQuery(api.userNotes.listAll);
  const kept = useQuery(api.companionThreads.listKept);
  const removeNote = useMutation(api.userNotes.remove);
  const removeThread = useMutation(api.companionThreads.remove);

  const groups = notes && kept ? groupByArticle(notes, kept) : undefined;

  return (
    <DeskPage title="Your notes">
      {groups === undefined && (
        <p role="status" className="text-sm text-[var(--reader-muted)]">
          Loading notes…
        </p>
      )}

      {groups?.length === 0 && (
        <div className="text-center py-16">
          <p className="text-[var(--reader-muted)] text-sm">
            No notes yet. Highlight text while reading to create notes.
          </p>
        </div>
      )}

      {groups?.map((group) => (
        <ArticleNotesGroup
          key={group.articleId}
          articleId={group.articleId}
          notes={group.notes}
          answers={group.answers}
          onDelete={(noteId) =>
            removeNote({ noteId }).catch(() =>
              toast.error("Couldn't delete the note. Try again."),
            )
          }
          onDeleteAnswer={(threadId) =>
            removeThread({ threadId }).catch(() =>
              toast.error("Couldn't delete the answer. Try again."),
            )
          }
        />
      ))}
    </DeskPage>
  );
}

function ArticleNotesGroup({
  articleId,
  notes,
  answers,
  onDelete,
  onDeleteAnswer,
}: {
  articleId: Id<"articles">;
  notes: Doc<"userNotes">[];
  answers: KeptThread[];
  onDelete: (noteId: Id<"userNotes">) => void;
  onDeleteAnswer: (threadId: Id<"companionThreads">) => void;
}) {
  const article = useQuery(api.articles.getById, {
    articleId,
  });

  return (
    <div className="mb-10">
      <div className="mb-4">
        <Link
          href={`/read/${articleId}`}
          className="text-xl font-serif text-[var(--reader-fg)] hover:underline hover:decoration-[var(--pencil-rule)] underline-offset-4 transition-colors"
        >
          {article?.title || "Loading..."}
        </Link>
        {article?.author && (
          <p className="text-xs text-[var(--reader-muted)] mt-0.5">
            {article.author}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {notes.map((note) => {
          return (
            <div
              key={note._id}
              className="p-4 rounded-xl border border-[var(--reader-border)] bg-[var(--reader-surface)] group"
            >
              {note.selectedText && (
                <Link href={`/read/${articleId}`} className="block mb-2">
                  <blockquote className="text-sm font-serif text-[var(--reader-muted)] border-l border-[var(--reader-border-strong)] pl-3 italic line-clamp-2 hover:text-[var(--reader-fg)] transition-colors">
                    {note.selectedText}
                  </blockquote>
                </Link>
              )}

              <div className="text-sm text-[var(--reader-fg-soft)] leading-relaxed whitespace-pre-wrap break-words">
                <span>{note.contentPlain}</span>
              </div>

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--reader-border)]">
                <span className="text-[11px] text-[var(--reader-muted)]">
                  {new Date(note.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(note._id)}
                  className="md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-[12px] text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-opacity"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {answers.map((thread) => (
          <KeptAnswerRow
            key={thread._id}
            thread={thread}
            articleId={articleId}
            onDelete={() => onDeleteAnswer(thread._id)}
          />
        ))}
      </div>
    </div>
  );
}

/** One of Marginalia's answers the reader kept: a pencil line that opens in place. */
function KeptAnswerRow({
  thread,
  articleId,
  onDelete,
}: {
  thread: KeptThread;
  articleId: Id<"articles">;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <div data-hand="pencil" className="px-1 group">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 py-2 text-left text-[13px] text-[var(--pencil)]"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        Marginalia&rsquo;s answer &middot; {MODE_LABELS[thread.mode]}
      </button>
      {open && (
        <div className="pb-3 pl-4">
          {thread.selection && (
            <Link href={`/read/${articleId}`} className="block mb-2">
              <blockquote className="text-sm font-serif text-[var(--ink-muted)] border-l border-[var(--reader-border-strong)] pl-3 italic line-clamp-2">
                {thread.selection}
              </blockquote>
            </Link>
          )}
          <KeptTranscript
            thread={thread}
            onJump={() => router.push(`/read/${articleId}`)}
          />
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={onDelete}
              className="md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-[12px] text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-opacity"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
