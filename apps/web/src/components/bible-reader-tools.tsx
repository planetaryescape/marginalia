"use client";
import { BIBLE_BOOKS, parseBibleReference } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BibleBrowser } from "./bible-browser";

export function BibleReaderTools({
  bible,
  annotationStatus,
  articleId,
  skipReason,
}: {
  bible: { reference: string; translation: string; copyright: string };
  annotationStatus: string;
  articleId: Id<"articles">;
  skipReason?: string;
}) {
  const router = useRouter();
  const openPassage = useAction(api.actions.bible.openPassage);
  const [busy, setBusy] = useState(false);
  const resumeAnnotations = useMutation(api.bible.resumeAnnotations);
  useEffect(() => {
    if (annotationStatus === "skipped" && skipReason === "bible_disabled")
      void resumeAnnotations({ articleId }).catch(() =>
        toast.error("Marginalia is paused. Use Re-annotate to try again."),
      );
  }, [articleId, annotationStatus, skipReason, resumeAnnotations]);
  const ref = parseBibleReference(bible.reference);
  const bookIndex = BIBLE_BOOKS.findIndex(([id]) => id === ref?.bookId);
  const book = BIBLE_BOOKS[bookIndex];
  const previous =
    ref && book
      ? ref.chapter > 1
        ? `${book[1]} ${ref.chapter - 1}`
        : bookIndex > 0
          ? `${BIBLE_BOOKS[bookIndex - 1][1]} ${BIBLE_BOOKS[bookIndex - 1][2]}`
          : null
      : null;
  const next =
    ref && book
      ? ref.endChapter < book[2]
        ? `${book[1]} ${ref.endChapter + 1}`
        : bookIndex < BIBLE_BOOKS.length - 1
          ? `${BIBLE_BOOKS[bookIndex + 1][1]} 1`
          : null
      : null;
  async function open(reference: string) {
    setBusy(true);
    try {
      const id = await openPassage({
        reference,
        translation: bible.translation,
      });
      router.push(`/read/${id}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't open that chapter. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Bible reading tools"
      className="mt-5 space-y-3 border-y border-[var(--reader-border)] py-4 font-sans text-sm"
    >
      <p className="text-[var(--reader-fg-soft)]">
        {bible.copyright}{" "}
        <a
          href="https://ebible.org/eng-web/copyright.htm"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          About this translation
        </a>
      </p>
      <nav
        aria-label="Bible chapter navigation"
        className="flex flex-wrap justify-between gap-2"
      >
        <button
          type="button"
          className="app-button secondary"
          disabled={busy || !previous}
          onClick={() => previous && void open(previous)}
        >
          Previous chapter
        </button>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy || !next}
          onClick={() => next && void open(next)}
        >
          Next chapter
        </button>
      </nav>
      <BibleBrowser onOpen={() => {}} translation={bible.translation} />
      <p role="status" className="text-xs text-[var(--reader-muted)]">
        {busy
          ? "Opening chapter…"
          : annotationStatus === "pending"
            ? "Generating marginalia for this passage. You can start reading now."
            : annotationStatus === "skipped"
              ? "Connect an AI provider in Your account for on-demand marginalia. Your own notes and highlights work without AI."
              : annotationStatus === "failed"
                ? "Marginalia couldn't be generated. Use Re-annotate in the reader menu to try again."
                : "Marginalia is AI-generated interpretation, not Scripture. Check references and consider the surrounding context."}
      </p>
    </section>
  );
}
