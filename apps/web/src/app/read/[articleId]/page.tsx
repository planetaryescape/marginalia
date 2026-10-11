"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { ArticleRenderer } from "@/components/article-renderer";
import { ReflectionBox } from "@/components/reflection-box";
import { NotesPanel } from "@/components/notes-panel";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { AnnotationCard } from "@/components/annotation-card";
import { ArticleAsk } from "@/components/article-ask";
import { CompanionCard } from "@/components/companion-card";
import { ReaderSettingsPanel } from "@/components/reader-settings-panel";
import { ReaderMap } from "@/components/reader-map";
import { SummaryPanel } from "@/components/summary-panel";
import { ListenBar } from "@/components/listen-bar";
import { useEngagementTracker } from "@/lib/use-engagement-tracker";
import { usePassageHighlight, useCompanion } from "@/lib/companion";
import {
  flashParagraph,
  getArticleBody,
  getParagraphs,
  paragraphIndexOf,
  useParagraphs,
} from "@/lib/paragraphs";
import { findMark, type MarkKind, useHighlights } from "@/lib/highlights";
import { useSavedPassages } from "@/lib/saved-passages";
import { useListen, useReadingPosition } from "@/lib/reading-modes";
import { useReaderTheme } from "@/lib/use-reader-theme";
import {
  DROP_CAP_FAMILIES,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  TYPEFACE_FAMILIES,
  useReaderSettings,
  webSearchEnabled,
} from "@/lib/reader-settings";
import { cn, formatReadTime } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";

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
  const isLoved = useQuery(api.lovedArticles.isLoved, {
    articleId: articleId as any,
  });
  const loveArticle = useMutation(api.lovedArticles.love);
  const unloveArticle = useMutation(api.lovedArticles.unlove);
  const reannotate = useAction(api.articles.requestReannotate);
  const articleNotes = useQuery(api.userNotes.listByArticle, {
    articleId: articleId as any,
  });

  const updateSession = useMutation(api.sessions.updateStatus);
  const recordInteraction = useMutation(api.sessions.recordInteraction);
  const { trackAnnotationOpen, getSnapshot } = useEngagementTracker();

  const [scrollPercent, setScrollPercent] = useState(0);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{
    text: string;
    startOffset?: number;
    endOffset?: number;
  } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const hasRecordedAbandon = useRef(false);

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
    companion.thread?.paragraphIndex ?? activeAnnotation?.paragraphIndex ?? null;
  useEffect(() => {
    if (companionParagraph === null) return;
    const el = getParagraphs(getArticleBody(articleRef.current))[companionParagraph];
    el?.setAttribute("data-companion", "");
    return () => el?.removeAttribute("data-companion");
  }, [companionParagraph, paragraphs.version]);

  const jumpToParagraph = useCallback((index: number) => {
    const el = getParagraphs(getArticleBody(articleRef.current))[index];
    if (el) flashParagraph(el);
  }, []);

  const handleSaveCompanionNote = useCallback(
    async (note: { selectedText: string; content: string; contentPlain: string }) => {
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

  // Scroll tracking
  useEffect(() => {
    const handleScroll = () => {
      const el = articleRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const totalHeight = el.scrollHeight;
      const scrolled = Math.max(0, -rect.top);
      const pct = Math.min(
        100,
        Math.round((scrolled / (totalHeight - viewportHeight)) * 100),
      );
      setScrollPercent(pct);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Abandon tracking
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (hasRecordedAbandon.current) return;
      hasRecordedAbandon.current = true;
      const snap = getSnapshot();
      navigator.sendBeacon?.(
        "/api/engagement",
        JSON.stringify({ articleId, sessionId, action: "abandoned", ...snap }),
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [articleId, sessionId, getSnapshot]);

  const handleDone = useCallback(async () => {
    hasRecordedAbandon.current = true;
    const snap = getSnapshot();
    if (sessionId) {
      await updateSession({
        sessionId: sessionId as any,
        readingStatus: "completed",
        scrollPercentage: snap.maxScrollPercent,
        annotationsViewed: snap.annotationsOpened.length,
        timeSpentMs: snap.activeTimeMs,
      });
    }
    await recordInteraction({
      articleId: articleId as any,
      sessionId: sessionId ? (sessionId as any) : undefined,
      action: "finished",
      scrollPercentage: snap.maxScrollPercent,
      timeSpentMs: snap.activeTimeMs,
      activeTimeMs: snap.activeTimeMs,
      maxScrollPercent: snap.maxScrollPercent,
      annotationsOpened: snap.annotationsOpened,
      totalScrollEvents: snap.totalScrollEvents,
      tabHiddenCount: snap.tabHiddenCount,
    });
    router.push("/");
  }, [sessionId, articleId, updateSession, recordInteraction, getSnapshot, router]);

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
      setActiveAnnotation({ id: annotationId, paragraphIndex: paragraphIndexOf(mark ?? null) });
      trackAnnotationOpen(annotationId);
    },
    [trackAnnotationOpen, companion.close],
  );

  const openAnnotation = annotations?.find((a) => a._id === activeAnnotation?.id);
  const removeNote = useMutation(api.userNotes.remove);

  const handleReflect = useCallback(
    async (text: string) => {
      if (!openAnnotation) return;
      const escape = (value: string) =>
        value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
      try {
        await createNote({
          articleId: articleId as any,
          annotationId: openAnnotation._id as any,
          prompt: openAnnotation.content,
          selectedText: openAnnotation.anchorText,
          // Keep the prompt with the reflection so the note reads on its own in the Notes panel
          content: `<blockquote><p>${escape(openAnnotation.content)}</p></blockquote>${paragraphs}`,
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
      <div className="reading-progress" style={{ width: `${scrollPercent}%` }} />

      {/* Top nav */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-[color-mix(in_srgb,var(--reader-bg)_82%,transparent)] backdrop-blur-sm">
        <div
          className="mx-auto px-6 py-3 flex items-center justify-between"
          style={{ maxWidth: `max(${MAX_WIDTHS[settings.width]}, 42rem)` }}
        >
          <Link
            href={sessionId ? `/session/${sessionId}` : "/"}
            className="text-ink-400 hover:text-ink-600 font-sans text-sm transition-colors"
          >
            &larr; Back
          </Link>

          <div className="flex items-center gap-3">
            <span className="text-ink-400 font-sans text-xs">
              {estimatedMinRemaining
                ? `~${estimatedMinRemaining} min left`
                : formatReadTime(article.estimatedReadMinutes)}
            </span>

            {/* Notes button */}
            <button
              onClick={() => setNotesPanelOpen((o) => !o)}
              className={`relative w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                notesPanelOpen
                  ? "bg-annotation-crossref/20 text-annotation-crossref"
                  : "hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-400 hover:text-ink-600 dark:hover:text-ink-300"
              }`}
              title="Notes"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              className="w-8 h-8 flex items-center justify-center rounded-full text-ink-400 hover:text-ink-600 dark:hover:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
              title="Re-annotate with latest vault"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>

            {/* Love button */}
            <button
              onClick={async () => {
                if (isLoved) {
                  await unloveArticle({ articleId: articleId as any });
                } else {
                  await loveArticle({ articleId: articleId as any });
                }
              }}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                isLoved
                  ? "text-red-500"
                  : "text-ink-400 hover:text-red-400 hover:bg-ink-100 dark:hover:bg-ink-800"
              }`}
              title={isLoved ? "Remove from loved" : "Love this article"}
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

            <ReaderSettingsPanel
              settings={settings}
              update={updateSettings}
              resetText={resetText}
              listening={listen.active}
              onToggleListen={toggleListen}
            />
          </div>
        </div>
      </div>

      {/* Selection toolbar — Ask / Explain / Simplify, note and copy */}
      <SelectionToolbar
        containerRef={articleRef}
        onAddNote={handleAddNote}
        onCompanion={startCompanion}
        depth={settings.answerDepth}
        onDepthChange={(answerDepth) => updateSettings({ answerDepth })}
        web={webSearchEnabled(settings)}
        onWebChange={(on) => updateSettings({ webSearch: on ? "always" : "off" })}
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

      {/* Article content */}
      <article
        ref={articleRef}
        className={cn(
          "mx-auto px-6 pt-20 pb-12 transition-[max-width] duration-300",
          settings.numbers && "reader-numbers",
          settings.focus && "reader-focus",
          settings.align === "justify" && "reader-justify",
          settings.paragraphs === "indented" && "reader-indented",
          settings.dropCap !== "off" && "reader-dropcap",
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
              settings.dropCap === "off" ? undefined : DROP_CAP_FAMILIES[settings.dropCap],
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

        {reflection && (
          <div className="mt-16">
            <ReflectionBox reflection={reflection} onDone={handleDone} />
          </div>
        )}

        {!reflection && (
          <div className="mt-16 text-center">
            <button
              onClick={handleDone}
              className="px-8 py-3 bg-ink-950 dark:bg-parchment-100 text-parchment-50 dark:text-ink-950 rounded-xl font-sans text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        )}
      </article>

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
        hidden={companion.thread?.mode === "article" || listen.active}
        onAsk={(question) => {
          setActiveAnnotation(null);
          companion.startArticle(question);
        }}
        depth={settings.answerDepth}
        onDepthChange={(answerDepth) => updateSettings({ answerDepth })}
        web={webSearchEnabled(settings)}
        onWebChange={(on) => updateSettings({ webSearch: on ? "always" : "off" })}
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
        onSkip={(index) => listen.speakFrom(Math.min(Math.max(0, index), paragraphs.count - 1))}
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
