"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import * as Popover from "@radix-ui/react-popover";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Headphones,
  MessagesSquare,
  MoreHorizontal,
  NotebookPen,
  RotateCcw,
  Star,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnnotationCard } from "@/components/annotation-card";
import { ArticleAsk } from "@/components/article-ask";
import { ArticleRenderer } from "@/components/article-renderer";
import { BibleReaderTools } from "@/components/bible-reader-tools";
import { CompanionCard } from "@/components/companion-card";
import {
  ImpressionPanel,
  ImpressionSummary,
  RATINGS,
} from "@/components/impression-panel";
import { ListenBar } from "@/components/listen-bar";
import { NotesPanel } from "@/components/notes-panel";
import { ReaderMap } from "@/components/reader-map";
import { ReaderSettingsPanel } from "@/components/reader-settings-panel";
import { ReflectionBox } from "@/components/reflection-box";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { SourceLink } from "@/components/source-link";
import { SummaryPanel } from "@/components/summary-panel";
import { useCompanion, usePassageHighlight } from "@/lib/companion";
import { findMark, type MarkKind, useHighlights } from "@/lib/highlights";
import {
  flashParagraph,
  getArticleBody,
  getParagraphs,
  paragraphIndexOf,
  useParagraphs,
} from "@/lib/paragraphs";
import {
  DROP_CAP_FAMILIES,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  TYPEFACE_FAMILIES,
  useReaderSettings,
  webSearchEnabled,
} from "@/lib/reader-settings";
import { useListen, useReadingPosition } from "@/lib/reading-modes";
import { useSavedPassages } from "@/lib/saved-passages";
import { emitCommand, useShortcuts } from "@/lib/shortcuts";
import { useEngagementTracker } from "@/lib/use-engagement-tracker";
import { useReaderTheme } from "@/lib/use-reader-theme";
import { cn, formatReadTime } from "@/lib/utils";

