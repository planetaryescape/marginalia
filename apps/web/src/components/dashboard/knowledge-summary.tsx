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
      <h2 className="text-sm font-medium text-[var(--reader-fg)] mb-5">
        Knowledge building
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        {/* Left: index-style counts */}
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between border-b border-dotted border-[var(--reader-border-strong)] pb-1"
            >
              <span className="text-sm font-sans text-[var(--reader-fg-soft)]">
                {r.label}
              </span>
              <span className="text-lg font-serif text-[var(--reader-fg)]">
                {r.value}
              </span>
            </div>
          ))}
        </div>

        {/* Right: recent notes */}
        <div>
          {!recentNotes || recentNotes.length === 0 ? (
            <p className="text-sm font-serif italic text-[var(--reader-muted)]">
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
                  <blockquote className="text-[12px] font-serif italic text-[var(--reader-muted)] border-l border-[var(--reader-border-strong)] pl-2 line-clamp-1 group-hover:text-[var(--reader-fg)] transition-colors">
                    {n.selectedText}
                  </blockquote>
                  <p className="text-xs font-sans text-[var(--reader-fg-soft)] mt-0.5 line-clamp-1">
                    {n.contentPlain}
                  </p>
                  <p className="text-[11px] font-sans text-[var(--reader-muted)] mt-0.5">
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
