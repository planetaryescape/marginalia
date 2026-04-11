"use client";
import { useMutation, useQuery } from "convex/react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { ArticleRenderer } from "@/components/article-renderer";
import { ReflectionBox } from "@/components/reflection-box";
import { NotesPanel } from "@/components/notes-panel";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEngagementTracker } from "@/lib/use-engagement-tracker";
import { formatReadTime } from "@/lib/utils";
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

  const handleAnnotationOpen = useCallback(
    (annotationId: string) => {
      trackAnnotationOpen(annotationId);
    },
    [trackAnnotationOpen],
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
      <div className="fixed top-0 left-0 right-0 z-40 bg-parchment-50/80 dark:bg-ink-950/80 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
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

            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Selection toolbar — "Add note" button near selected text */}
      <SelectionToolbar containerRef={articleRef} onAddNote={handleAddNote} />

      {/* Article content */}
      <article ref={articleRef} className="max-w-2xl mx-auto px-6 pt-20 pb-12">
        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-serif font-medium text-ink-950 dark:text-parchment-100 leading-tight mb-4">
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

        <div className="w-12 h-px bg-ink-200 dark:bg-ink-700 mb-10" />

        <ArticleRenderer
          content={article.content ?? ""}
          contentHtml={article.contentHtml ?? ""}
          annotations={annotations ?? []}
          onAnnotationOpen={handleAnnotationOpen}
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
