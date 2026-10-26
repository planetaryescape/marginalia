"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { sourceHash } from "@marginalia/backend/prepared-representation";
import { useAction } from "convex/react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { ArrowRight, ChevronDown, RotateCcw } from "lucide-react";
import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { modelName } from "@/lib/models";
import { getArticleBody, getParagraphs, paragraphText } from "@/lib/paragraphs";
import { useCommand } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

const loadIdeaMap = () => import("./idea-map");
const IdeaMap = lazy(() =>
  loadIdeaMap().then((module) => ({ default: module.IdeaMap })),
);

const EASE = [0.22, 1, 0.36, 1] as const;

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

// Each line settles in from a soft blur, like ink drying
const item: Variants = {
  hidden: { opacity: 0, y: 6, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.45, ease: EASE },
  },
};

function ParagraphChip({
  n,
  onJump,
}: {
  n: number;
  onJump: (index: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(n - 1)}
      className="inline-flex items-center align-[0.08em] mx-px px-1.5 h-[1.35em] rounded-md font-mono text-[0.72em] tabular-nums bg-[var(--reader-chip)] text-[var(--reader-muted)] hover:text-[var(--ink)] transition-colors"
    >
      ¶{n}
    </button>
  );
}

/** Stacked lines with a highlighter sweeping down them while the model reads. */
function ReadingGlyph() {
  return (
    <div className="relative w-9 h-7 overflow-hidden" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="absolute left-0 h-[2px] rounded-full bg-[var(--reader-muted)] opacity-40"
          style={{ top: 3 + i * 6, width: i === 3 ? "60%" : "100%" }}
        />
      ))}
      <span className="summary-sweep absolute left-0 right-0 h-[5px] rounded-sm bg-[var(--highlighter)]" />
    </div>
  );
}

type Layers = { more: boolean; map: boolean };
const NO_LAYERS: Layers = { more: false, map: false };
// Which layers BK opened per article, kept for this page session
const openLayers = new Map<Id<"articles">, Layers>();

