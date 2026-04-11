"use client";
import { motion } from "framer-motion";
import { StatDelta } from "./stat-delta";

interface OverviewProps {
  data: {
    thisWeek: {
      articlesFinished: number;
      totalActiveTimeMs: number;
      avgScrollDepth: number;
      notesTaken: number;
      reflectionsWritten: number;
      skippedCount: number;
    };
    lastWeek: {
      articlesFinished: number;
      totalActiveTimeMs: number;
      avgScrollDepth: number;
      notesTaken: number;
      reflectionsWritten: number;
    };
    engagementScore: number;
  };
}

function formatTime(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function generateSummary(tw: OverviewProps["data"]["thisWeek"], lw: OverviewProps["data"]["lastWeek"]): string {
  const moreArticles = tw.articlesFinished > lw.articlesFinished;
  const fewerArticles = tw.articlesFinished < lw.articlesFinished;
  const deeperReading = tw.avgScrollDepth > lw.avgScrollDepth + 5;
  const moreNotes = tw.notesTaken > lw.notesTaken;

  if (tw.articlesFinished === 0) return "No articles finished this week. Open the app and start reading.";
  if (moreArticles && deeperReading) return "You read more and went deeper this week.";
  if (moreArticles && moreNotes) return "Active week — more reading, more notes.";
  if (fewerArticles && deeperReading) return "Fewer articles, but you read more carefully.";
  if (fewerArticles && moreNotes) return "Quieter reading, but richer note-taking.";
  if (moreArticles) return "More articles this week. Your pace is picking up.";
  return "Steady reading pace this week.";
}

export function DashboardOverview({ data }: OverviewProps) {
  const tw = data.thisWeek;
  const lw = data.lastWeek;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="text-center">
          <p className="text-4xl font-serif font-light text-ink-950 dark:text-parchment-100">
            {tw.articlesFinished}
          </p>
          <p className="text-xs font-sans text-ink-400 mt-1">Articles read</p>
          <StatDelta current={tw.articlesFinished} previous={lw.articlesFinished} />
        </div>
        <div className="text-center">
          <p className="text-4xl font-serif font-light text-ink-950 dark:text-parchment-100">
            {formatTime(tw.totalActiveTimeMs)}
          </p>
          <p className="text-xs font-sans text-ink-400 mt-1">Time reading</p>
          <StatDelta
            current={Math.round(tw.totalActiveTimeMs / 60000)}
            previous={Math.round(lw.totalActiveTimeMs / 60000)}
            unit="m"
          />
        </div>
        <div className="text-center">
          <p className="text-4xl font-serif font-light text-ink-950 dark:text-parchment-100">
            {data.engagementScore}%
          </p>
          <p className="text-xs font-sans text-ink-400 mt-1">Engagement</p>
        </div>
      </div>

      <p className="text-center text-sm font-serif italic text-ink-500 dark:text-ink-400">
        {generateSummary(tw, lw)}
      </p>
    </motion.div>
  );
}