export default function ReadPage() {
  const { articleId } = useParams<{ articleId: string }>();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const router = useRouter();

  const article = useQuery(api.articles.getById, {
    articleId: articleId as any,
  });
  const annotations = useQuery(api.annotations.listByArticle, {
    articleId: articleId as any,
  });
  const reflection = useQuery(api.reflections.getByArticle, {
    articleId: articleId as any,
  });
  const impression = useQuery(api.impressions.getByArticle, {
    articleId: articleId as any,
  });
  const isLoved = useQuery(api.lovedArticles.isLoved, {
    articleId: articleId as any,
  });
  const loveArticle = useMutation(api.lovedArticles.love);
  const unloveArticle = useMutation(api.lovedArticles.unlove);
  const reannotate = useAction(api.articles.requestReannotate);
  const articleNotes = useQuery(api.userNotes.listByArticle, {
    articleId: articleId as any,
  });

  const [finishing, setFinishing] = useState(false);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [articleAskOpen, setArticleAskOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const passageCycle = useRef<{ paragraph: HTMLElement | null; index: number }>(
    { paragraph: null, index: -1 },
  );
  const [pendingSelection, setPendingSelection] = useState<{
    text: string;
    startOffset?: number;
    endOffset?: number;
  } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  const createNote = useMutation(api.userNotes.create);
  const { settings, update: updateSettings, resetText } = useReaderSettings();
  const paragraphs = useParagraphs(articleRef, Boolean(article));
  const position = useReadingPosition(articleRef, paragraphs.version);
  const summary = useQuery(api.summaries.getByArticle, {
    articleId: articleId as any,
  });
  const savedThreads = useQuery(api.companionThreads.listByArticle, {
    articleId: articleId as any,
  });
  const companion = useCompanion({
    articleId: articleId as any,
    containerRef: articleRef,
    title: article?.title ?? "",
    settings,
  });
  const listen = useListen(articleRef);
  const {
    trackAnnotationOpen,
    finish,
    retry,
    saveError,
    progress: scrollPercent,
  } = useEngagementTracker({
    articleId,
    sessionId,
    ready: Boolean(article),
    containerRef: articleRef,
    listening: listen.active,
  });
  usePassageHighlight("companion-passage", companion.thread?.range ?? null);

  // One margin card at a time: an auto annotation or a companion thread
  const [activeAnnotation, setActiveAnnotation] = useState<{
    id: string;
    paragraphIndex: number | null;
  } | null>(null);

  const savedPassages = useSavedPassages({
    containerRef: articleRef,
    threads: savedThreads,
    version: paragraphs.version,
    activeId: companion.thread?.savedId,
    onOpen: ({ doc, range }) => {
      setActiveAnnotation(null);
      if (companion.thread?.savedId === doc._id) companion.close();
      else companion.open(doc, range);
    },
  });

  // Highlighter and pen marks (registered after saved passages so those win on click)
  const highlightDocs = useQuery(api.highlights.listByArticle, {
    articleId: articleId as any,
  });
  const createHighlight = useMutation(api.highlights.create);
  const removeHighlight = useMutation(api.highlights.remove);
  const marks = useHighlights({
    containerRef: articleRef,
    docs: highlightDocs,
    version: paragraphs.version,
  });

  const isMarked = useCallback(
    (kind: MarkKind, range: Range) => Boolean(findMark(marks, kind, range)),
    [marks],
  );

  const toggleMark = useCallback(
    async (kind: MarkKind, range: Range) => {
      const existing = findMark(marks, kind, range);
      try {
        if (existing) {
          await removeHighlight({ highlightId: existing.doc._id });
        } else {
          await createHighlight({
            articleId: articleId as any,
            kind,
            text: range.toString().replace(/\s+/g, " ").trim(),
            paragraphIndex: paragraphIndexOf(range.startContainer) ?? undefined,
          });
        }
      } catch {
        toast.error("Couldn't save that");
      }
    },
    [marks, createHighlight, removeHighlight, articleId],
  );

  const startCompanion = useCallback(
    (args: Parameters<typeof companion.start>[0]) => {
      setActiveAnnotation(null);
      companion.start(args);
    },
    [companion.start],
  );

  useReaderTheme(settings);

  // Focus mode keeps the passage under discussion lit
  const companionParagraph =
    companion.thread?.paragraphIndex ??
    activeAnnotation?.paragraphIndex ??
    null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reapply after article HTML changes
  useEffect(() => {
    if (companionParagraph === null) return;
    const el = getParagraphs(getArticleBody(articleRef.current))[
      companionParagraph
    ];
    el?.setAttribute("data-companion", "");
    return () => el?.removeAttribute("data-companion");
  }, [companionParagraph, paragraphs.version]);

  const jumpToParagraph = useCallback((index: number) => {
    const el = getParagraphs(getArticleBody(articleRef.current))[index];
    if (el) flashParagraph(el);
  }, []);

  const handleSaveCompanionNote = useCallback(
    async (note: {
      selectedText: string;
      content: string;
      contentPlain: string;
    }) => {
      try {
        await createNote({ articleId: articleId as any, ...note });
        toast.success("Saved to notes");
      } catch {
        toast.error("Couldn't save the note");
      }
    },
    [createNote, articleId],
  );

  const toggleListen = useCallback(() => {
    if (listen.active) {
      listen.stop();
    } else if (!listen.supported) {
      toast.error("This browser can't read aloud");
    } else {
      listen.speakFrom(position.current ?? position.firstVisible ?? 0);
    }
  }, [listen, position.current, position.firstVisible]);

  const currentParagraph = () => {
    const focused = paragraphIndexOf(document.activeElement);
    return (
      getParagraphs(getArticleBody(articleRef.current))[
        focused ?? cursor ?? position.current ?? position.firstVisible ?? 0
      ] ?? null
    );
  };
  const getCurrentParagraphRange = () => {
    const paragraph = currentParagraph();
    if (!paragraph) return null;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    return range;
  };
  const moveParagraph = (direction: 1 | -1) => {
    const list = getParagraphs(getArticleBody(articleRef.current));
    if (!list.length) return;
    const current = paragraphIndexOf(document.activeElement) ?? cursor;
    const next =
      current === null
        ? (position.current ?? position.firstVisible ?? 0)
        : Math.max(0, Math.min(list.length - 1, current + direction));
    window.getSelection()?.removeAllRanges();
    setCursor(next);
    list[next].tabIndex = -1;
    list[next].focus({ preventScroll: true });
    list[next].scrollIntoView({ block: "center", behavior: "instant" });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reapply after paragraph elements are replaced
  useEffect(() => {
    if (cursor === null) return;
    const el = getParagraphs(getArticleBody(articleRef.current))[cursor];
    el?.setAttribute("data-keyboard-cursor", "");
    return () => el?.removeAttribute("data-keyboard-cursor");
  }, [cursor, paragraphs.version]);

  useShortcuts(
    {
      j: () => moveParagraph(1),
      k: () => moveParagraph(-1),
      r: () => setRatingOpen(true),
      n: () => setNotesPanelOpen(true),
      ",": () => emitCommand("open-settings"),
      u: () => emitCommand("toggle-summary"),
      l: () => toggleListen(),
      o: () => {
        const paragraph = currentParagraph();
        if (!paragraph) return;
        const openers = [
          ...Array.from(
            paragraph.querySelectorAll<HTMLElement>(".annotation-mark"),
          ).map((annotation) => () => {
            annotation.focus({ preventScroll: true });
            annotation.click();
          }),
          ...savedPassages
            .filter((p) => p.range.intersectsNode(paragraph))
            .map((passage) => () => {
              setActiveAnnotation(null);
              companion.open(passage.doc, passage.range);
            }),
        ];
        if (!openers.length) return;
        const next =
          passageCycle.current.paragraph === paragraph
            ? (passageCycle.current.index + 1) % openers.length
            : 0;
        passageCycle.current = { paragraph, index: next };
        openers[next]();
      },
    },
    Boolean(article),
  );

  const handleDone = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await finish();
      router.push("/");
    } catch {
      toast.error(
        "Couldn't save your reading activity. Check your connection and try again.",
      );
    } finally {
      setFinishing(false);
    }
  }, [finish, finishing, router]);

  const restoreArticle = useMutation(api.articles.restore);
  const handleRestore = useCallback(async () => {
    try {
      await restoreArticle({ articleId: articleId as any });
      toast.success("Back in Up next");
    } catch {
      toast.error("Couldn't mark this unread. Try again.");
    }
  }, [articleId, restoreArticle]);

  const handleAnnotationSelect = useCallback(
    (annotationId: string | null) => {
      if (!annotationId) {
        setActiveAnnotation(null);
        return;
      }
      companion.close();
      const mark = articleRef.current?.querySelector(
        `[data-annotation-id="${CSS.escape(annotationId)}"]`,
      );
      setActiveAnnotation({
        id: annotationId,
        paragraphIndex: paragraphIndexOf(mark ?? null),
      });
      trackAnnotationOpen(annotationId);
    },
    [trackAnnotationOpen, companion.close],
  );

  const openAnnotation = annotations?.find(
    (a) => a._id === activeAnnotation?.id,
  );
  const removeNote = useMutation(api.userNotes.remove);

  const handleReflect = useCallback(
    async (text: string) => {
      if (!openAnnotation) return;
      const escapeHtml = (value: string) =>
        value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
      try {
        await createNote({
          articleId: articleId as any,
          annotationId: openAnnotation._id as any,
          prompt: openAnnotation.content,
          selectedText: openAnnotation.anchorText,
          // Keep the prompt with the reflection so the note reads on its own in the Notes panel
          content: `<blockquote><p>${escapeHtml(openAnnotation.content)}</p></blockquote>${paragraphs}`,
          contentPlain: text,
        });
      } catch {
        toast.error("Couldn't save your reflection");
        throw new Error("save failed");
      }
    },
    [openAnnotation, createNote, articleId],
  );

  const handleAddNote = useCallback(
    (selection: { text: string; startOffset?: number; endOffset?: number }) => {
      setPendingSelection(selection);
      setNotesPanelOpen(true);
    },
    [],
  );

  if (!article) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-ink-400 font-sans text-sm">Loading article...</p>
      </div>
    );
  }

  const estimatedMinRemaining = article.estimatedReadMinutes
    ? Math.max(
        1,
        Math.round(article.estimatedReadMinutes * (1 - scrollPercent / 100)),
      )
    : null;

  const noteCount = articleNotes?.length ?? 0;

  return (
    <>
      {/* Reading progress bar */}
      <div
        className="reading-progress"
        style={{ width: `${scrollPercent}%` }}
      />

      {/* Top nav */}
      <div className="fixed top-0 left-0 right-[var(--notes-inset)] transition-[right] duration-200 pt-[env(safe-area-inset-top)] z-40 bg-[color-mix(in_srgb,var(--reader-bg)_82%,transparent)] backdrop-blur-sm">
        <div
          className="mx-auto px-4 sm:px-6 py-2 sm:py-3 flex items-center justify-between"
          style={{ maxWidth: `max(${MAX_WIDTHS[settings.width]}, 42rem)` }}
        >
          <Link
            href={sessionId ? `/session/${sessionId}` : "/"}
            className="flex min-h-11 sm:min-h-0 items-center text-[var(--reader-muted)] hover:text-[var(--reader-fg)] font-sans text-sm transition-colors"
          >
            &larr; Back
          </Link>

          <span className="sm:hidden flex-1 min-w-0 truncate px-3 font-sans text-sm text-[var(--reader-fg-soft)]">
            {article.title}
          </span>

          <div className="flex items-center gap-0 sm:gap-3">
            <span className="hidden sm:inline text-[var(--reader-muted)] font-sans text-xs">
              {estimatedMinRemaining
                ? `~${estimatedMinRemaining} min left`
                : formatReadTime(article.estimatedReadMinutes)}
            </span>

            {/* Notes button */}
            <button
              onClick={() => setNotesPanelOpen((o) => !o)}
              className={`relative w-11 h-11 sm:w-8 sm:h-8 hidden sm:flex items-center justify-center rounded-full transition-colors ${
                notesPanelOpen
                  ? "bg-annotation-crossref/20 text-annotation-crossref"
                  : "hover:bg-[var(--reader-chip)] text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
              }`}
              title="Notes"
              aria-label="Notes"
              aria-keyshortcuts="n"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {noteCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-annotation-crossref text-white text-[9px] font-sans font-bold rounded-full flex items-center justify-center">
                  {noteCount}
                </span>
              )}
            </button>

            {/* Re-annotate button */}
            <button
              onClick={async () => {
                try {
                  await reannotate({ articleId: articleId as any });
                  toast.success("Re-annotating with latest vault...");
                } catch {
                  toast.error("Failed to re-annotate");
                }
              }}
              className="w-11 h-11 sm:w-8 sm:h-8 hidden sm:flex items-center justify-center rounded-full text-[var(--reader-muted)] hover:text-[var(--reader-fg)] hover:bg-[var(--reader-chip)] transition-colors"
              title="Re-annotate with latest vault"
              aria-label="Re-annotate with latest vault"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>

            {/* Impression: rating, tags and what stayed with you */}
            <Popover.Root open={ratingOpen} onOpenChange={setRatingOpen}>
              <Popover.Trigger asChild>
                <button
                  className={`w-11 h-11 sm:w-8 sm:h-8 hidden sm:flex items-center justify-center rounded-full transition-colors ${
                    impression?.rating
                      ? "text-[var(--pen)]"
                      : "text-[var(--reader-muted)] hover:text-[var(--reader-fg)] hover:bg-[var(--reader-chip)]"
                  }`}
                  title={
                    impression?.rating
                      ? `You rated this ${RATINGS[impression.rating - 1]}`
                      : "Rate this article"
                  }
                  aria-label="Rate this article"
                  aria-keyshortcuts="r"
                >
                  <Star
                    size={15}
                    fill={impression?.rating ? "currentColor" : "none"}
                  />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="end"
                  sideOffset={10}
                  collisionPadding={12}
                  className="reader-popover z-50 w-[340px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-2xl p-4 bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border)] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] outline-none"
                >
                  <ImpressionPanel
                    articleId={articleId as any}
                    heading="Your impression"
                  />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            {/* Love button */}
            <button
              onClick={async () => {
                if (isLoved) {
                  await unloveArticle({ articleId: articleId as any });
                } else {
                  await loveArticle({ articleId: articleId as any });
                }
              }}
              className={`w-11 h-11 sm:w-8 sm:h-8 hidden sm:flex items-center justify-center rounded-full transition-colors ${
                isLoved
                  ? "text-red-500"
                  : "text-[var(--reader-muted)] hover:text-red-400 hover:bg-[var(--reader-chip)]"
              }`}
              title={isLoved ? "Remove from loved" : "Love this article"}
              aria-label={isLoved ? "Remove from loved" : "Love this article"}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill={isLoved ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>

            <SourceLink className="hidden sm:flex sm:rounded-full" />
            <ReaderSettingsPanel
              settings={settings}
              update={updateSettings}
              resetText={resetText}
              listening={listen.active}
              onToggleListen={toggleListen}
            />
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  className="sm:hidden w-11 h-11 flex items-center justify-center"
                  aria-label="More reading actions"
                >
                  <MoreHorizontal size={22} />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                  className="reader-popover z-50 p-2 w-60 rounded-2xl bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border)] shadow-lg"
                >
                  <button
                    className="mobile-menu-action"
                    onClick={() => setRatingOpen(true)}
                  >
                    Rate this article
                  </button>
                  <button
                    className="mobile-menu-action"
                    onClick={async () => {
                      try {
                        if (isLoved)
                          await unloveArticle({ articleId: articleId as any });
                        else await loveArticle({ articleId: articleId as any });
                      } catch {
                        toast.error("Couldn't update loved articles");
                      }
                    }}
                  >
                    {isLoved ? "Remove from loved" : "Love this article"}
                  </button>
                  <button
                    className="mobile-menu-action"
                    onClick={async () => {
                      try {
                        await reannotate({ articleId: articleId as any });
                        toast.success("Re-annotating with latest vault…");
                      } catch {
                        toast.error("Couldn't re-annotate");
                      }
                    }}
                  >
                    Re-annotate
                  </button>
                  <Link className="mobile-menu-action" href="/account">
                    Your account
                  </Link>
                  <SourceLink variant="menu" />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>
      </div>

      <nav
        aria-label="Reading controls"
        className="mobile-reader-bar sm:hidden"
      >
        <button
          aria-label="Ask about this article"
          aria-expanded={articleAskOpen}
          aria-controls={articleAskOpen ? "article-question" : undefined}
          disabled={listen.active || Boolean(saveError)}
          onClick={() => {
            setNotesPanelOpen(false);
            setActiveAnnotation(null);
            companion.close();
            setArticleAskOpen((open) => !open);
          }}
        >
          <MessagesSquare size={19} />
          Ask
        </button>
        <button onClick={() => setNotesPanelOpen(true)}>
          <NotebookPen size={19} />
          Notes{noteCount ? ` · ${noteCount}` : ""}
        </button>
        <button onClick={toggleListen} aria-pressed={listen.active}>
          <Headphones size={19} />
          {listen.active ? "Stop" : "Listen"}
        </button>
        {article?.finishedAt === undefined ? (
          <button disabled={finishing} onClick={handleDone}>
            <Check size={19} />
            {finishing ? "Saving…" : "Finish"}
          </button>
        ) : (
          <button onClick={handleRestore}>
            <RotateCcw size={19} />
            Mark unread
          </button>
        )}
      </nav>
      {saveError && (
        <div
          role="status"
          className="fixed z-40 left-3 right-3 bottom-20 rounded-xl bg-[var(--reader-surface)] p-3 text-sm font-sans ring-1 ring-[var(--reader-border)]"
        >
          Reading activity is waiting to sync.{" "}
          <button
            className="underline min-h-11"
            onClick={() => void retry().catch(() => {})}
          >
            Retry
          </button>
        </div>
      )}

      {/* Selection toolbar — Ask / Explain / Simplify, note and copy */}
      <SelectionToolbar
        containerRef={articleRef}
        getCurrentParagraphRange={getCurrentParagraphRange}
        onAddNote={handleAddNote}
        onCompanion={startCompanion}
        depth={settings.answerDepth}
        onDepthChange={(answerDepth) => updateSettings({ answerDepth })}
        web={webSearchEnabled(settings)}
        onWebChange={(on) =>
          updateSettings({ webSearch: on ? "always" : "off" })
        }
        isMarked={isMarked}
        onToggleMark={toggleMark}
      />

      {settings.map && (
        <ReaderMap
          containerRef={articleRef}
          version={paragraphs.version}
          position={position}
          marked={companionParagraph}
          saved={savedPassages.map((p) => p.doc.paragraphIndex ?? -1)}
          onJump={jumpToParagraph}
        />
      )}

      {/* Article content; padded so the docked notes pane never covers the text */}
      <div
        className="pr-[var(--notes-inset)] transition-[padding] duration-200"
        onTransitionEnd={(e) => {
          // Margin cards measure the gutter on resize, so tell them it changed.
          if (e.target === e.currentTarget)
            window.dispatchEvent(new Event("resize"));
        }}
      >
        <article
          ref={articleRef}
          className={cn(
            "article-column mx-auto px-6 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] transition-[max-width] duration-300",
            settings.numbers && "reader-numbers",
            settings.focus && "reader-focus",
            settings.align === "justify" && "reader-justify",
            settings.paragraphs === "indented" && "reader-indented",
            !article.bible && settings.dropCap !== "off" && "reader-dropcap",
          )}
          data-dropcap-style={settings.dropCap}
          style={
            {
              maxWidth: MAX_WIDTHS[settings.width],
              "--reader-font": TYPEFACE_FAMILIES[settings.typeface],
              "--reader-size": `${settings.size}px`,
              "--reader-leading": LINE_HEIGHTS[settings.spacing],
              "--dropcap-lines": settings.dropCapLines,
              "--dropcap-font":
                settings.dropCap === "off"
                  ? undefined
                  : DROP_CAP_FAMILIES[settings.dropCap],
            } as React.CSSProperties
          }
        >
          <header className="mb-10">
            <h1
              className="text-3xl sm:text-4xl font-medium text-[var(--reader-fg)] leading-tight mb-4"
              style={{ fontFamily: "var(--reader-font)" }}
            >
              {article.title}
            </h1>
            <div className="flex flex-wrap gap-3 text-sm font-sans text-ink-400 dark:text-ink-500">
              {article.author && <span>{article.author}</span>}
              {article.estimatedReadMinutes && (
                <>
                  <span>&middot;</span>
                  <span>{formatReadTime(article.estimatedReadMinutes)}</span>
                </>
              )}
            </div>
            {impression && <ImpressionSummary impression={impression} />}
            {article.bible && (
              <BibleReaderTools
                bible={article.bible}
                annotationStatus={article.annotationStatus}
                articleId={article._id}
                skipReason={article.skipReason}
              />
            )}
          </header>

          <SummaryPanel
            articleId={articleId as any}
            title={article.title}
            wordCount={article.wordCount}
            summary={summary}
            containerRef={articleRef}
            onJump={jumpToParagraph}
          />
          <ArticleRenderer
            content={article.content ?? ""}
            contentHtml={article.contentHtml ?? ""}
            annotations={annotations ?? []}
            activeAnnotationId={activeAnnotation?.id ?? null}
            onAnnotationSelect={handleAnnotationSelect}
          />

          <section
            aria-label="Your impression"
            className="mt-16 rounded-2xl bg-[var(--reader-surface)] ring-1 ring-[var(--reader-border)] p-5"
          >
            <ImpressionPanel articleId={articleId as any} />
          </section>

          {reflection && (
            <div className="mt-10">
              <ReflectionBox reflection={reflection} onDone={handleDone} />
            </div>
          )}

          {!reflection && (
            <div className="mt-10 text-center">
              <button
                onClick={handleDone}
                className="px-8 py-3 reader-float rounded-xl font-sans text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          )}
        </article>
      </div>

      {companion.thread && (
        <CompanionCard
          key={companion.thread.id}
          thread={companion.thread}
          containerRef={articleRef}
          layoutVersion={paragraphs.version}
          onClose={companion.close}
          onDelete={companion.remove}
          onFollowUp={companion.followUp}
          onRegenerate={companion.regenerate}
          onJump={jumpToParagraph}
          onSaveNote={handleSaveCompanionNote}
        />
      )}

      {openAnnotation && activeAnnotation && (
        <AnnotationCard
          key={openAnnotation._id}
          annotation={openAnnotation}
          paragraphIndex={activeAnnotation.paragraphIndex}
          reflections={(articleNotes ?? [])
            .filter((note) => note.annotationId === openAnnotation._id)
            .sort((a, b) => a.createdAt - b.createdAt)}
          onReflect={handleReflect}
          onDeleteReflection={(id) => removeNote({ noteId: id as any })}
          containerRef={articleRef}
          layoutVersion={paragraphs.version}
          onClose={() => setActiveAnnotation(null)}
          onJump={jumpToParagraph}
        />
      )}

      <ArticleAsk
        open={articleAskOpen}
        onOpenChange={setArticleAskOpen}
        hidden={Boolean(
          companion.thread ||
            activeAnnotation ||
            notesPanelOpen ||
            listen.active ||
            saveError,
        )}
        onAsk={(question) => {
          setActiveAnnotation(null);
          companion.startArticle(question);
        }}
        depth={settings.answerDepth}
        onDepthChange={(answerDepth) => updateSettings({ answerDepth })}
        web={webSearchEnabled(settings)}
        onWebChange={(on) =>
          updateSettings({ webSearch: on ? "always" : "off" })
        }
        history={(savedThreads ?? [])
          .filter((t) => t.mode === "article")
          .sort((a, b) => b.updatedAt - a.updatedAt)}
        onOpen={(doc) => {
          setActiveAnnotation(null);
          companion.open(doc);
        }}
      />

      <ListenBar
        index={listen.index}
        total={paragraphs.count}
        paused={listen.paused}
        onTogglePause={listen.togglePause}
        onSkip={(index) =>
          listen.speakFrom(Math.min(Math.max(0, index), paragraphs.count - 1))
        }
        onStop={listen.stop}
      />

      {/* Notes side panel */}
      <NotesPanel
        articleId={articleId}
        isOpen={notesPanelOpen}
        onClose={() => setNotesPanelOpen(false)}
        pendingSelection={pendingSelection}
        onClearSelection={() => setPendingSelection(null)}
      />
    </>
  );
}
