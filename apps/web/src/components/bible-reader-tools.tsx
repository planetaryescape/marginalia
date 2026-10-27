"use client";
import { BIBLE_BOOKS, parseBibleReference } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import * as Popover from "@radix-ui/react-popover";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BookOpen, ChevronLeft, ChevronRight, Columns2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
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
  onOpenChange,
  reflectionMissing = false,
  onStudyHistory,
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
  onOpenChange?: (open: boolean) => void;
  reflectionMissing?: boolean;
  onStudyHistory?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    onOpenChange?.(value);
  };
  const resumeAnnotations = useMutation(api.bible.resumeAnnotations);
  const comparisonError = display?.comparing ? display.error : "";
  useEffect(() => {
    if (comparisonError) {
      setOpen(true);
      onOpenChange?.(true);
    }
  }, [comparisonError, onOpenChange]);
  useEffect(() => {
    if (
      (annotationStatus === "skipped" && skipReason === "bible_disabled") ||
      (annotationStatus === "annotated" && reflectionMissing)
    )
      void resumeAnnotations({ articleId }).catch(() =>
        toast.error("Marginalia is paused. Use Re-annotate to try again."),
      );
  }, [
    articleId,
    annotationStatus,
    skipReason,
    resumeAnnotations,
    reflectionMissing,
  ]);
  useEffect(() => {
    const showWords = () => {
      setOpen(true);
      onOpenChange?.(true);
    };
    window.addEventListener("bible-word-study", showWords);
    return () => {
      window.removeEventListener("bible-word-study", showWords);
      onOpenChange?.(false);
    };
  }, [onOpenChange]);
  return (
    <>
      {display ? (
        <button
          type="button"
          className={TOOL_BUTTON}
          aria-label="Compare versions"
          title="Compare versions"
          aria-pressed={display.comparing}
          onClick={() => display.setComparing(!display.comparing)}
        >
          <Columns2 size={18} strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={TOOL_BUTTON}
            aria-label="Bible tools"
            title="Bible tools"
          >
            <BookOpen size={18} strokeWidth={1.5} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal forceMount>
          <Popover.Content
            forceMount
            align="end"
            sideOffset={8}
            collisionPadding={12}
            aria-label="Bible tools"
            className="reader-menu z-50 max-h-[75svh] w-[min(30rem,calc(100vw-1.5rem))] overflow-y-auto p-5 font-sans text-sm data-[state=closed]:hidden"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <BibleChapterNavigation bible={bible}>
                  <h2 className="truncate text-center font-medium">
                    {bible.reference}
                  </h2>
                </BibleChapterNavigation>
              </div>
              <Popover.Close asChild>
                <button
                  type="button"
                  className={TOOL_BUTTON}
                  aria-label="Close Bible tools"
                >
                  <X size={16} aria-hidden />
                </button>
              </Popover.Close>
            </div>
            {display?.comparing ? (
              <div className="mb-4">
                <ComparisonVersion
                  selected={display.otherVersion}
                  primaryId={bible.displayVersionId}
                  onChange={display.setOtherVersion}
                />
              </div>
            ) : null}
            {display?.error ? (
              <p role="alert" className="mb-4">
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
            <BibleBrowser
              onOpen={() => changeOpen(false)}
              translation={bible.translation}
              versionId={bible.displayVersionId}
            />
            <BibleWordStudy key={bible.reference} reference={bible.reference} />
            {onStudyHistory && (
              <button
                type="button"
                className="mt-4 min-h-11 text-[var(--pencil)] underline underline-offset-4"
                onClick={() => {
                  changeOpen(false);
                  onStudyHistory();
                }}
              >
                Saved deep studies
              </button>
            )}
            {annotationStatus === "pending" ? (
              <p
                role="status"
                className="mt-3 text-xs text-[var(--reader-muted)]"
              >
                Preparing study notes. You can keep reading.
              </p>
            ) : annotationStatus === "failed" ? (
              <p className="mt-3 text-xs text-[var(--reader-muted)]">
                Study notes failed. Use Re-annotate in More actions to retry.
              </p>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

const TOOL_BUTTON =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--reader-chip)] aria-pressed:bg-[var(--reader-chip)] data-[state=open]:bg-[var(--reader-chip)] sm:h-9 sm:w-9";
type BibleMetadata = {
  reference: string;
  translation: string;
  copyright: string;
  displayVersionId?: number;
};

export function BibleChapterNavigation({
  bible,
  children,
}: {
  bible: BibleMetadata;
  children: ReactNode;
}) {
  const router = useRouter();
  const openPassage = useAction(api.actions.bible.openReading);
  const [busy, setBusy] = useState(false);
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
    <nav
      aria-label="Bible chapter navigation"
      className="flex items-center gap-2"
    >
      <button
        type="button"
        className={TOOL_BUTTON}
        aria-label="Previous chapter"
        title={previous ?? "Beginning of the Bible"}
        disabled={busy || !previous}
        onClick={() => previous && void open(previous)}
      >
        <ChevronLeft size={20} strokeWidth={1.5} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        className={TOOL_BUTTON}
        aria-label="Next chapter"
        title={next ?? "End of the Bible"}
        disabled={busy || !next}
        onClick={() => next && void open(next)}
      >
        <ChevronRight size={20} strokeWidth={1.5} aria-hidden />
      </button>
    </nav>
  );
}

export function BibleAttribution({
  bible,
  display,
}: {
  bible: BibleMetadata;
  display?: ReturnType<typeof useBibleDisplay>;
}) {
  return (
    <section
      aria-label="Bible sources"
      className="mt-10 space-y-2 font-sans text-xs leading-5 text-[var(--reader-muted)]"
    >
      <p className="whitespace-pre-line">
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
          {display?.primary?.publisher ?? "World English Bible"}
        </a>
      </p>
      <p>
        AI study source: World English Bible (public domain). Notes, summaries
        and idea maps use WEB, not the displayed edition’s wording. AI
        commentary is interpretation, not Scripture.
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
