"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Headphones,
  MessagesSquare,
  NotebookPen,
  RotateCcw,
} from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnnotationCard } from "@/components/annotation-card";
import { ArticleAsk } from "@/components/article-ask";
import { ArticleRenderer } from "@/components/article-renderer";
import { ArticleTags } from "@/components/article-tags";
import { BookUnitNav } from "@/components/book-unit-nav";
import { CompanionCard } from "@/components/companion-card";
import {
  ImpressionPanel,
  ImpressionSummary,
} from "@/components/impression-panel";
import { InlineError } from "@/components/in-place";
import { ListenBar } from "@/components/listen-bar";
import {
  AnswerUnfold,
  FoldedArticleAnswers,
  NoteUnfold,
} from "@/components/note-unfold";
import { NotesPanel } from "@/components/notes-panel";
import { FinishedLine } from "@/components/reader-finished-line";
import { ReaderLinkMenu } from "@/components/reader-link-menu";
import { ReaderMap } from "@/components/reader-map";
import { ReaderOpening, ReaderTitle } from "@/components/reader-opening";
import { ReaderReturnChip } from "@/components/reader-return-chip";
import { ReaderToolbar } from "@/components/reader-toolbar";
import { ReflectionBox } from "@/components/reflection-box";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { Sidenotes } from "@/components/sidenotes";
import { SummaryPanel } from "@/components/summary-panel";
import { FINISH_ARTICLE } from "@/components/view-transition";
import { useCompanion, usePassageHighlight } from "@/lib/companion";
import { sweepHighlight } from "@/lib/highlight-sweep";
import { findMark, type MarkKind, useHighlights } from "@/lib/highlights";
import { answerNotes, articleHistory } from "@/lib/margin-answers";
import {
  getArticleBody,
  getParagraphs,
  paragraphIndexOf,
  useParagraphs,
} from "@/lib/paragraphs";
import { escapeGoesBack } from "@/lib/reader-escape";
import { revealImpression } from "@/lib/reader-impression";
import { attachLeavingLinks, type LeavingLink } from "@/lib/reader-links";
import { backTarget, originRoom } from "@/lib/reader-return";
import {
  DROP_CAP_FAMILIES,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  TYPEFACE_FAMILIES,
  useReaderSettings,
  webSearchEnabled,
} from "@/lib/reader-settings";
import { articleProgress } from "@/lib/reading-clock";
import { useListen, useReadingPosition } from "@/lib/reading-modes";
import { type PassageSource, useSavedPassages } from "@/lib/saved-passages";
import { emitCommand, useShortcuts } from "@/lib/shortcuts";
import { findTextRange } from "@/lib/text-range";
import { markFinished, rememberedTitle } from "@/lib/title-handoff";
import { useBookProgress, useReadable } from "@/lib/use-book-reading";
import { useEngagementTracker } from "@/lib/use-engagement-tracker";
import { useIsIntersecting } from "@/lib/use-is-intersecting";
import { useMarginMode } from "@/lib/use-margin-mode";
import { useParagraphReturn } from "@/lib/use-paragraph-return";
import { useQuoteLanding } from "@/lib/use-quote-landing";
import { useReadAlongside } from "@/lib/use-read-alongside";
import { useReaderTheme } from "@/lib/use-reader-theme";
import {
  marginNotesPending,
  useStartAnnotation,
} from "@/lib/use-start-annotation";
import { cn, formatReadTime } from "@/lib/utils";