function LayerToggle({
  label,
  open,
  onToggle,
  onIntent,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onIntent?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      aria-expanded={open}
      className="flex items-center gap-1 hover:text-[var(--ink)] transition-colors"
    >
      {label}
      <ChevronDown
        size={13}
        aria-hidden
        className={cn(
          "transition-transform duration-300",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

function Layer({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const SummaryPanel = memo(function SummaryPanel({
  articleId,
  title,
  content,
  contentHtml,
  wordCount,
  summary,
  containerRef,
  onJump,
  canGenerate = true,
  onExpandedChange,
  studySource = false,
}: {
  articleId: Id<"articles">;
  title: string;
  content?: string;
  contentHtml?: string;
  wordCount: number | undefined;
  summary: Doc<"summaries"> | null | undefined;
  containerRef: React.RefObject<HTMLElement | null>;
  onJump: (index: number) => void;
  /** False for a book: its one point is written once, and a map of the part on screen would replace it. */
  canGenerate?: boolean;
  /** Tells the reader when the body is unfolded, so the Ask pill can step aside for it. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Invalidates DOM-derived fallback word counts only when the prose changes. */
  contentVersion?: number;
  studySource?: boolean;
}) {
  const generate = useAction(api.actions.summarize.generate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A stored summary starts folded on later visits; a fresh one opens
  const [expanded, setExpanded] = useState(false);
  const requestEpoch = useRef(0);
  useEffect(() => {
    requestEpoch.current++;
    setLoading(false);
    setError(null);
    return () => {
      requestEpoch.current++;
    };
  }, [articleId, content, contentHtml, title]);
  useEffect(() => {
    onExpandedChange?.(expanded);
    return () => onExpandedChange?.(false);
  }, [expanded, onExpandedChange]);
  const [layers, setLayers] = useState<Layers>(
    () => openLayers.get(articleId) ?? NO_LAYERS,
  );
  const setLayer = (layer: keyof Layers, open: boolean) => {
    const next = { ...layers, [layer]: open };
    openLayers.set(articleId, next);
    setLayers(next);
  };

  const run = async () => {
    const epoch = ++requestEpoch.current;
    const paragraphs = studySource
      ? (content ?? "").split(/\n\n+/).filter(Boolean)
      : getParagraphs(getArticleBody(containerRef.current)).map(paragraphText);
    setError(null);
    setLoading(true);
    try {
      await generate({
        articleId,
        title,
        paragraphs,
        sourceHash: await sourceHash(content, contentHtml),
        expectedSummaryId: summary?._id,
      });
      if (epoch === requestEpoch.current) setExpanded(true);
    } catch (error) {
      if (epoch === requestEpoch.current)
        setError(
          error instanceof Error
            ? error.message
            : "Couldn't summarise this one. Try again.",
        );
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  };

  const words =
    wordCount ??
    getParagraphs(getArticleBody(containerRef.current))
      .map(paragraphText)
      .join(" ")
      .split(/\s+/).length;

  const state = summary ? "ready" : loading ? "loading" : "idle";

  // "u" on the reading page: summarise, or fold and unfold an existing summary
  useCommand("toggle-summary", () => {
    if (state === "ready") setExpanded((e) => !e);
    else if (state === "idle" && canGenerate) run();
  });

  return (
    <motion.section
      layout
      transition={{ layout: { duration: 0.45, ease: EASE } }}
      aria-label="Summary"
      className={cn(
        "mb-10 overflow-hidden font-sans",
        state !== "idle" &&
          "rounded-lg ring-1 ring-[var(--reader-border)] bg-[var(--reader-surface)]",
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {state === "idle" && canGenerate && (
          <motion.button
            key="idle"
            type="button"
            onClick={run}
            disabled={loading}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="group w-full py-1 text-left text-[14px] leading-[1.55] text-[var(--pencil)] hover:text-[var(--ink)] transition-colors"
          >
            {error ?? "Summary, key claims and a map, before you start"}
            {!error && (
              <ArrowRight
                size={14}
                aria-hidden
                className="ml-1.5 inline align-[-2px] transition-transform group-hover:translate-x-0.5"
              />
            )}
            <span className="sr-only">Summarize this article</span>
          </motion.button>
        )}

        {state === "loading" && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="px-5 py-4"
            role="status"
          >
            <div className="flex items-start justify-between">
              <p className="summary-reading text-[12.5px] font-medium text-[var(--pencil)]">
                Reading all {words.toLocaleString()} words
              </p>
              <ReadingGlyph />
            </div>
            <div className="mt-3 space-y-2">
              <div className="companion-shimmer h-3 w-[94%] rounded" />
              <div className="companion-shimmer h-3 w-[88%] rounded" />
              <div className="companion-shimmer h-3 w-[52%] rounded" />
            </div>
            <div className="mt-5 space-y-2.5">
              {[78, 70, 74].map((w) => (
                <div key={w} className="flex items-center gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--reader-chip)]" />
                  <div
                    className="companion-shimmer h-2.5 rounded"
                    style={{ width: `${w}%` }}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {state === "ready" && summary && (
          <motion.div
            key="ready"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="w-full flex items-center gap-2 px-5 py-3 text-left"
            >
              <span className="text-[12.5px] font-semibold text-[var(--reader-fg)]">
                Summary
              </span>
              <span className="text-[12px] text-[var(--reader-muted)]">
                {summary.ideas
                  ? `${summary.ideas.length} ideas · ${summary.links?.length ?? 0} connections`
                  : summary.claims
                    ? `${summary.claims.length} claims`
                    : "the map on request"}
              </span>
              <ChevronDown
                size={15}
                className={cn(
                  "ml-auto text-[var(--reader-muted)] transition-transform duration-300",
                  expanded && "rotate-180",
                )}
              />
            </button>

            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="overflow-hidden"
                >
                  <motion.div
                    variants={list}
                    initial="hidden"
                    animate="show"
                    className="px-5 pb-4"
                  >
                    {/* The one point comes first. Without one, the gist is the fallback. */}
                    {summary.thesis ? (
                      <motion.div variants={item}>
                        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--reader-muted)]">
                          The one point
                        </p>
                        <p className="mt-1 font-serif text-[18px] leading-snug text-[var(--reader-fg)]">
                          {summary.thesis}
                        </p>
                      </motion.div>
                    ) : (
                      <motion.p
                        variants={item}
                        className="text-[14.5px] leading-[1.65] text-[var(--reader-fg-soft)]"
                      >
                        {summary.gist}
                      </motion.p>
                    )}

                    <motion.div
                      variants={item}
                      className="mt-4 flex items-center gap-5 text-[12.5px] text-[var(--pencil)]"
                    >
                      {summary.thesis && (
                        <LayerToggle
                          label="More"
                          open={layers.more}
                          onToggle={() => setLayer("more", !layers.more)}
                        />
                      )}
                      <LayerToggle
                        label="The map"
                        onIntent={() => {
                          void loadIdeaMap();
                        }}
                        open={layers.map}
                        onToggle={() => setLayer("map", !layers.map)}
                      />
                    </motion.div>

                    {summary.thesis && (
                      <Layer open={layers.more}>
                        <div className="pt-3">
                          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--reader-muted)]">
                            In short
                          </p>
                          <p className="mt-1 text-[14.5px] leading-[1.65] text-[var(--pencil)]">
                            {summary.gist}
                          </p>
                        </div>
                      </Layer>
                    )}

                    <Layer open={layers.map}>
                      <div className="pt-4">
                        {summary.ideas && summary.links ? (
                          <>
                            <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[var(--reader-muted)]">
                              How the ideas connect
                            </p>
                            <Suspense
                              fallback={<p role="status">Loading map…</p>}
                            >
                              <IdeaMap
                                ideas={summary.ideas}
                                links={summary.links}
                                onJump={onJump}
                              />
                            </Suspense>
                            {summary.flow && (
                              <>
                                <p className="mt-6 mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--reader-muted)]">
                                  How it fits together
                                </p>
                                <p className="text-[13.5px] leading-relaxed text-[var(--reader-fg-soft)]">
                                  {summary.flow}
                                </p>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <ol className="space-y-2">
                              {summary.claims?.map((claim, i) => (
                                <li
                                  key={claim.text}
                                  className="flex gap-3 text-[13.5px] leading-relaxed text-[var(--reader-fg-soft)]"
                                >
                                  <span className="w-4 shrink-0 pt-px text-right font-mono text-[11px] tabular-nums text-[var(--reader-muted)]">
                                    {i + 1}
                                  </span>
                                  <span>
                                    {claim.text}{" "}
                                    {claim.paragraphs.map((n) => (
                                      <ParagraphChip
                                        key={n}
                                        n={n}
                                        onJump={onJump}
                                      />
                                    ))}
                                  </span>
                                </li>
                              ))}
                            </ol>
                            <p className="mt-3 text-[12px] text-[var(--reader-muted)]">
                              Redo this summary to get the idea map.
                            </p>
                          </>
                        )}
                      </div>
                    </Layer>

                    <motion.div
                      variants={item}
                      className="mt-4 pt-3 flex items-center gap-3 border-t border-[var(--reader-border)] text-[11px] text-[var(--reader-muted)]"
                    >
                      <span className="font-mono">
                        {modelName(summary.model)}
                      </span>
                      <span>·</span>
                      <span>{words.toLocaleString()} words</span>
                      {canGenerate && (
                        <button
                          type="button"
                          onClick={run}
                          disabled={loading}
                          className="ml-auto flex items-center gap-1 hover:text-[var(--reader-fg)] transition-colors"
                        >
                          <RotateCcw size={11} />{" "}
                          {loading
                            ? "Generating…"
                            : summary.thesis
                              ? "Redo"
                              : "Refresh summary"}
                        </button>
                      )}
                    </motion.div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      {error && summary && (
        <p role="alert" className="px-5 pb-4 text-sm">
          {error}
        </p>
      )}
    </motion.section>
  );
});
