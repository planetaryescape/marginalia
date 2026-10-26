"use client";
import { BIBLE_BOOKS, parseBibleReference } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { useBibleDisplay } from "@/lib/use-bible-display";
import { BibleBrowser } from "./bible-browser";
import { BibleWordStudy } from "./bible-word-study";

export function BibleReaderTools({
  bible,
  annotationStatus,
  articleId,
  skipReason,
  display,
}: {
  bible: {
    reference: string;
    translation: string;
    copyright: string;
    displayVersionId?: number;
  };
  annotationStatus: string;
  articleId: Id<"articles">;
  skipReason?: string;
  display?: ReturnType<typeof useBibleDisplay>;
}) {
  const router = useRouter();
  const openPassage = useAction(api.actions.bible.openReading);
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
        versionId: bible.displayVersionId,
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
          href={
            display?.primary?.publisherUrl ??
            "https://ebible.org/eng-web/copyright.htm"
          }
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          {display?.primary?.publisher ?? "About this translation"}
        </a>
      </p>
      <p className="text-[var(--reader-fg-soft)]">
        AI study source: <strong>World English Bible (WEB)</strong>. Summaries,
        idea maps and marginalia use this public-domain text, not the wording of
        your displayed translation. Cross-version margin notes are attached by
        verse.
      </p>
      {display ? (
        <>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              role="switch"
              aria-checked={display.comparing}
              checked={display.comparing}
              onChange={(event) => display.setComparing(event.target.checked)}
            />
            Compare versions
          </label>
          {display.comparing ? (
            <ComparisonVersion
              selected={display.otherVersion}
              primaryId={bible.displayVersionId}
              onChange={display.setOtherVersion}
            />
          ) : null}
          {display.comparing && display.error ? (
            <p role="alert">
              {display.error}{" "}
              <button
                type="button"
                className="min-h-11 underline"
                onClick={display.retry}
              >
                Retry comparison
              </button>
            </p>
          ) : null}
        </>
      ) : null}
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
      <BibleBrowser
        onOpen={() => {}}
        translation={bible.translation}
        versionId={bible.displayVersionId}
      />
      <BibleWordStudy key={bible.reference} reference={bible.reference} />
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

function ComparisonVersion({
  selected,
  primaryId,
  onChange,
}: {
  selected: number;
  primaryId?: number;
  onChange: (id: number) => void;
}) {
  const load = useAction(api.actions.bible.catalogue);
  const [versions, setVersions] = useState<FunctionReturnType<
    typeof api.actions.bible.catalogue
  > | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    if (retry > 0) setVersions(null);
    setError("");
    void load({}).then(
      (data) => {
        if (current) setVersions(data);
      },
      () => {
        if (current) setError("Couldn't load comparison editions.");
      },
    );
    return () => {
      current = false;
    };
  }, [load, retry]);
  if (error)
    return (
      <p role="alert">
        {error}{" "}
        <button
          type="button"
          className="min-h-11 underline"
          onClick={() => setRetry((n) => n + 1)}
        >
          Retry versions
        </button>
      </p>
    );
  if (!versions) return <p role="status">Loading comparison editions…</p>;
  return (
    <label className="block">
      Compare with
      <select
        className="app-input mt-2"
        value={selected}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {versions
          .filter((v) => v.id !== primaryId)
          .map((v) => (
            <option key={v.id} value={v.id}>
              {v.title} ({v.language})
            </option>
          ))}
      </select>
    </label>
  );
}
