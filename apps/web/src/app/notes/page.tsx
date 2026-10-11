"use client";
import { sanitizeHtml } from "@/lib/sanitize";
import { useMutation, useQuery } from "convex/react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";

export default function NotesPage() {
  const notes = useQuery(api.userNotes.listAll);
  const removeNote = useMutation(api.userNotes.remove);

  // Group notes by article
  const grouped = notes?.reduce(
    (acc, note) => {
      const key = note.articleId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(note);
      return acc;
    },
    {} as Record<string, typeof notes>,
  );

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-10">
        <Link
          href="/"
          className="text-ink-400 hover:text-ink-600 font-sans text-sm transition-colors"
        >
          &larr; Back
        </Link>
        <h1 className="text-xl font-serif font-medium text-ink-950 dark:text-parchment-100">
          Your Notes
        </h1>
        <ThemeToggle />
      </div>

      {notes && notes.length === 0 && (
        <div className="text-center py-16">
          <p className="text-ink-500 dark:text-ink-400 font-sans text-sm">
            No notes yet. Highlight text while reading to create notes.
          </p>
        </div>
      )}

      {grouped &&
        Object.entries(grouped).map(([articleId, articleNotes]) => (
          <ArticleNotesGroup
            key={articleId}
            articleId={articleId}
            notes={articleNotes!}
            onDelete={(id) => removeNote({ noteId: id as any })}
          />
        ))}
    </div>
  );
}

function ArticleNotesGroup({
  articleId,
  notes,
  onDelete,
}: {
  articleId: string;
  notes: any[];
  onDelete: (noteId: string) => void;
}) {
  const article = useQuery(api.articles.getById, {
    articleId: articleId as any,
  });

  return (
    <div className="mb-10">
      <div className="mb-4">
        <Link
          href={`/read/${articleId}`}
          className="text-lg font-serif font-medium text-ink-800 dark:text-parchment-200 hover:text-annotation-crossref transition-colors"
        >
          {article?.title || "Loading..."}
        </Link>
        {article?.author && (
          <p className="text-xs font-sans text-ink-400 mt-0.5">
            {article.author}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {notes.map((note) => {
          const sanitizedContent = sanitizeHtml(note.content);
          return (
            <div
              key={note._id}
              className="p-4 rounded-xl border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900 group"
            >
              {note.selectedText && (
                <Link href={`/read/${articleId}`} className="block mb-2">
                  <blockquote className="text-xs font-serif text-ink-500 dark:text-ink-400 border-l-2 border-annotation-crossref pl-3 italic line-clamp-2 hover:text-annotation-crossref transition-colors">
                    {note.selectedText}
                  </blockquote>
                </Link>
              )}

              <div
                className="text-sm font-sans text-ink-700 dark:text-parchment-300 leading-relaxed max-w-none
                  [&_strong]:font-semibold [&_em]:italic [&_ul]:list-disc [&_ul]:pl-4
                  [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-ink-500"
              >
                {/* Render sanitized HTML as text nodes for safety */}
                <span>{note.contentPlain}</span>
              </div>

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-ink-50 dark:border-ink-800">
                <span className="text-[10px] font-sans text-ink-300 dark:text-ink-600">
                  {new Date(note.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  onClick={() => onDelete(note._id)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] font-sans text-ink-300 hover:text-annotation-tension transition-all"
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
