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
  if (!tw || !lw) return null;
  const rows = [
    { label: "Articles read", tw: tw.articlesFinished ?? 0, lw: lw.articlesFinished ?? 0 },
    { label: "Active time", tw: formatMin(tw.totalActiveTimeMs ?? 0), lw: formatMin(lw.totalActiveTimeMs ?? 0), rawTw: Math.round((tw.totalActiveTimeMs ?? 0) / 60000), rawLw: Math.round((lw.totalActiveTimeMs ?? 0) / 60000), unit: "m" },
    { label: "Scroll depth", tw: `${tw.avgScrollDepth ?? 0}%`, lw: `${lw.avgScrollDepth ?? 0}%`, rawTw: tw.avgScrollDepth ?? 0, rawLw: lw.avgScrollDepth ?? 0, unit: "%" },
    { label: "Annotations", tw: tw.annotationsOpenedCount ?? 0, lw: lw.annotationsOpenedCount ?? 0 },
    { label: "Notes", tw: tw.notesTaken ?? 0, lw: lw.notesTaken ?? 0 },
    { label: "Reflections", tw: tw.reflectionsWritten ?? 0, lw: lw.reflectionsWritten ?? 0 },
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
