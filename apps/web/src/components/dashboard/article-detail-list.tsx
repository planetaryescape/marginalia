"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MiniBar } from "./mini-bar";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

interface ArticleDetail {
  articleId: string;
  title: string;
  author: string | null;
  estimatedReadMinutes: number | null;
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
      <p className="text-sm font-serif italic text-ink-400 text-center py-6">
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
      <p className="text-[10px] font-sans font-semibold text-ink-400 dark:text-ink-500 uppercase tracking-[0.2em] mb-5">
        What you read
      </p>

      <div>
        {articles.map((a) => {
          const isOpen = expanded === a.articleId;
          return (
            <div
              key={a.articleId}
              className="border-b border-ink-100 dark:border-ink-800"
            >
              {/* Collapsed row */}
              <button
                onClick={() =>
                  setExpanded(isOpen ? null : a.articleId)
                }
                className="w-full flex items-center gap-3 py-3 text-left hover:bg-ink-50 dark:hover:bg-ink-900/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-serif text-ink-800 dark:text-parchment-200 truncate">
                    {a.title}
                  </p>
                  <p className="text-[10px] font-sans text-ink-400 mt-0.5">
                    {a.author} · {formatDate(a.readAt)}
                  </p>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <MiniBar value={a.maxScrollPercent} width="40px" height="3px" />
                  <span className="text-[10px] font-sans text-ink-400 w-8">
                    {formatMs(a.activeTimeMs)}
                  </span>
                  <span className="text-[10px] font-sans text-ink-400 w-8">
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
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pb-4 pl-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs font-sans">
                      <Detail label="Scroll depth" value={`${a.maxScrollPercent}%`} />
                      <Detail label="Active time" value={formatMs(a.activeTimeMs)} />
                      <Detail label="Wall time" value={formatMs(a.wallTimeMs)} />
                      <Detail label="Tab switches" value={`${a.tabHiddenCount}`} />
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
                        value={a.estimatedReadMinutes ? `${a.estimatedReadMinutes}m est` : "—"}
                      />
                    </div>
                    <div className="pb-3 pl-4">
                      <Link
                        href={`/read/${a.articleId}`}
                        className="text-xs font-sans text-annotation-crossref hover:underline"
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
      <span className="text-ink-400">{label}</span>
      <span className="text-ink-700 dark:text-parchment-300">{value}</span>
    </div>
  );
}
