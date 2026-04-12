"use client";
import { motion } from "framer-motion";
import Link from "next/link";

interface KnowledgeSummaryProps {
  notesTaken: number;
  reflectionsWritten: number;
  crossRefsExplored: number;
  lovedTotal: number;
  recentNotes: Array<{
    selectedText: string;
    contentPlain: string;
    articleId: string;
    articleTitle: string;
  }>;
}

export function KnowledgeSummary({
  notesTaken,
  reflectionsWritten,
  crossRefsExplored,
  lovedTotal,
  recentNotes,
}: KnowledgeSummaryProps) {
  const rows = [
    { label: "Notes taken", value: notesTaken },
    { label: "Reflections written", value: reflectionsWritten },
    { label: "Cross-refs explored", value: crossRefsExplored },
    { label: "Loved articles", value: lovedTotal },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
    >
      <p className="text-[10px] font-sans font-semibold text-ink-400 dark:text-ink-500 uppercase tracking-[0.2em] mb-5">
        Knowledge building
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        {/* Left: index-style counts */}
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between border-b border-dotted border-ink-200 dark:border-ink-700 pb-1"
            >
              <span className="text-sm font-sans text-ink-600 dark:text-ink-400">
                {r.label}
              </span>
              <span className="text-lg font-serif text-ink-950 dark:text-parchment-100">
                {r.value}
              </span>
            </div>
          ))}
        </div>

        {/* Right: recent notes */}
        <div>
          {!recentNotes || recentNotes.length === 0 ? (
            <p className="text-sm font-serif italic text-ink-400">
              No notes this week — try highlighting a passage next time.
            </p>
          ) : (
            <div className="space-y-3">
              {recentNotes.map((n, i) => (
                <Link
                  key={i}
                  href={`/read/${n.articleId}`}
                  className="block group"
                >
                  <blockquote className="text-[11px] font-serif italic text-ink-500 dark:text-ink-400 border-l-2 border-annotation-crossref pl-2 line-clamp-1 group-hover:text-annotation-crossref transition-colors">
                    {n.selectedText}
                  </blockquote>
                  <p className="text-xs font-sans text-ink-600 dark:text-ink-400 mt-0.5 line-clamp-1">
                    {n.contentPlain}
                  </p>
                  <p className="text-[9px] font-sans text-ink-300 dark:text-ink-600 mt-0.5">
                    {n.articleTitle}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
