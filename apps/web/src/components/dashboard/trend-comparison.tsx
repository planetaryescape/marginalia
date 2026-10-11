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

export function TrendComparison({
  thisWeek: tw,
  lastWeek: lw,
}: TrendComparisonProps) {
  if (!tw || !lw) return null;
  const rows = [
    {
      label: "Articles read",
      tw: tw.articlesFinished ?? 0,
      lw: lw.articlesFinished ?? 0,
      rawTw: tw.articlesFinished ?? 0,
      rawLw: lw.articlesFinished ?? 0,
    },
    {
      label: "Active time",
      tw: formatMin(tw.totalActiveTimeMs ?? 0),
      lw: formatMin(lw.totalActiveTimeMs ?? 0),
      rawTw: Math.round((tw.totalActiveTimeMs ?? 0) / 60000),
      rawLw: Math.round((lw.totalActiveTimeMs ?? 0) / 60000),
      unit: "m",
    },
    {
      label: "Scroll depth",
      tw: `${tw.avgScrollDepth ?? 0}%`,
      lw: `${lw.avgScrollDepth ?? 0}%`,
      rawTw: tw.avgScrollDepth ?? 0,
      rawLw: lw.avgScrollDepth ?? 0,
      unit: "%",
    },
    {
      label: "Annotations",
      tw: tw.annotationsOpenedCount ?? 0,
      lw: lw.annotationsOpenedCount ?? 0,
      rawTw: tw.annotationsOpenedCount ?? 0,
      rawLw: lw.annotationsOpenedCount ?? 0,
    },
    {
      label: "Notes",
      tw: tw.notesTaken ?? 0,
      lw: lw.notesTaken ?? 0,
      rawTw: tw.notesTaken ?? 0,
      rawLw: lw.notesTaken ?? 0,
    },
    {
      label: "Reflections",
      tw: tw.reflectionsWritten ?? 0,
      lw: lw.reflectionsWritten ?? 0,
      rawTw: tw.reflectionsWritten ?? 0,
      rawLw: lw.reflectionsWritten ?? 0,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
    >
      <h2 className="text-sm font-medium text-[var(--reader-fg)] mb-4">
        Week over week
      </h2>
      <div className="space-y-1.5">
        {rows.map((r) => {
          return (
            <div key={r.label} className="flex items-center text-xs font-sans">
              <span className="text-[var(--reader-muted)] flex-1">
                {r.label}
              </span>
              <span className="text-[var(--reader-fg-soft)] w-12 text-right">
                {r.tw}
              </span>
              <span className="text-[var(--reader-muted)] w-12 text-right">
                {r.lw}
              </span>
              <span className="w-20 text-right">
                <StatDelta current={r.rawTw} previous={r.rawLw} unit={r.unit} />
              </span>
            </div>
          );
        })}
        <div className="flex items-center text-[11px] font-sans text-[var(--reader-muted)] pt-1">
          <span className="flex-1" />
          <span className="w-12 text-right">This wk</span>
          <span className="w-12 text-right">Last wk</span>
          <span className="w-20" />
        </div>
      </div>
    </motion.div>
  );
}
