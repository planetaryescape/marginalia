"use client";
import { motion } from "framer-motion";
import { StatDelta } from "./stat-delta";

interface TrendComparisonProps {
  thisWeek: {
    articlesFinished: number;
    totalActiveTimeMs: number;
    avgScrollDepth: number;
    annotationsOpenedCount: number;
    notesTaken: number;
    reflectionsWritten: number;
  };
  lastWeek: {
    articlesFinished: number;
    totalActiveTimeMs: number;
    avgScrollDepth: number;
    annotationsOpenedCount: number;
    notesTaken: number;
    reflectionsWritten: number;
  };
}

function formatMin(ms: number): string {
  return `${Math.round(ms / 60000)}m`;
}

export function TrendComparison({ thisWeek: tw, lastWeek: lw }: TrendComparisonProps) {
  const rows = [
    { label: "Articles read", tw: tw.articlesFinished, lw: lw.articlesFinished },
    { label: "Active time", tw: formatMin(tw.totalActiveTimeMs), lw: formatMin(lw.totalActiveTimeMs), rawTw: Math.round(tw.totalActiveTimeMs / 60000), rawLw: Math.round(lw.totalActiveTimeMs / 60000), unit: "m" },
    { label: "Scroll depth", tw: `${tw.avgScrollDepth}%`, lw: `${lw.avgScrollDepth}%`, rawTw: tw.avgScrollDepth, rawLw: lw.avgScrollDepth, unit: "%" },
    { label: "Annotations", tw: tw.annotationsOpenedCount, lw: lw.annotationsOpenedCount },
    { label: "Notes", tw: tw.notesTaken, lw: lw.notesTaken },
    { label: "Reflections", tw: tw.reflectionsWritten, lw: lw.reflectionsWritten },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
    >
      <p className="text-[10px] font-sans font-semibold text-ink-400 dark:text-ink-500 uppercase tracking-[0.2em] mb-4">
        Week over week
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const numTw = r.rawTw ?? (typeof r.tw === "number" ? r.tw : 0);
          const numLw = r.rawLw ?? (typeof r.lw === "number" ? r.lw : 0);
          return (
            <div
              key={r.label}
              className="flex items-center text-xs font-sans"
            >
              <span className="text-ink-500 dark:text-ink-400 flex-1">
                {r.label}
              </span>
              <span className="text-ink-700 dark:text-parchment-300 w-12 text-right">
                {typeof r.tw === "number" ? r.tw : r.tw}
              </span>
              <span className="text-ink-300 dark:text-ink-600 w-12 text-right">
                {typeof r.lw === "number" ? r.lw : r.lw}
              </span>
              <span className="w-20 text-right">
                <StatDelta current={numTw} previous={numLw} unit={r.unit} />
              </span>
            </div>
          );
        })}
        <div className="flex items-center text-[9px] font-sans text-ink-300 dark:text-ink-600 pt-1">
          <span className="flex-1" />
          <span className="w-12 text-right">This wk</span>
          <span className="w-12 text-right">Last wk</span>
          <span className="w-20" />
        </div>
      </div>
    </motion.div>
  );
}
