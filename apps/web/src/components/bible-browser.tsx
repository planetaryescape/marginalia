"use client";
import { BIBLE_BOOKS } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

export function BibleBrowser({ onOpen }: { onOpen: () => void }) {
  const [bookId, setBookId] = useState("GEN");
  const [chapter, setChapter] = useState(1);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const book = BIBLE_BOOKS.find(([id]) => id === bookId) ?? BIBLE_BOOKS[0];
  const openPassage = useAction(api.actions.bible.openPassage);
  const router = useRouter();
  return (
    <details className="px-3 py-2 text-sm">
      <summary className="min-h-11 cursor-pointer py-3">
        Browse the Bible
      </summary>
      <div className="flex flex-wrap items-end gap-3 pb-3">
        <label htmlFor={`${id}-book`} className="min-w-0 flex-1">
          Book
          <select
            id={`${id}-book`}
            className="app-input mt-1"
            value={bookId}
            onChange={(event) => {
              setBookId(event.target.value);
              setChapter(1);
            }}
          >
            {BIBLE_BOOKS.map(([key, title]) => (
              <option key={key} value={key}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-chapter`}>
          Chapter
          <select
            id={`${id}-chapter`}
            className="app-input mt-1"
            value={chapter}
            onChange={(event) => setChapter(Number(event.target.value))}
          >
            {Array.from({ length: book[2] }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="app-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const articleId = await openPassage({
                reference: `${book[1]} ${chapter}`,
              });
              onOpen();
              router.push(`/read/${articleId}`);
            } catch (error) {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Couldn't open that chapter. Try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Opening…" : "Read chapter"}
        </button>
      </div>
    </details>
  );
}