export default function ReadPage() {
  const { articleId } = useParams<{ articleId: string }>();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const router = useRouter();

  // A book is read a part at a time: `article` carries the part on screen
  const {
    article,
    isBook,
    unitIndex,
    unitKey,
    outline,
    summaries,
    missingUnit,
  } = useReadable(articleId as Id<"articles">, searchParams.get("unit"));
  // What a book's marks, notes and kept answers are filed under; absent for an article
  const unit = unitIndex ?? undefined;
  // SAFETY: the route segment is an article id, as the queries below assume
  useStartAnnotation(
    articleId as Id<"articles">,
    isBook ? undefined : article?.annotationStatus,
  );
  const annotations = useQuery(
    api.annotations.listByArticle,
    isBook && unitIndex === null
      ? "skip"
      : { articleId: articleId as any, unitIndex: unitIndex ?? undefined },
  );
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
    unitIndex: unit,
  });

  const [finishing, setFinishing] = useState(false);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [articleAskOpen, setArticleAskOpen] = useState(false);
  const impressionRef = useRef<HTMLElement>(null);
  const washTimer = useRef<number | null>(null);
  // The room the reader came from, read on the first render. The module holds nothing
  // on the server, and the toolbar only renders once the article has loaded on the client.
  const [origin] = useState<string | null>(() => originRoom());
  useEffect(
    () => () => {
      if (washTimer.current) window.clearTimeout(washTimer.current);
    },
    [],
  );
  const back = backTarget(origin, sessionId);
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
  const [leavingLink, setLeavingLink] = useState<LeavingLink | null>(null);
  const closeLeavingLink = useCallback(() => setLeavingLink(null), []);
  const [backMatter, setBackMatter] = useState<HTMLElement | null>(null);
  const backMatterInView = useIsIntersecting(backMatter);
  // Front matter: the Summary's body covers the text, so the Ask pill steps aside only while it is open
  const [frontMatter, setFrontMatter] = useState<HTMLElement | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const frontMatterInView = useIsIntersecting(summaryOpen ? frontMatter : null);

  const createNote = useMutation(api.userNotes.create);
  const { settings, update: updateSettings, resetText } = useReaderSettings();
  const paragraphs = useParagraphs(articleRef, Boolean(article));
  // A link from Notes names the passage to land on, e.g. `?quote=`.
  const landingParagraph = Number.parseInt(searchParams.get("p") ?? "", 10);
  useQuoteLanding(
    articleRef,
    searchParams.get("quote"),
    paragraphs.version,
    Number.isFinite(landingParagraph) && landingParagraph >= 0
      ? landingParagraph
      : null,
  );
  const position = useReadingPosition(articleRef, paragraphs.version);
  const summary = useQuery(api.summaries.getByArticle, {
    articleId: articleId as any,
  });
  const savedThreads = useQuery(api.companionThreads.listByArticle, {
    articleId: articleId as any,
    unitIndex: unit,
  });
  const companion = useCompanion({
    articleId: articleId as any,
    unitIndex: unitIndex,
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
    paragraphVersion: paragraphs.version,
  });
  useBookProgress(
    articleId as Id<"articles">,
    unitIndex,
    unitKey,
    useCallback(() => {
      const body = getArticleBody(articleRef.current);
      if (!body) return null;
      const rect = body.getBoundingClientRect();
      return articleProgress(rect.top, rect.height, window.innerHeight);
    }, []),
  );
  // The margin fills in ahead of the reader (rung 2f); a book's parts are written by the part
  const alongsideAnchor = useReadAlongside({
    articleId: articleId as Id<"articles">,
    enabled: !isBook && article?.annotationStatus === "annotated",
    content: article?.content,
    progress: scrollPercent,
  });
  // A link to a part the book doesn't have opens its first
  useEffect(() => {
    if (missingUnit) router.replace(`/read/${articleId}?unit=0`);
  }, [missingUnit, router, articleId]);
  // The open answer's passage, found again by its text so a refresh can restore it.
  const [openRange, setOpenRange] = useState<Range | null>(null);
  const openThread = companion.thread;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `paragraphs.version` signals the article HTML changed
  useEffect(() => {
    const body = getArticleBody(articleRef.current);
    if (!body || !openThread?.selection) {
      setOpenRange(null);
      return;
    }
    const preferred =
      openThread.paragraphIndex === null
        ? null
        : getParagraphs(body)[openThread.paragraphIndex];
    setOpenRange(findTextRange(body, openThread.selection, preferred));
  }, [
    openThread?.id,
    openThread?.selection,
    openThread?.paragraphIndex,
    paragraphs.version,
  ]);
  usePassageHighlight("companion-passage", openRange);

  // One margin card at a time: an auto annotation or a companion thread
  const [activeAnnotation, setActiveAnnotation] = useState<{
    id: string;
    paragraphIndex: number | null;
  } | null>(null);

  // Where the margin column is, a kept answer's passage is marked and the note is
  // its handle. Elsewhere every answer is marked, since the text is the handle.
  const marginMode = useMarginMode(articleRef, Boolean(article), settings);
  // Streaming rebuilds `companion.answers` on every chunk, so the passages are
  // keyed by value: only a changed passage makes the text be searched again.
  const passageKey = JSON.stringify(
    [
      ...companion.answers.map((a) => ({
        _id: a.id,
        selection: a.selection,
        paragraphIndex: a.paragraphIndex ?? undefined,
        marked: Boolean(a.savedId || a.legacyId) || marginMode !== "sidenotes",
      })),
      ...(savedThreads ?? [])
        .filter(
          (doc) =>
            !companion.answers.some(
              (a) => a.id === doc._id || a.savedId === doc._id,
            ),
        )
        .map((doc) => ({
          _id: doc._id,
          selection: doc.selection,
          paragraphIndex: doc.paragraphIndex,
          marked: true,
        })),
    ].filter((p) => p.selection),
  );
  const passageSources = useMemo<PassageSource[]>(
    () => JSON.parse(passageKey),
    [passageKey],
  );

  const savedPassages = useSavedPassages({
    containerRef: articleRef,
    threads: passageSources,
    version: paragraphs.version,
    activeId: companion.thread?.savedId ?? companion.thread?.id,
    onOpen: ({ doc }) => {
      if (
        companion.thread?.id === doc._id ||
        companion.thread?.savedId === doc._id
      )
        companion.collapse();
      else openAnswer(doc._id);
    },
  });

  // Highlighter and pen marks (registered after saved passages so those win on click)
  const highlightDocs = useQuery(api.highlights.listByArticle, {
    articleId: articleId as any,
    unitIndex: unit,
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
          // Sweeps at once; the saved mark takes over when the doc arrives
          if (kind === "highlight") sweepHighlight(range);
          await createHighlight({
            articleId: articleId as any,
            kind,
            text: range.toString().replace(/\s+/g, " ").trim(),
            paragraphIndex: paragraphIndexOf(range.startContainer) ?? undefined,
            unitIndex: unit,
          });
        }
      } catch {
        toast.error("Couldn't save that");
      }
    },
    [marks, createHighlight, removeHighlight, articleId, unit],
  );

  const startCompanion = useCallback(
    (args: Parameters<typeof companion.start>[0]) => {
      setActiveAnnotation(null);
      companion.start(args);
    },
    [companion.start],
  );

  useReaderTheme(settings);
  // On a phone the note unfolds in the text; the sheet only opens for its sources and follow-up.
  const [phoneSheet, setPhoneSheet] = useState(false);
  const activeAnnotationId = activeAnnotation?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different note starts folded
  useEffect(() => setPhoneSheet(false), [activeAnnotationId]);
  const closeAnnotation = useCallback(() => {
    if (marginMode === "phone" && phoneSheet) setPhoneSheet(false);
    else setActiveAnnotation(null);
  }, [marginMode, phoneSheet]);

  // A click on the page folds whichever note is open.
  const closeNote = useCallback(() => {
    if (companion.thread) companion.collapse();
    else closeAnnotation();
  }, [companion.thread, companion.collapse, closeAnnotation]);

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

  // Every in-article jump (¶ links, the map, summary, idea map, cards) goes through here,
  // so Back can return the reader to where they were.
  const {
    top: returnTo,
    jump: jumpToParagraph,
    back: backToParagraph,
  } = useParagraphReturn(articleRef);

  // A plain click on a link to another page opens the link menu rather than navigating
  const articleUrl = article?.url;
  const articleReady = Boolean(article);
  // articleReady and articleId say when the article element exists and when the reader has moved on
  // biome-ignore lint/correctness/useExhaustiveDependencies: those two are re-run triggers, not read inside
  useEffect(() => {
    const el = articleRef.current;
    if (!el || !articleUrl) return;
    const detach = attachLeavingLinks(el, articleUrl, setLeavingLink);
    return () => {
      detach();
      setLeavingLink(null);
    };
  }, [articleUrl, articleReady, articleId]);

  const keepAnswer = useCallback(
    async (id: string) => {
      if (await companion.keep(id)) toast.success("Kept in your notes");
      else toast.error("Couldn't keep that answer");
    },
    [companion.keep],
  );
  const deleteAnswer = useCallback(
    async (id: string) => {
      try {
        await companion.remove(id);
      } catch {
        toast.error("Couldn't delete the kept answer");
      }
    },
    [companion.remove],
  );
  // A margin note opens whether its answer is from this visit or kept earlier.
  const openAnswer = useCallback(
    (id: string) => {
      setActiveAnnotation(null);
      const doc = savedThreads?.find((t) => t._id === id);
      if (doc && !companion.answers.some((a) => a.id === id))
        companion.open(doc);
      else companion.openAnswer(id);
    },
    [savedThreads, companion.answers, companion.open, companion.openAnswer],
  );
  const answers = answerNotes(companion.answers, savedThreads);

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
      // Backspace has no default action outside typing targets, which the shortcut dispatcher skips;
      // back() does nothing when there is nowhere to return to.
      Backspace: () => backToParagraph(),
      j: () => moveParagraph(1),
      k: () => moveParagraph(-1),
      r: () => rateArticle(),
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
              openAnswer(passage.doc._id);
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

  // ★ and `r` take the reader to the impression at the end, not a popover over the text.
  const rateArticle = useCallback(() => {
    const section = impressionRef.current;
    if (!section) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    washTimer.current = revealImpression(section, reduced, washTimer.current);
  }, []);

  // Esc goes back to the origin room, unless the reader has something open of its own.
  const readerPanelOpen = Boolean(
    activeAnnotation ||
      companion.thread ||
      notesPanelOpen ||
      articleAskOpen ||
      phoneSheet,
  );
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      const selectionActive = !(window.getSelection()?.isCollapsed ?? true);
      if (
        !escapeGoesBack(
          {
            key: e.key,
            defaultPrevented: e.defaultPrevented,
            target: e.target,
          },
          { readerPanelOpen, selectionActive },
          document,
        )
      )
        return;
      e.preventDefault();
      router.push(back.href, { scroll: false });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [readerPanelOpen, back.href, router]);

  const [doneFailed, setDoneFailed] = useState(false);
  const handleDone = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    setDoneFailed(false);
    try {
      await finish();
      markFinished();
      router.push("/", { transitionTypes: [FINISH_ARTICLE] });
    } catch {
      setDoneFailed(true);
    } finally {
      setFinishing(false);
    }
  }, [finish, finishing, router]);
  const doneError = doneFailed && (
    <InlineError
      message="Couldn't save your reading activity. Check your connection."
      onRetry={() => void handleDone()}
      busy={finishing}
    />
  );

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
      companion.collapse();
      const mark = articleRef.current?.querySelector(
        `[data-annotation-id="${CSS.escape(annotationId)}"]`,
      );
      setActiveAnnotation({
        id: annotationId,
        paragraphIndex: paragraphIndexOf(mark ?? null),
      });
      trackAnnotationOpen(annotationId);
    },
    [trackAnnotationOpen, companion.collapse],
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
          unitIndex: unit,
          // Keep the prompt with the reflection so the note reads on its own in the Notes panel
          content: `<blockquote><p>${escapeHtml(openAnnotation.content)}</p></blockquote>${paragraphs}`,
          contentPlain: text,
        });
      } catch {
        toast.error("Couldn't save your reflection");
        throw new Error("save failed");
      }
    },
    [openAnnotation, createNote, articleId, unit],
  );

  const handleAddNote = useCallback(
    (selection: { text: string; startOffset?: number; endOffset?: number }) => {
      setPendingSelection(selection);
      setNotesPanelOpen(true);
    },
    [],
  );

  if (!article) {
    // Opened from the desk, the heading is already known: it is there for the
    // morph to land on while the body loads.
    const opening = (
      <ReaderOpening
        articleId={articleId}
        columnStyle={
          {
            maxWidth: MAX_WIDTHS[settings.width],
            "--reader-font": TYPEFACE_FAMILIES[settings.typeface],
            "--reader-size": `${settings.size}px`,
            "--reader-leading": LINE_HEIGHTS[settings.spacing],
          } as React.CSSProperties
        }
      />
    );
    if (rememberedTitle(articleId)) return opening;
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

  const noteCount =
    (articleNotes?.length ?? 0) +
    (savedThreads ?? []).filter((t) => t.keptAt !== undefined).length;

  const answerThread = companion.thread;
  const answerCard = (inline: boolean) =>
    answerThread && (
      <CompanionCard
        key={answerThread.id}
        inline={inline}
        thread={answerThread}
        range={openRange}
        containerRef={articleRef}
        layoutVersion={paragraphs.version}
        onClose={companion.collapse}
        onDelete={() => deleteAnswer(answerThread.id)}
        onFollowUp={companion.followUp}
        onRegenerate={companion.regenerate}
        onJump={jumpToParagraph}
        onKeep={() => keepAnswer(answerThread.id)}
      />
    );

  return (
    <>
      {/* Reading progress bar */}
      <div
        className="reading-progress"
        style={{ width: `${scrollPercent}%` }}
      />

      <ReaderToolbar
        title={article.title}
        originalUrl={article.uploadedFileName ? undefined : article.url}
        backHref={back.href}
        backLabel={back.label}
        maxWidth={`max(${MAX_WIDTHS[settings.width]}, 42rem)`}
        noteCount={noteCount}
        notesOpen={notesPanelOpen}
        onToggleNotes={() => setNotesPanelOpen((o) => !o)}
        rating={impression?.rating ?? undefined}
        onRate={rateArticle}
        loved={Boolean(isLoved)}
        onToggleLove={async () => {
          try {
            if (isLoved) await unloveArticle({ articleId: articleId as any });
            else await loveArticle({ articleId: articleId as any });
          } catch {
            toast.error("Couldn't update loved articles");
          }
        }}
        listening={listen.active}
        onToggleListen={toggleListen}
        onToggleSummary={() => emitCommand("toggle-summary")}
        onMarkUnread={article.finishedAt === undefined ? null : handleRestore}
        onReannotate={
          isBook
            ? null
            : async () => {
                try {
                  await reannotate({ articleId: articleId as any });
                  toast.success("Re-annotating with latest vault…");
                } catch {
                  toast.error("Couldn't re-annotate");
                }
              }
        }
        settings={{
          settings,
          update: updateSettings,
          resetText,
          listening: listen.active,
          onToggleListen: toggleListen,
        }}
      />

      <nav
        aria-label="Reading controls"
        className="mobile-reader-bar sm:hidden"
      >
        <button
          aria-label={isBook ? "Ask about this book" : "Ask about this article"}
          aria-expanded={articleAskOpen}
          aria-controls={articleAskOpen ? "article-question" : undefined}
          disabled={listen.active || Boolean(saveError)}
          onClick={() => {
            setNotesPanelOpen(false);
            setActiveAnnotation(null);
            companion.collapse();
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
      {doneError && (
        <div className="fixed z-40 left-3 right-3 bottom-20 rounded-xl bg-[var(--reader-surface)] p-3 text-sm font-sans ring-1 ring-[var(--reader-border)] sm:hidden">
          {doneError}
        </div>
      )}
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
          ticks={(highlightDocs ?? []).flatMap((d) =>
            d.paragraphIndex === undefined ? [] : [d.paragraphIndex],
          )}
          onJump={jumpToParagraph}
          minutesLeft={estimatedMinRemaining}
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
            "article-column reader-arriving mx-auto px-6 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] transition-[max-width] duration-300",
            settings.numbers && "reader-numbers",
            settings.focus && "reader-focus",
            settings.align === "justify" && "reader-justify",
            settings.paragraphs === "indented" && "reader-indented",
            // A PDF's first block is often a licence line or an author list, so
            // nothing in it is a lead worth a drop cap
            settings.dropCap !== "off" &&
              !article.uploadedFileName &&
              "reader-dropcap",
          )}
          data-dropcap-style={settings.dropCap}
          data-margin={marginMode}
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
            <ReaderTitle articleId={articleId} title={article.title} />
            <div className="flex flex-wrap gap-3 text-sm font-sans text-ink-400 dark:text-ink-500">
              {isBook && outline && unitIndex !== null && (
                <span>
                  Part {unitIndex + 1} of {outline.length}
                </span>
              )}
              {article.author && <span>{article.author}</span>}
              {article.estimatedReadMinutes && (
                <>
                  <span>&middot;</span>
                  <span>{formatReadTime(article.estimatedReadMinutes)}</span>
                </>
              )}
            </div>
            <ArticleTags articleId={articleId as any} />
            {impression && <ImpressionSummary impression={impression} />}
          </header>

          {(!isBook || summary) && (
            <div ref={setFrontMatter}>
              <SummaryPanel
                articleId={articleId as any}
                title={article.title}
                wordCount={article.wordCount}
                summary={summary}
                containerRef={articleRef}
                onJump={jumpToParagraph}
                canGenerate={!isBook}
                onExpandedChange={setSummaryOpen}
              />
            </div>
          )}
          <ArticleRenderer
            content={article.content ?? ""}
            contentHtml={article.contentHtml ?? ""}
            annotations={annotations ?? []}
            activeAnnotationId={activeAnnotation?.id ?? null}
            onAnnotationSelect={handleAnnotationSelect}
          />

          {/* Back matter: the Ask pill steps aside while it is in view */}
          <div ref={setBackMatter}>
            {isBook && outline && unitIndex !== null && (
              <BookUnitNav
                articleId={articleId}
                unitIndex={unitIndex}
                outline={outline}
                summaries={summaries}
              />
            )}
            {!isBook && (
              <section
                ref={impressionRef}
                aria-label="Your impression"
                className="mt-16 rounded-2xl bg-[var(--reader-surface)] ring-1 ring-[var(--reader-border)] p-5"
              >
                <ImpressionPanel articleId={articleId as any} />
              </section>
            )}

            {!isBook && reflection && (
              <div className="mt-10">
                <ReflectionBox reflection={reflection} onDone={handleDone} />
              </div>
            )}

            {!isBook && !reflection && (
              <div className="mt-10 text-center">
                <button
                  onClick={handleDone}
                  className="px-8 py-3 rounded-md bg-[var(--ink)] text-[var(--reader-bg)] font-sans text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Done
                </button>
                {doneError && <div className="mt-4">{doneError}</div>}
              </div>
            )}

            {!isBook && (
              <FinishedLine
                finished={article.finishedAt !== undefined}
                onMarkUnread={handleRestore}
              />
            )}
          </div>
        </article>
      </div>

      <Sidenotes
        key={`${articleId}:${unitIndex ?? ""}`}
        containerRef={articleRef}
        mode={marginMode}
        version={paragraphs.version}
        layoutKey={settings}
        annotations={annotations}
        userNotes={articleNotes}
        marks={marks}
        waiting={marginNotesPending(article) || alongsideAnchor !== null}
        waitingAnchor={alongsideAnchor}
        openId={activeAnnotationId}
        answers={answers}
        openAnswerId={companion.openId}
        onOpenAnswer={openAnswer}
        onClose={closeNote}
        onOpenNotes={() => setNotesPanelOpen(true)}
        openCard={
          companion.thread ? (
            answerCard(true)
          ) : openAnnotation && activeAnnotation ? (
            <AnnotationCard
              inline
              annotation={openAnnotation}
              paragraphIndex={activeAnnotation.paragraphIndex}
              reflections={(articleNotes ?? [])
                .filter((note) => note.annotationId === openAnnotation._id)
                .sort((a, b) => a.createdAt - b.createdAt)}
              onReflect={handleReflect}
              onDeleteReflection={(id) => removeNote({ noteId: id as any })}
              containerRef={articleRef}
              layoutVersion={paragraphs.version}
              onClose={closeAnnotation}
              onJump={jumpToParagraph}
            />
          ) : null
        }
      />

      {marginMode === "phone" && companion.thread && (
        <AnswerUnfold
          containerRef={articleRef}
          version={paragraphs.version}
          id={companion.thread.id}
          paragraphIndex={companion.thread.paragraphIndex}
        >
          {answerCard(true)}
        </AnswerUnfold>
      )}

      {marginMode === "sheet" && companion.thread && answerCard(false)}

      {marginMode !== "sidenotes" && (
        <FoldedArticleAnswers
          containerRef={articleRef}
          version={paragraphs.version}
          items={answers.filter(
            (a) =>
              a.paragraphIndex === null &&
              !a.selection &&
              a.id !== companion.openId,
          )}
          onOpen={openAnswer}
        />
      )}

      {marginMode === "phone" && (
        <NoteUnfold
          containerRef={articleRef}
          version={paragraphs.version}
          annotation={openAnnotation ?? null}
          paragraph={
            activeAnnotation?.paragraphIndex != null
              ? activeAnnotation.paragraphIndex + 1
              : null
          }
          sheetOpen={phoneSheet}
          onFold={closeAnnotation}
          onOpenCard={() => setPhoneSheet(true)}
        />
      )}

      {openAnnotation &&
        activeAnnotation &&
        marginMode !== "sidenotes" &&
        (marginMode !== "phone" || phoneSheet) && (
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
            onClose={closeAnnotation}
            onJump={jumpToParagraph}
          />
        )}

      {/* A book is asked about through its outline and matching passages, with the part on screen as the ¶ numbers' home */}
      <ArticleAsk
        noun={isBook ? "book" : "article"}
        open={articleAskOpen}
        onOpenChange={setArticleAskOpen}
        hidden={Boolean(
          companion.thread ||
            activeAnnotation ||
            notesPanelOpen ||
            backMatterInView ||
            frontMatterInView ||
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
        history={articleHistory(companion.answers, savedThreads)}
        onOpen={openAnswer}
      />

      <ReaderReturnChip entry={returnTo} onBack={backToParagraph} />
      {leavingLink ? (
        <ReaderLinkMenu
          key={leavingLink.href}
          link={leavingLink}
          onClose={closeLeavingLink}
        />
      ) : null}

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
        unitIndex={unit}
        isOpen={notesPanelOpen}
        onClose={() => setNotesPanelOpen(false)}
        pendingSelection={pendingSelection}
        onClearSelection={() => setPendingSelection(null)}
        onJump={jumpToParagraph}
        onAnswerDeleted={companion.forget}
      />
    </>
  );
}
