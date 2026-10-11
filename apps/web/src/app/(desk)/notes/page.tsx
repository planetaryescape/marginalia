"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { toast } from "sonner";
import { DeskPage } from "@/components/desk-page";

export default function NotesPage() {
  const notes = useQuery(api.userNotes.listAll);
  const removeNote = useMutation(api.userNotes.remove);

  // Group notes by article
  const grouped = notes?.reduce<Record<string, Doc<"userNotes">[]>>(
    (acc, note) => {
      const key = note.articleId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(note);
      return acc;
    },
    {},
  );

  return (
    <DeskPage title="Your notes">
      {notes === undefined && (
        <p role="status" className="text-sm text-[var(--reader-muted)]">
          Loading notes…
        </p>
      )}

      {notes && notes.length === 0 && (
        <div className="text-center py-16">
          <p className="text-[var(--reader-muted)] text-sm">
            No notes yet. Highlight text while reading to create notes.
          </p>
        </div>
      )}

      {grouped &&
        Object.entries(grouped).map(([articleId, articleNotes]) => (
          <ArticleNotesGroup
            key={articleId}
            articleId={articleNotes[0].articleId}
            notes={articleNotes}
            onDelete={(noteId) =>
              removeNote({ noteId }).catch(() =>
                toast.error("Couldn't delete the note. Try again."),
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
  onDelete,
}: {
  articleId: Id<"articles">;
  notes: Doc<"userNotes">[];
  onDelete: (noteId: Id<"userNotes">) => void;
}) {
  const article = useQuery(api.articles.getById, {
    articleId,
  });

  return (
    <div className="mb-10">
      <div className="mb-4">
        <Link
          href={`/read/${articleId}`}
          className="text-xl font-serif text-[var(--reader-fg)] hover:text-[var(--pen)] transition-colors"
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
      </div>
    </div>
  );
}
