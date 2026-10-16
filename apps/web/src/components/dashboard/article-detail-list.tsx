"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import { formatDate } from "@/lib/utils";
import { MiniBar } from "./mini-bar";

interface ArticleDetail {
  articleId: string;
  title: string;
  author?: string;
  estimatedReadMinutes?: number;
  readAt: number;
  activeTimeMs: number;
  wallTimeMs: number;
  maxScrollPercent: number;
  annotationsOpened: number;
  annotationsTotal: number;
  tabHiddenCount: number;
  notesCount: number;
  hasReflection: boolean;
  isLoved: boolean;
}

interface ArticleDetailListProps {
  articles: ArticleDetail[];
}

function formatMs(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function ArticleDetailList({ articles }: ArticleDetailListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!articles || articles.length === 0) {
    return (
      <p className="text-sm font-serif italic text-[var(--reader-muted)] text-center py-6">
        No articles read this week.
      </p>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
    >
      <h2 className="text-sm font-medium text-[var(--reader-fg)] mb-5">
        What you read
      </h2>

      <div>
        {articles.map((a) => {
          const isOpen = expanded === a.articleId;
          return (
            <div
              key={a.articleId}
              className="border-b border-[var(--reader-border)]"
            >
              {/* Collapsed row */}
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : a.articleId)}
                className="w-full flex items-center gap-3 py-3 text-left hover:bg-[var(--reader-chip)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-serif text-[var(--reader-fg)] truncate">
                    {a.title}
                  </p>
                  <p className="text-[11px] font-sans text-[var(--reader-muted)] mt-0.5">
                    {a.author ? `${a.author} · ` : ""}
                    {formatDate(a.readAt)}
                  </p>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <MiniBar
                    value={a.maxScrollPercent}
                    width="40px"
                    height="3px"
                  />
                  <span className="text-[11px] font-sans text-[var(--reader-muted)] w-8">
                    {formatMs(a.activeTimeMs)}
                  </span>
                  <span className="text-[11px] font-sans text-[var(--reader-muted)] w-8">
                    {a.annotationsOpened}/{a.annotationsTotal}
                  </span>
                  {a.isLoved && (
                    <span className="text-red-500 text-xs">&#9829;</span>
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pb-4 pl-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs font-sans">
                      <Detail
                        label="Scroll depth"
                        value={`${a.maxScrollPercent}%`}
                      />
                      <Detail
                        label="Active time"
                        value={formatMs(a.activeTimeMs)}
                      />
                      <Detail
                        label="Wall time"
                        value={formatMs(a.wallTimeMs)}
                      />
                      <Detail
                        label="Tab switches"
                        value={`${a.tabHiddenCount}`}
                      />
                      <Detail
                        label="Annotations"
                        value={`${a.annotationsOpened} of ${a.annotationsTotal} opened`}
                      />
                      <Detail label="Notes" value={`${a.notesCount}`} />
                      <Detail
                        label="Reflection"
                        value={a.hasReflection ? "Written" : "Skipped"}
                      />
                      <Detail
                        label="Read time"
                        value={
                          a.estimatedReadMinutes
                            ? `${a.estimatedReadMinutes}m est`
                            : "—"
                        }
                      />
                    </div>
                    <div className="pb-3 pl-4">
                      <Link
                        href={`/read/${a.articleId}`}
                        className="text-xs font-sans quiet-link"
                      >
                        Re-read &rarr;
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--reader-muted)]">{label}</span>
      <span className="text-[var(--reader-fg-soft)]">{value}</span>
    </div>
  );
}
